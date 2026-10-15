import { derivativeBackfillLimit } from './backfill-budget';
import {
  DERIVATIVE_ASSETS,
  DERIVATIVE_METRICS,
  derivativeAsset,
  derivativeMetric,
  updateDerivatives,
  type DerivativeAsset,
  type DerivativeMetric,
} from './derivatives';
import {
  claimRefresh,
  epoch,
  readState,
  putState,
  refreshLeaseStatement,
  type Env,
} from './storage';

export const OPERATOR_LEASE = 'derivatives-history-operator';
export const OPERATOR_CHECKPOINT = 'history-operator:derivatives:checkpoint';
export const historyPartitions = () =>
  (
    [
      'funding',
      'open_interest_daily',
      'long_account_ratio_daily',
      'open_interest',
      'long_account_ratio',
    ] as const
  ).flatMap((metric) =>
    DERIVATIVE_ASSETS.map((asset) => ({ asset, metric, key: `derivatives:${asset}:${metric}` })),
  );

export async function claimOperatorLease(env: Env) {
  derivativeBackfillLimit(env, epoch());
  if (!env.DERIVATIVE_HISTORY_GRANT) throw new Error('Private recovery grant required');
  const now = epoch(),
    expiresAt = now + 55;
  const result = await refreshLeaseStatement(env.DB, OPERATOR_LEASE, 55, now).run();
  return result.meta.changes ? expiresAt : null;
}

/** CAS renewal/release prevents an expired runner from replacing its successor. */
export async function renewOperatorLease(env: Env, previousExpiry: number) {
  const now = epoch();
  derivativeBackfillLimit(env, now);
  if (previousExpiry <= now) return null;
  const expiresAt = now + 55;
  const result = await env.DB.prepare('UPDATE state SET value=? WHERE key=? AND value=?')
    .bind(String(expiresAt), 'lease:' + OPERATOR_LEASE, String(previousExpiry))
    .run();
  return result.meta.changes ? expiresAt : null;
}
export async function releaseOperatorLease(env: Env, previousExpiry: number) {
  await env.DB.prepare('DELETE FROM state WHERE key=? AND value=?')
    .bind('lease:' + OPERATOR_LEASE, String(previousExpiry))
    .run();
}

export async function derivativeHistoryInventory(env: Env) {
  const states = await env.DB.prepare(
    "SELECT key,value FROM state WHERE key LIKE 'cursor:derivatives:%' OR key LIKE 'history-complete:derivatives:%' OR key LIKE 'history-evidence:derivatives:%'",
  ).all<{ key: string; value: string }>();
  const byKey = new Map(states.results.map((row) => [row.key, JSON.parse(row.value)]));
  return historyPartitions().map((part) => ({
    ...part,
    cursor: byKey.get('cursor:' + part.key) ?? null,
    complete: byKey.get('history-complete:' + part.key) ?? null,
    evidence: byKey.get('history-evidence:' + part.key) ?? null,
  }));
}

export async function runDerivativeHistoryPage(
  env: Env,
  asset: DerivativeAsset,
  metric: DerivativeMetric,
  expectedOperatorLease?: number,
) {
  derivativeBackfillLimit(env, epoch());
  if (!env.DERIVATIVE_HISTORY_GRANT || !derivativeAsset(asset) || !derivativeMetric(metric))
    throw new Error('Invalid private history partition');
  if (env.HISTORY_ALLOWED?.() === false) return { outcome: 'paused_low_space' as const };
  const key = `derivatives:${asset}:${metric}`;
  const complete = await readState(env.DB, 'history-complete:' + key, null);
  const cursor = await readState(env.DB, 'cursor:' + key, null);
  if (complete !== null && cursor === null)
    return { outcome: 'complete' as const, candidateRows: 0 };
  const retry = await readState<{ nextAttempt: number } | null>(
    env.DB,
    'history-operator-error:' + key,
    null,
  );
  if (retry && retry.nextAttempt > epoch()) return { outcome: 'retry_wait' as const };
  // Identical key and duration to the scheduled collector; live jobs are not stopped.
  if (!(await claimRefresh(env.DB, key, 55))) return { outcome: 'partition_busy' as const };
  try {
    const result = await updateDerivatives(env, asset, metric, false, expectedOperatorLease);
    if (!result) throw new Error('History mode did not return an outcome');
    if (result.outcome === 'advanced' || result.outcome === 'complete')
      await env.DB.prepare('DELETE FROM state WHERE key=?')
        .bind('history-operator-error:' + key)
        .run();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /cursor/.test(message)
      ? 'HISTORY_CURSOR_REJECTED'
      : /Invalid derivatives|symbol mismatch/.test(message)
        ? 'HISTORY_VALIDATION_FAILED'
        : /HTTP/.test(message)
          ? 'HISTORY_SOURCE_HTTP'
          : 'HISTORY_REQUEST_FAILED';
    await putState(env.DB, 'history-operator-error:' + key, {
      code,
      at: epoch(),
      nextAttempt: epoch() + 60,
    });
    return { outcome: 'failed' as const, code };
  }
}

export const historyOperatorMetrics = DERIVATIVE_METRICS;
