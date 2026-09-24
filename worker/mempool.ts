import { upstream } from './providers';
import { feedRequest } from './feed-client';
import { epoch, successStatement, type Env } from './storage';

export interface MempoolSnapshot {
  count: number;
  vsize: number;
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  observedAt: number;
  source: 'mempool.space';
}
const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function parseMempool(
  mempool: unknown,
  fees: unknown,
  observedAt = epoch(),
): MempoolSnapshot {
  const pool = mempool as Record<string, unknown>;
  const rate = fees as Record<string, unknown>;
  if (
    !pool ||
    !rate ||
    ![
      pool.count,
      pool.vsize,
      rate.fastestFee,
      rate.halfHourFee,
      rate.hourFee,
      rate.economyFee,
    ].every(positive)
  )
    throw new Error('Invalid mempool snapshot');
  return {
    count: Number(pool.count),
    vsize: Number(pool.vsize),
    fastestFee: Number(rate.fastestFee),
    halfHourFee: Number(rate.halfHourFee),
    hourFee: Number(rate.hourFee),
    economyFee: Number(rate.economyFee),
    observedAt,
    source: 'mempool.space',
  };
}

export async function updateMempool(env: Env) {
  const [pool, fees] =
    env.FEED_URL && env.FEED_TOKEN
      ? await (async () => {
          const raw = (await feedRequest(env, '/mempool')) as { pool: unknown; fees: unknown };
          return [raw.pool, raw.fees];
        })()
      : await Promise.all([
          upstream('https://mempool.space/api/mempool'),
          upstream('https://mempool.space/api/v1/fees/recommended'),
        ]);
  const snapshot = parseMempool(pool, fees);
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO snapshots(key,data,fetched_at) VALUES(?,?,?)').bind(
      'mempool:BTC',
      JSON.stringify(snapshot),
      snapshot.observedAt,
    ),
    successStatement(env.DB, 'mempool:BTC', snapshot.observedAt),
  ]);
}
