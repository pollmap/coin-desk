import type { Asset, Point } from '../shared/types';
import { DAY } from '../shared/math';
import { upstream } from './providers';
import { epoch, readState, type Env } from './storage';
export const REFERENCE_ASSETS = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'] as const;
export const REFERENCE_SOURCE = 'Coin Metrics Community · PriceUSD';
export const REFERENCE_VERSION = 'coinmetrics-priceusd-utc-close-v1';
export function parseReference(body: unknown, asset: Asset, now = epoch()): Point[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data))
    throw new Error('Invalid reference response');
  const rows = (body as { data: Record<string, unknown>[] }).data;
  const points: Point[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.asset !== asset.toLowerCase()) throw new Error('Reference asset mismatch');
    const time = Date.parse(String(row.time)) / 1000;
    if (!Number.isSafeInteger(time) || time < 0 || time % DAY !== 0 || seen.has(time))
      throw new Error('Invalid reference date');
    seen.add(time);
    if (row.PriceUSD === null || row.PriceUSD === undefined) continue;
    if (typeof row.PriceUSD !== 'string' && typeof row.PriceUSD !== 'number')
      throw new Error('Invalid reference price');
    const value = Number(row.PriceUSD);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid reference price');
    if (time + DAY > now) continue;
    points.push({ time, value });
  }
  return points.sort((a, b) => a.time - b.time);
}
export async function updateReference(env: Env, asset: Asset) {
  if (!(REFERENCE_ASSETS as readonly string[]).includes(asset))
    throw new Error('Unsupported reference asset');
  const progressKey = 'reference-progress:' + asset;
  const [latest, progress] = await Promise.all([
    env.DB.prepare('SELECT MAX(time) AS time FROM reference_prices WHERE asset=?')
      .bind(asset)
      .first<{ time: number | null }>(),
    readState<{ cursor: number } | null>(env.DB, progressKey, null),
  ]);
  const now = epoch(),
    end = Math.floor(now / DAY) * DAY;
  const correctionFrom = latest?.time ? latest.time - 2 * DAY : Date.UTC(2009, 0, 1) / 1000;
  if (
    progress &&
    (!Number.isSafeInteger(progress.cursor) ||
      progress.cursor % DAY !== 0 ||
      progress.cursor < 0 ||
      progress.cursor > end)
  )
    throw new Error('Invalid reference checkpoint');
  // A null-only page must still advance through the source calendar. The normal
  // correction window resumes after catch-up, independently of this checkpoint.
  const from = progress ? Math.max(correctionFrom, progress.cursor) : correctionFrom;
  const params = new URLSearchParams({
    assets: asset.toLowerCase(),
    metrics: 'PriceUSD',
    frequency: '1d',
    page_size: '32',
    paging_from: 'start',
    start_time: new Date(from * 1000).toISOString(),
    end_time: new Date(end * 1000).toISOString(),
    end_inclusive: 'false',
  });
  const raw = await upstream(
    'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?' + params,
  );
  const rows = parseReference(raw, asset);
  const body = raw as { data: { time: string }[]; next_page_token?: unknown };
  if (!body.data.length || body.data.length > 32) throw new Error('Invalid reference page size');
  const dates = body.data.map((row) => Date.parse(row.time) / 1000);
  if (dates.some((time) => time < from || time >= end))
    throw new Error('Reference page outside requested dates');
  const token = body.next_page_token;
  if (token != null && (typeof token !== 'string' || token.length > 2048))
    throw new Error('Invalid reference page token');
  const cursor = Math.max(...dates) + DAY;
  const catchingUp = cursor < end && (body.data.length === 32 || !!token);
  const key = 'reference:' + asset;
  const asOf = Math.max(latest?.time ?? 0, rows.at(-1)?.time ?? 0);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
    ).bind(key, REFERENCE_SOURCE, now, JSON.stringify(raw)),
    ...rows.map((p) =>
      env.DB.prepare(
        'INSERT INTO reference_prices(asset,time,value,fetched_at) VALUES(?,?,?,?) ON CONFLICT(asset,time) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at WHERE reference_prices.value!=excluded.value',
      ).bind(asset, p.time, p.value, now),
    ),
    catchingUp
      ? env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)').bind(
          progressKey,
          JSON.stringify({ cursor, nextPageToken: token || null, fetchedAt: now }),
        )
      : env.DB.prepare('DELETE FROM state WHERE key=?').bind(progressKey),
    // Collector success and actual valid-price date are distinct: a null-only
    // page cannot turn its last calendar date into a fresh market observation.
    env.DB.prepare(
      'INSERT INTO ingestion(key,last_attempt,last_success,data_as_of,failures,error,next_attempt) VALUES(?,?,?,?,0,NULL,?) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,data_as_of=excluded.data_as_of,failures=0,error=NULL,next_attempt=excluded.next_attempt',
    ).bind(key, now, now, asOf || null, catchingUp ? now + 60 : 0),
  ]);
}
