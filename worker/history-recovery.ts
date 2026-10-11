import {
  derivativeAsset,
  derivativeMetric,
  parseDerivativeRows,
  type DerivativeMetric,
} from './derivatives';
import { reserveDerivativeBackfill } from './backfill-budget';
import { feedRequest } from './feed-client';
import { epoch, type Env } from './storage';
import type { Asset } from '../shared/types';

/** Operator-only, bounded gap repair. Never advances recent success or historical cursors. */
export async function recoverDerivativeGap(
  env: Env,
  asset: Asset,
  metric: DerivativeMetric,
  from: number,
  to: number,
  apply = false,
) {
  const now = epoch();
  const step = metric.endsWith('_daily') ? 86400 : 3600;
  if (
    !derivativeAsset(asset) ||
    !derivativeMetric(metric) ||
    metric === 'funding' ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from <= 0 ||
    to <= from ||
    to > now ||
    from % step ||
    to % step ||
    (to - from) / step > 198
  )
    throw new Error('Invalid bounded recovery range');
  if (apply && env.HISTORY_ALLOWED?.() === false)
    return { asset, metric, from, to, outcome: 'paused_low_space', inserted: 0 };
  const limit = Math.min(200, (to - from) / step + 2);
  if (apply && !(await reserveDerivativeBackfill(env.DB, limit, now)))
    return { asset, metric, from, to, outcome: 'paused_daily_budget', inserted: 0 };
  const raw = await feedRequest(
    env,
    '/derivatives',
    new URLSearchParams({ asset, metric, limit: String(limit), endTime: String(to * 1000 - 1) }),
  );
  const points = parseDerivativeRows(raw, asset, metric, now).filter(
    (p) => p.time >= from && p.time < to,
  );
  if (points.some((p) => p.time % step)) throw new Error('Unexpected recovery observation cadence');
  const existing = (
    await env.DB.prepare(
      'SELECT time FROM derivative_series WHERE asset=? AND metric=? AND time>=? AND time<?',
    )
      .bind(asset, metric, from, to)
      .all<{ time: number }>()
  ).results;
  const observed = new Set(existing.map((p) => p.time));
  const missing = points.filter((p) => !observed.has(p.time));
  if (apply && missing.length) {
    const result = await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO derivative_series(asset,metric,time,value,fetched_at) SELECT ?,?,CAST(json_extract(value,'$.time') AS INTEGER),json_extract(value,'$.value'),? FROM json_each(?)",
      ).bind(asset, metric, now, JSON.stringify(missing)),
      env.DB.prepare(
        'INSERT OR IGNORE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
      ).bind(
        `recovery:${asset}:${metric}:${from}:${to}:${now}`,
        'Bybit V5 bounded gap recovery',
        now,
        JSON.stringify(raw),
      ),
    ]);
    return {
      asset,
      metric,
      from,
      to,
      checkedAt: now,
      outcome: 'recovered',
      sourceObservations: points.length,
      inserted: result[0].meta.changes,
      remainingSlots:
        (to - from) / step - new Set([...observed, ...points.map((p) => p.time)]).size,
    };
  }
  return {
    asset,
    metric,
    from,
    to,
    checkedAt: now,
    outcome: missing.length
      ? 'recoverable'
      : points.length
        ? 'already_present'
        : 'provider_no_observation_at_check',
    sourceObservations: points.length,
    inserted: 0,
    remainingSlots: (to - from) / step - observed.size,
  };
}
