import { ASSETS } from '../shared/catalog';
import { assetDefinition } from '../shared/asset-registry';
import { matchesCoin } from '../shared/coin-search';
import type { MarketSnapshot, MarketRow } from '../shared/market-snapshot';
import type { Market, Quote } from '../shared/types';
import { epoch, type Env } from './storage';

/** Bounded reads only. Spark histories share one indexed query for the visible page. */
export async function marketSnapshot(
  env: Env,
  market: Market,
  query = new URLSearchParams(),
): Promise<MarketSnapshot> {
  const now = epoch(),
    enabled = new Set(env.ENABLED_ASSETS.split(','));
  const requested = query.has('assets') ? new Set(query.get('assets')!.split(',')) : null;
  const selection = ASSETS.filter(
    (a) =>
      enabled.has(a.id) &&
      (!requested || requested.has(a.id)) &&
      matchesCoin(a.id, query.get('q') ?? '') &&
      (query.get('supported') !== '1' || assetDefinition(a.id)?.markets[market]),
  );
  const keys = selection.map((a) => `quote:${a.id}:${market}`);
  if (!keys.length)
    return { market, currency: market === 'upbit' ? 'KRW' : 'USDT', asOf: now, rows: [], total: 0 };
  const slots = keys.map(() => '?').join(',');
  const snapshots = (
    await env.DB.prepare(`SELECT key,data,fetched_at FROM snapshots WHERE key IN (${slots})`)
      .bind(...keys)
      .all<{ key: string; data: string; fetched_at: number }>()
  ).results;
  const storedByKey = new Map(snapshots.map((s) => [s.key, s]));
  const failed = new Set(
    (
      await env.DB.prepare(
        `SELECT key FROM ingestion WHERE key IN (${slots}) AND (error IS NOT NULL OR failures>0)`,
      )
        .bind(...keys)
        .all<{ key: string }>()
    ).results.map((row) => row.key),
  );
  let rows: MarketRow[] = selection.map(({ id }) => {
    const stored = storedByKey.get(`quote:${id}:${market}`);
    let quote: Quote | null = null,
      invalid = false;
    const supported = !!assetDefinition(id)?.markets[market];
    if (stored && supported) {
      try {
        const q = JSON.parse(stored.data) as Quote;
        if (
          q.asset !== id ||
          !Number.isFinite(q.price) ||
          q.price <= 0 ||
          !Number.isFinite(q.time) ||
          q.time <= 0 ||
          q.time > now + 60 ||
          !Number.isFinite(q.volume24h) ||
          q.volume24h < 0 ||
          (q.change24h !== null && (!Number.isFinite(q.change24h) || q.change24h <= -100))
        )
          throw new Error('Invalid quote');
        quote = q;
      } catch {
        invalid = true;
      }
    }
    return {
      asset: id,
      quote,
      fetchedAt: stored?.fetched_at ?? null,
      spark: [],
      status: !supported
        ? 'unsupported'
        : invalid || failed.has(`quote:${id}:${market}`)
          ? 'error'
          : !quote
            ? 'pending'
            : now - quote.time > 300 || now - stored!.fetched_at > 300
              ? 'delayed'
              : 'ready',
    };
  });
  if (['volume', 'change'].includes(query.get('sort') ?? '')) {
    const key = query.get('sort') === 'volume' ? 'volume24h' : 'change24h';
    rows.sort((a, b) => (b.quote?.[key] ?? -Infinity) - (a.quote?.[key] ?? -Infinity));
  }
  const total = rows.length;
  const offset = Math.min(total, Math.max(0, Number(query.get('offset')) || 0));
  const limit = Math.min(150, Math.max(1, Number(query.get('limit')) || 150));
  rows = rows.slice(offset, offset + limit);
  const sparkLimit = Math.min(
    rows.length,
    Math.max(0, query.has('spark_limit') ? Number(query.get('spark_limit')) || 0 : rows.length),
  );
  const sparkAssets = rows
    .slice(0, sparkLimit)
    .filter((r) => r.status !== 'unsupported')
    .map((r) => r.asset);
  if (sparkAssets.length) {
    const points = (
      await env.DB.prepare(
        `SELECT asset,time,close AS value FROM candles WHERE asset IN (${sparkAssets.map(() => '?').join(',')}) AND market=? AND interval='1d' AND close_time<=? AND time>=? ORDER BY asset,time`,
      )
        .bind(...sparkAssets, market, now, now - 31 * 86400)
        .all<{ asset: string; time: number; value: number }>()
    ).results;
    const grouped = new Map<string, { time: number; value: number }[]>();
    for (const p of points) {
      const values = grouped.get(p.asset) ?? [];
      values.push({ time: p.time, value: p.value });
      grouped.set(p.asset, values);
    }
    rows.forEach((r) => {
      r.spark = (grouped.get(r.asset) ?? []).slice(-30);
    });
  }
  return {
    market,
    currency: market === 'upbit' ? 'KRW' : 'USDT',
    asOf: now,
    rows,
    total,
    offset,
    limit,
  };
}
