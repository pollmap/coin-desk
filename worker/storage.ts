import type { Candle } from '../shared/types';
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BITVIEW_BASE_URL: string;
  ENABLED_ASSETS: string;
}
export const epoch = () => Math.floor(Date.now() / 1000);
export const QUOTE_REFRESH_SECONDS = 180;
export function refreshLeaseStatement(db: D1Database, key: string, seconds: number, now = epoch()) {
  return db
    .prepare(
      'INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(state.value AS INTEGER)<=?',
    )
    .bind('lease:' + key, String(now + seconds), now);
}
/** One bounded upstream refresh across concurrent requests and edge locations.
 * A rejected claim changes zero rows. Expiry also recovers abandoned refreshes.
 */
export async function claimRefresh(db: D1Database, key: string, seconds: number) {
  const now = epoch();
  const result = await refreshLeaseStatement(db, key, seconds, now).run();
  return result.meta.changes > 0;
}
export async function readState<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db
    .prepare('SELECT value FROM state WHERE key=?')
    .bind(key)
    .first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : fallback;
}
export async function putState(db: D1Database, key: string, value: unknown) {
  await db
    .prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)')
    .bind(key, JSON.stringify(value))
    .run();
}
export function dbCandle(r: Record<string, number>): Candle {
  return {
    time: r.time,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    closeTime: r.close_time,
    closed: r.close_time <= epoch(),
  };
}
export async function success(db: D1Database, key: string, asOf: number) {
  const now = epoch();
  await successStatement(db, key, asOf, now).run();
}
export function successStatement(db: D1Database, key: string, asOf: number, now = epoch()) {
  return db
    .prepare(
      'INSERT INTO ingestion(key,last_attempt,last_success,data_as_of,failures,error,next_attempt) VALUES (?,?,?,?,0,NULL,0) ON CONFLICT(key) DO UPDATE SET last_attempt=?,last_success=?,data_as_of=?,failures=0,error=NULL,next_attempt=0',
    )
    .bind(key, now, now, asOf, now, now, asOf);
}
export async function failure(db: D1Database, key: string, error: unknown) {
  const now = epoch();
  const previous = await db
    .prepare('SELECT failures FROM ingestion WHERE key=?')
    .bind(key)
    .first<{ failures: number }>();
  const failures = (previous?.failures || 0) + 1;
  const next = now + Math.min(3600, 60 * 2 ** Math.min(failures, 6));
  await db
    .prepare(
      'INSERT INTO ingestion(key,last_attempt,error,failures,next_attempt) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET last_attempt=?,error=?,failures=?,next_attempt=?',
    )
    .bind(
      key,
      now,
      String(error).slice(0, 200),
      failures,
      next,
      now,
      String(error).slice(0, 200),
      failures,
      next,
    )
    .run();
}
