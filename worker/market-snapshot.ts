import { ASSETS } from '../shared/catalog';
import type { MarketSnapshot, MarketRow } from '../shared/market-snapshot';
import type { Market, Quote } from '../shared/types';
import { epoch, type Env } from './storage';

/** Bounded reads only: no providers, lease acquisition or cache writes. */
export async function marketSnapshot(env: Env, market: Market): Promise<MarketSnapshot> {
  const now = epoch();
  const keys = ASSETS.map((a) => `quote:${a.id}:${market}`);
  const snapshots = (
    await env.DB.prepare(
      `SELECT key,data,fetched_at FROM snapshots WHERE key IN (${keys.map(() => '?').join(',')})`,
    )
      .bind(...keys)
      .all<{ key: string; data: string; fetched_at: number }>()
  ).results;
  const failed = new Set(
    (
      await env.DB.prepare(
        `SELECT key FROM ingestion WHERE key IN (${keys.map(() => '?').join(',')}) AND (error IS NOT NULL OR failures>0)`,
      )
        .bind(...keys)
        .all<{ key: string }>()
    ).results.map((row) => row.key),
  );
  const rows = await Promise.all(
    ASSETS.map(async ({ id }): Promise<MarketRow> => {
      const stored = snapshots.find((s) => s.key === `quote:${id}:${market}`);
      let quote: Quote | null = null;
      let invalid = false;
      if (stored) {
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
      const spark = (
        await env.DB.prepare(
          "SELECT time,close AS value FROM candles WHERE asset=? AND market=? AND interval='1d' AND close_time<=? ORDER BY time DESC LIMIT 30",
        )
          .bind(id, market, now)
          .all<{ time: number; value: number }>()
      ).results.reverse();
      return {
        asset: id,
        quote,
        fetchedAt: stored?.fetched_at ?? null,
        spark,
        status:
          invalid || failed.has(`quote:${id}:${market}`)
            ? 'error'
            : !quote
              ? 'pending'
              : now - quote.time > 300 || now - stored!.fetched_at > 300
                ? 'delayed'
                : 'ready',
      };
    }),
  );
  return { market, currency: market === 'upbit' ? 'KRW' : 'USDT', asOf: now, rows };
}
