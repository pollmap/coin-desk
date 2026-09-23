import type { Asset, Point, SeriesResponse } from '../shared/types';
import { DAY } from '../shared/math';
import { upstream } from './providers';
import { epoch, readState, successStatement, type Env } from './storage';

export const DERIVATIVE_ASSETS = ['BTC', 'DOGE', 'ETH'] as const;
export const DERIVATIVE_METRICS = ['funding', 'open_interest'] as const;
export type DerivativeAsset = (typeof DERIVATIVE_ASSETS)[number];
export type DerivativeMetric = (typeof DERIVATIVE_METRICS)[number];
export const DERIVATIVE_VERSION = 'binance-usdt-perpetual-v1';
const origin = 'https://fapi.binance.com';
const initialFunding = Date.parse('2019-01-01T00:00:00Z');
const key = (asset: Asset, metric: string) => `derivatives:${asset}:${metric}`;
export const derivativeAsset = (asset: Asset): asset is DerivativeAsset =>
  DERIVATIVE_ASSETS.some((item) => item === asset);
export const derivativeMetric = (metric: string): metric is DerivativeMetric =>
  DERIVATIVE_METRICS.some((item) => item === metric);

export function parseDerivativeRows(
  input: unknown,
  asset: DerivativeAsset,
  metric: DerivativeMetric,
  now = epoch(),
): Point[] {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Invalid derivatives response');
  const points: Point[] = [];
  let previous = -1;
  for (const candidate of input) {
    if (!candidate || typeof candidate !== 'object') throw new Error('Invalid derivatives row');
    const row = candidate as Record<string, unknown>;
    if (row.symbol !== asset + 'USDT') throw new Error('Derivatives symbol mismatch');
    const milliseconds = Number(metric === 'funding' ? row.fundingTime : row.timestamp);
    const raw = Number(metric === 'funding' ? row.fundingRate : row.sumOpenInterestValue);
    if (
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < 0 ||
      milliseconds <= previous ||
      milliseconds > (now + 60) * 1000 ||
      !Number.isFinite(raw) ||
      (metric === 'open_interest' && raw < 0) ||
      (metric === 'funding' && Math.abs(raw) > 1)
    )
      throw new Error('Invalid derivatives observation');
    previous = milliseconds;
    points.push({
      time: Math.floor(milliseconds / 1000),
      value: metric === 'funding' ? raw * 100 : raw,
    });
  }
  return points;
}

/** One bounded page per scheduled run; a saved cursor continues initial history and outages. */
export async function updateDerivatives(
  env: Env,
  asset: DerivativeAsset,
  metric: DerivativeMetric,
) {
  const now = epoch();
  const id = key(asset, metric);
  const coverage = await env.DB.prepare(
    'SELECT MIN(time) AS first,MAX(time) AS last FROM derivative_series WHERE asset=? AND metric=?',
  )
    .bind(asset, metric)
    .first<{ first: number | null; last: number | null }>();
  const cursor = await readState<number | null>(env.DB, 'cursor:' + id, null);
  const initial = metric === 'funding' ? initialFunding : (now - 30 * DAY) * 1000;
  const recentThreshold = metric === 'funding' ? 12 * 3600 : 2 * 3600;
  const overlap = metric === 'funding' ? 2 * DAY : DAY;
  const start =
    cursor ??
    (coverage?.last && now - coverage.last < recentThreshold
      ? Math.max(initial, (coverage.last - overlap) * 1000)
      : coverage?.last
        ? (coverage.last + 1) * 1000
        : initial);
  if (!Number.isSafeInteger(start) || start < 0 || start > (now + 60) * 1000)
    throw new Error('Invalid derivatives cursor');
  const size = 500;
  const params = new URLSearchParams({
    symbol: asset + 'USDT',
    startTime: String(start),
    limit: String(size),
  });
  if (metric === 'open_interest') params.set('period', '1h');
  const path = metric === 'funding' ? '/fapi/v1/fundingRate' : '/futures/data/openInterestHist';
  const raw = await upstream(origin + path + '?' + params);
  const points = parseDerivativeRows(raw, asset, metric, now);
  if (!points.length && !coverage?.last) throw new Error('No derivatives history available');
  const fetched = epoch();
  const statements: D1PreparedStatement[] = points.map((point) =>
    env.DB.prepare(
      'INSERT INTO derivative_series(asset,metric,time,value,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(asset,metric,time) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at WHERE derivative_series.value<>excluded.value',
    ).bind(asset, metric, point.time, point.value, fetched),
  );
  const last = Math.max(coverage?.last ?? 0, points.at(-1)?.time ?? 0);
  const more = points.length === size && last < now - (metric === 'funding' ? 4 * 3600 : 3600);
  if (more)
    statements.push(
      env.DB.prepare(
        'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ).bind('cursor:' + id, JSON.stringify(points.at(-1)!.time * 1000 + 1)),
    );
  else statements.push(env.DB.prepare('DELETE FROM state WHERE key=?').bind('cursor:' + id));
  statements.push(successStatement(env.DB, id, last, fetched));
  if (more)
    statements.push(
      env.DB.prepare('UPDATE ingestion SET next_attempt=? WHERE key=?').bind(fetched + 60, id),
    );
  statements.push(
    env.DB.prepare(
      'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
    ).bind(id, 'Binance USDⓈ-M Futures', fetched, JSON.stringify((raw as unknown[]).slice(0, 100))),
  );
  for (let i = 0; i < statements.length; i += 40) await env.DB.batch(statements.slice(i, i + 40));
}

export async function readDerivativeSeries(
  db: D1Database,
  asset: DerivativeAsset,
  metric: DerivativeMetric,
  from: number,
  to: number,
  limit: number,
): Promise<SeriesResponse> {
  const [rows, extent, state] = await Promise.all([
    db
      .prepare(
        'SELECT time,value FROM derivative_series WHERE asset=? AND metric=? AND time>=? AND time<? ORDER BY time LIMIT ?',
      )
      .bind(asset, metric, from, to, limit + 1)
      .all<Point>(),
    db
      .prepare(
        'SELECT MIN(time) AS first,MAX(time) AS last FROM derivative_series WHERE asset=? AND metric=?',
      )
      .bind(asset, metric)
      .first<{ first: number | null; last: number | null }>(),
    db
      .prepare('SELECT last_success,error FROM ingestion WHERE key=?')
      .bind(key(asset, metric))
      .first<{ last_success: number | null; error: string | null }>(),
  ]);
  const data = rows.results.slice(0, limit);
  const age = metric === 'funding' ? 36 * 3600 : 3 * 3600;
  return {
    data,
    price: [],
    range: { from, to },
    nextCursor: rows.results.length > limit ? data.at(-1)!.time + 1 : null,
    meta: {
      source: 'Binance USDⓈ-M Futures',
      unit: metric === 'funding' ? '%' : 'USDT',
      market: asset + 'USDT perpetual · Binance only',
      dataAsOf: extent?.last ?? null,
      fetchedAt: state?.last_success ?? null,
      historyStart: extent?.first ?? null,
      stale: !extent?.last || nowSeconds() - extent.last > age || !!state?.error,
      calculationVersion: DERIVATIVE_VERSION,
      warning:
        !extent?.last && state?.error
          ? 'Binance 선물 API가 배포 서버의 요청을 차단하여 실제 관측을 아직 확보하지 못했습니다. 원천 연결 대기 중이며 추정값을 표시하지 않습니다.'
          : state?.error
            ? '선물 원천 갱신이 지연되어 마지막 정상 관측을 표시합니다.'
            : metric === 'open_interest'
              ? '미결제약정의 최초 확보 범위는 Binance가 제공하는 최근 약 1개월입니다. 이후 관측은 서버가 축적합니다.'
              : '펀딩비는 Binance 한 거래소의 실제 정산 비율입니다.',
    },
  };
}
const nowSeconds = epoch;
