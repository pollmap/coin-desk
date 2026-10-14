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
  const recentRequest = env.DB.prepare(
    'SELECT * FROM candles WHERE asset=? AND market=? AND interval=? AND time>=? AND time<? ORDER BY time LIMIT ?',
  )
    .bind(asset, market, interval, from, to, cap)
    .all<Record<string, number>>();
  const combined = new Map<number, Record<string, number>>();
  // Archives contain AT MOST 256 points. A restored or partially filled chunk
  // can be smaller, so a fixed chunk count must not silently end the history.
  const chunkLimit = Math.ceil(cap / 256) + 1;
  let cursor = -1;
  for (let read = 0; read <= cap; read += chunkLimit) {
    const archived = await env.DB.prepare(
      'SELECT start,data,fetched_at FROM price_archive WHERE asset=? AND market=? AND interval=? AND end>? AND start<? AND start>? ORDER BY start LIMIT ?',
    )
      .bind(asset, market, interval, from, to, cursor, chunkLimit)
      .all<{ start: number; data: string; fetched_at: number }>();
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
    if (archived.results.length < chunkLimit || combined.size >= cap) break;
    const next = archived.results.at(-1)!.start;
    if (!Number.isSafeInteger(next) || next <= cursor)
      throw new Error('Price archive cursor did not advance');
    cursor = next;
    if (read + chunkLimit > cap) throw new Error('Price archive scan exceeded the bounded page');
  }
  const recent = await recentRequest;
  for (const row of recent.results) combined.set(row.time, row);
  return [...combined.values()].sort((a, b) => a.time - b.time).slice(0, cap);
}

/** Recover metadata from both stores when an older import has no history state. */
export function candleExtent(env: Env, asset: Asset, market: Market, interval: string) {
  return env.DB.prepare(
    `SELECT MIN(first) AS first,MAX(last) AS last,MAX(fetched) AS fetched FROM (
      SELECT MIN(time) AS first,MAX(time) AS last,MAX(fetched_at) AS fetched
      FROM candles WHERE asset=? AND market=? AND interval=?
      UNION ALL
      SELECT MIN(json_extract(data,'$[0][0]')) AS first,
             MAX(json_extract(data,'$[#-1][0]')) AS last,MAX(fetched_at) AS fetched
      FROM price_archive WHERE asset=? AND market=? AND interval=?
    )`,
  )
    .bind(asset, market, interval, asset, market, interval)
    .first<{ first: number | null; last: number | null; fetched: number | null }>();
}
