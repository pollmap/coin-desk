import type { Asset, Market } from '../shared/types';
import type { Env } from './storage';

/** Merge bounded archive pages with mutable candles; source corrections win. */
export async function candleHistory(
  env: Env,
  asset: Asset,
  market: Market,
  interval: string,
  from: number,
  to: number,
  cap: number,
) {
  const [recent, archived] = await Promise.all([
    env.DB.prepare(
      'SELECT * FROM candles WHERE asset=? AND market=? AND interval=? AND time>=? AND time<? ORDER BY time LIMIT ?',
    )
      .bind(asset, market, interval, from, to, cap)
      .all<Record<string, number>>(),
    env.DB.prepare(
      'SELECT data,fetched_at FROM price_archive WHERE asset=? AND market=? AND interval=? AND end>? AND start<? ORDER BY start LIMIT ?',
    )
      .bind(asset, market, interval, from, to, Math.ceil(cap / 256) + 1)
      .all<{ data: string; fetched_at: number }>(),
  ]);
  const combined = new Map<number, Record<string, number>>();
  for (const chunk of archived.results)
    for (const c of JSON.parse(chunk.data) as number[][]) {
      const [time, open, high, low, close, volume, close_time] = c;
      if (time >= from && time < to)
        combined.set(time, {
          time,
          open,
          high,
          low,
          close,
          volume,
          close_time,
          fetched_at: chunk.fetched_at,
        });
    }
  for (const row of recent.results) combined.set(row.time, row);
  return [...combined.values()].sort((a, b) => a.time - b.time).slice(0, cap);
}
