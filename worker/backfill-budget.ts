import { DAY } from '../shared/math';

// Reserve input observations, not queries. Index writes and live collectors need headroom.
// This is a conservative derivatives-only budget, not a guarantee of account-wide D1 usage.
export const DERIVATIVE_BACKFILL_DAILY_ROWS = 10_000;
export interface DerivativeRecoveryGrant {
  kind: 'operator-recovery-v1';
  id: string;
  issuedAt: number;
  expiresAt: number;
  dailyRows: number;
}
export interface DerivativeRecoveryAuthorization {
  RUNTIME_KIND?: 'vps' | 'cloudflare';
  READ_ONLY_API?: boolean;
  DERIVATIVE_HISTORY_GRANT?: DerivativeRecoveryGrant;
}

/** Explicit private operator authorization only; no environment/default or HTTP option. */
export function derivativeBackfillLimit(auth: DerivativeRecoveryAuthorization, now: number) {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid backfill clock');
  const grant = auth.DERIVATIVE_HISTORY_GRANT;
  if (!grant) return DERIVATIVE_BACKFILL_DAILY_ROWS;
  if (
    auth.RUNTIME_KIND !== 'vps' ||
    auth.READ_ONLY_API !== false ||
    grant.kind !== 'operator-recovery-v1' ||
    !/^[a-z0-9][a-z0-9-]{7,63}$/.test(grant.id) ||
    !Number.isSafeInteger(grant.issuedAt) ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.issuedAt > now ||
    grant.expiresAt <= now ||
    grant.expiresAt <= grant.issuedAt ||
    grant.expiresAt - grant.issuedAt > DAY ||
    !Number.isSafeInteger(grant.dailyRows) ||
    grant.dailyRows <= DERIVATIVE_BACKFILL_DAILY_ROWS ||
    grant.dailyRows > 1_000_000
  )
    throw new Error('Invalid or expired private derivative recovery grant');
  return grant.dailyRows;
}

export async function reserveDerivativeBackfill(
  db: D1Database,
  rows: number,
  now: number,
  auth: DerivativeRecoveryAuthorization = {},
) {
  const limit = derivativeBackfillLimit(auth, now);
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > limit)
    throw new Error('Invalid backfill reservation');
  const day = Math.floor(now / DAY);
  const result = await db
    .prepare(
      "INSERT INTO state(key,value) VALUES('budget:derivatives-backfill',json_object('day',?,'reserved',?)) ON CONFLICT(key) DO UPDATE SET value=json_object('day',?,'reserved',CASE WHEN json_extract(state.value,'$.day')=? THEN json_extract(state.value,'$.reserved')+? ELSE ? END) WHERE json_extract(state.value,'$.day')<>? OR json_extract(state.value,'$.reserved')+?<=?",
    )
    .bind(day, rows, day, day, rows, rows, day, rows, limit)
    .run();
  return result.meta.changes > 0;
}
