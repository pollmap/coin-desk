import { DAY } from '../shared/math';

// Reserve input observations, not queries. Index writes and live collectors need headroom.
// This is a conservative derivatives-only budget, not a guarantee of account-wide D1 usage.
export const DERIVATIVE_BACKFILL_DAILY_ROWS = 10_000;
export async function reserveDerivativeBackfill(db: D1Database, rows: number, now: number) {
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > DERIVATIVE_BACKFILL_DAILY_ROWS)
    throw new Error('Invalid backfill reservation');
  const day = Math.floor(now / DAY);
  const result = await db
    .prepare(
      "INSERT INTO state(key,value) VALUES('budget:derivatives-backfill',json_object('day',?,'reserved',?)) ON CONFLICT(key) DO UPDATE SET value=json_object('day',?,'reserved',CASE WHEN json_extract(state.value,'$.day')=? THEN json_extract(state.value,'$.reserved')+? ELSE ? END) WHERE json_extract(state.value,'$.day')<>? OR json_extract(state.value,'$.reserved')+?<=?",
    )
    .bind(day, rows, day, day, rows, rows, day, rows, DERIVATIVE_BACKFILL_DAILY_ROWS)
    .run();
  return result.meta.changes > 0;
}
