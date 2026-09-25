import { ASSETS, isPrimaryAsset } from '../shared/catalog';
import { DAY } from '../shared/math';
import type { Asset, Market } from '../shared/types';
import { epoch, QUOTE_REFRESH_SECONDS, type Env } from './storage';
import { REFERENCE_ASSETS } from './reference-price';
import { NETWORK_ASSETS, networkMetrics } from '../shared/network-catalog';
import { DERIVATIVE_ASSETS, DERIVATIVE_METRICS } from './derivatives';

export const BACKGROUND_QUOTE_SECONDS = 60;
export const DAILY_REFRESH_SECONDS = 3600;
export interface IngestionState {
  key: string;
  last_attempt: number | null;
  last_success: number | null;
  data_as_of: number | null;
  next_attempt: number;
  error: string | null;
  failures: number;
}
export interface JobPolicy {
  key: string;
  kind:
    | 'quote-batch'
    | 'price'
    | 'onchain'
    | 'dominance'
    | 'stablecoins'
    | 'maintenance'
    | 'reference'
    | 'network'
    | 'derivatives'
    | 'mempool';
  every: number;
  maxLag: number;
  assets?: Asset[];
  market?: Market;
  interval?: '1h' | '1d';
}
export interface CronState {
  run_id: string;
  last_tick: number;
  last_started: number;
  last_completed: number | null;
  last_succeeded: number | null;
  lease_until: number;
  job: string | null;
  outcome: string;
  error: string | null;
}
export const cleanError = (error: unknown) =>
  error
    ? String(error).match(/(?:HTTP|API)\s+\d{3}/)?.[0] || '원천 연결 또는 데이터 검증 오류'
    : null;
export function enabledAssets(env: Pick<Env, 'ENABLED_ASSETS'>): Asset[] {
  return ASSETS.filter((a) => env.ENABLED_ASSETS.split(',').includes(a.id)).map((a) => a.id);
}
export function jobPolicies(assets: Asset[], rebuilding: boolean): JobPolicy[] {
  const jobs: JobPolicy[] = [
    { key: 'bitview', kind: 'onchain', every: rebuilding ? 60 : 3600, maxLag: 3 * DAY },
    { key: 'defillama', kind: 'stablecoins', every: 21600, maxLag: 3 * DAY },
    { key: 'coinlore', kind: 'dominance', every: 3600, maxLag: 7200 },
    { key: 'maintenance', kind: 'maintenance', every: 3600, maxLag: 7200 },
    { key: 'mempool:BTC', kind: 'mempool', every: 900, maxLag: 1800 },
  ];
  for (const asset of DERIVATIVE_ASSETS)
    if (assets.includes(asset))
      for (const metric of DERIVATIVE_METRICS)
        jobs.push({
          key: `derivatives:${asset}:${metric}`,
          kind: 'derivatives',
          every: metric.endsWith('_daily') ? 3600 : isPrimaryAsset(asset) ? 300 : 21600,
          maxLag: metric.endsWith('_daily')
            ? 3 * DAY
            : metric === 'funding'
              ? 36 * 3600
              : isPrimaryAsset(asset)
                ? 3 * 3600
                : 12 * 3600,
          assets: [asset],
        });
  for (const asset of REFERENCE_ASSETS)
    if (assets.includes(asset))
      jobs.push({
        key: 'reference:' + asset,
        kind: 'reference',
        every: 3600,
        maxLag: 3 * DAY,
        assets: [asset],
      });
  for (const asset of NETWORK_ASSETS)
    if (assets.includes(asset))
      jobs.push({
        key: 'network:' + asset,
        kind: 'network',
        every: 3600,
        maxLag: 3 * DAY,
        assets: [asset],
      });
  for (const market of ['binance', 'upbit'] as Market[]) {
    for (let start = 0; start < assets.length; start += 8)
      jobs.push({
        key: 'quotes:' + market + ':' + start / 8,
        kind: 'quote-batch',
        every: BACKGROUND_QUOTE_SECONDS,
        maxLag: 180,
        assets: assets.slice(start, start + 8),
        market,
      });
    for (const asset of assets)
      for (const interval of ['1h', '1d'] as const)
        jobs.push({
          key: asset + ':' + market + ':' + interval,
          kind: 'price',
          every: interval === '1h' ? 3600 : DAILY_REFRESH_SECONDS,
          maxLag: interval === '1h' ? 7200 : 2 * DAY,
          assets: [asset],
          market,
          interval,
        });
  }
  return jobs;
}
export function dueAt(job: JobPolicy, states: IngestionState[], now: number) {
  const state = states.find((s) => s.key === job.key);
  if (state?.next_attempt) return state.next_attempt;
  let due = state?.last_attempt ? state.last_attempt + job.every : 0;
  if (job.kind === 'price' && job.interval === '1d' && state?.data_as_of)
    due = Math.min(due, (Math.floor(state.data_as_of / DAY) + 1) * DAY);
  if (state?.last_attempt && state.data_as_of && now - state.data_as_of > job.maxLag)
    due = Math.min(due, state.last_attempt + 60);
  if (job.kind === 'quote-batch') {
    for (const asset of job.assets!) {
      const individual = states.find((s) => s.key === 'quote:' + asset + ':' + job.market);
      if (individual?.next_attempt)
        due = Math.min(
          due,
          Math.max(individual.next_attempt, (individual.last_attempt || 0) + QUOTE_REFRESH_SECONDS),
        );
    }
  }
  return due;
}
export function selectJob(jobs: JobPolicy[], states: IngestionState[], now: number) {
  const eligible = jobs
    .map((job) => ({ job, due: dueAt(job, states, now) }))
    .filter((item) => item.due <= now)
    .sort((a, b) => a.due - b.due);
  // Production quotes use a separate lane. Prioritize healthy primary-asset jobs
  // without letting a failing source monopolize the recovery queue.
  return (
    eligible.find(
      ({ job }) =>
        job.kind === 'quote-batch' &&
        job.assets?.some(
          (asset) =>
            !states.find((state) => state.key === `quote:${asset}:${job.market}`)?.failures,
        ),
    ) ||
    eligible.find(
      ({ job }) =>
        job.kind === 'mempool' && !states.find((state) => state.key === job.key)?.failures,
    ) ||
    // Shared BTC/market sources must not wait behind hours of secondary backfill.
    // next_attempt still gates failures, so retries cannot run every minute.
    eligible.find(
      ({ job, due }) =>
        due <= now - 300 && ['onchain', 'dominance', 'stablecoins'].includes(job.kind),
    ) ||
    eligible.find(
      ({ job }) =>
        job.assets?.some(isPrimaryAsset) && !states.find((s) => s.key === job.key)?.failures,
    ) ||
    eligible[0]
  )?.job;
}

export async function operationStatus(env: Env) {
  const now = epoch();
  const [
    ingestion,
    historyRows,
    state,
    runs,
    observation,
    build,
    snapshots,
    onchain,
    references,
    networks,
  ] = await Promise.all([
    env.DB.prepare('SELECT * FROM ingestion ORDER BY key').all<IngestionState>(),
    env.DB.prepare("SELECT value FROM state WHERE key LIKE 'history:%'").all<{ value: string }>(),
    env.DB.prepare('SELECT * FROM cron_state WHERE id=1').first<CronState>(),
    env.DB.prepare('SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 20').all<{
      run_id: string;
      started_at: number;
      completed_at: number | null;
      job: string | null;
      outcome: string;
      error: string | null;
    }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS ticks,MIN(started_at) AS first,MAX(started_at) AS last,SUM(CASE WHEN outcome IN ('error','partial','interrupted') THEN 1 ELSE 0 END) AS failures FROM cron_runs WHERE started_at>=?",
    )
      .bind(now - 48 * 3600)
      .first<{
        ticks: number;
        first: number | null;
        last: number | null;
        failures: number | null;
      }>(),
    env.DB.prepare('SELECT value FROM state WHERE key=?').bind('onchain_build').first(),
    env.DB.prepare("SELECT key,fetched_at FROM snapshots WHERE key LIKE 'quote:%'").all<{
      key: string;
      fetched_at: number;
    }>(),
    env.DB.prepare(
      "SELECT time FROM onchain WHERE generation=(SELECT json_extract(value,'$') FROM state WHERE key='onchain_generation') ORDER BY time DESC LIMIT 1",
    ).first<{ time: number }>(),
    env.DB.prepare(
      `WITH wanted(asset) AS (VALUES${REFERENCE_ASSETS.map(() => '(?)').join(',')}) SELECT asset,(SELECT time FROM reference_prices r WHERE r.asset=wanted.asset ORDER BY time LIMIT 1) AS first,(SELECT time FROM reference_prices r WHERE r.asset=wanted.asset ORDER BY time DESC LIMIT 1) AS last FROM wanted`,
    )
      .bind(...REFERENCE_ASSETS)
      .all<{ asset: string; first: number | null; last: number | null }>(),
    env.DB.prepare(
      "SELECT asset,MIN(first) AS first,MAX(last) AS last,MIN(last) AS oldest,COUNT(*) AS metrics FROM network_coverage WHERE metric!='price' GROUP BY asset",
    ).all<{ asset: Asset; first: number; last: number; oldest: number; metrics: number }>(),
  ]);
  const assets = enabledAssets(env),
    rebuilding = !!build;
  const policies = jobPolicies(assets, rebuilding);
  const history = historyRows.results.map((row) => JSON.parse(row.value));
  const expected = new Map(
    policies.filter((j) => j.kind !== 'quote-batch').map((job) => [job.key, job]),
  );
  for (const asset of assets)
    for (const market of ['binance', 'upbit'] as Market[])
      expected.set('quote:' + asset + ':' + market, {
        key: 'quote:' + asset + ':' + market,
        kind: 'quote-batch',
        every: isPrimaryAsset(asset) ? BACKGROUND_QUOTE_SECONDS : 300,
        maxLag: isPrimaryAsset(asset) ? 180 : 600,
        market,
        assets: [asset],
      });
  const sourceKeys = new Set([...expected.keys(), ...ingestion.results.map((s) => s.key)]);
  const sources = [...sourceKeys].map((key) => {
    const row = ingestion.results.find((s) => s.key === key);
    const policy = expected.get(key);
    const active = !!policy;
    const network = key.startsWith('network:')
      ? networks.results.find((row) => key === 'network:' + row.asset)
      : null;
    const expectedMetrics =
      policy?.kind === 'network' ? networkMetrics(policy.assets![0]).length : 0;
    const collectorAgeSeconds = row?.last_success ? Math.max(0, now - row.last_success) : null;
    const dataAgeSeconds = row?.data_as_of
      ? Math.max(0, now - Math.min(row.data_as_of, network?.oldest ?? row.data_as_of))
      : null;
    const collectorLimit =
      policy?.kind === 'quote-batch' ? 600 : Math.max(7200, (policy?.every || 3600) + 3600);
    const status = !active
      ? 'inactive'
      : !row?.last_success ||
          !row.data_as_of ||
          (expectedMetrics > 0 && (network?.metrics ?? 0) < expectedMetrics)
        ? 'missing'
        : row.error
          ? 'error'
          : collectorAgeSeconds! > collectorLimit || dataAgeSeconds! > policy.maxLag
            ? 'delayed'
            : 'ok';
    const coverage = key.startsWith('network:')
      ? network
      : key.startsWith('reference:')
        ? references.results.find((r) => key === 'reference:' + r.asset)
        : history.find((h) => key === h.asset + ':' + h.market + ':' + h.interval);
    return {
      ...row,
      key,
      last_attempt: row?.last_attempt ?? null,
      last_success: row?.last_success ?? null,
      data_as_of: row?.data_as_of ?? null,
      next_attempt: row?.next_attempt ?? 0,
      failures: row?.failures ?? 0,
      active,
      error: cleanError(row?.error),
      status,
      collectorAgeSeconds,
      dataAgeSeconds,
      liveStale: key.startsWith('quote:') && (dataAgeSeconds === null || dataAgeSeconds > 300),
      expectedCadenceSeconds: policy?.every ?? null,
      dataFreshnessLimitSeconds: policy?.maxLag ?? null,
      nextDueAt: policy ? dueAt(policy, ingestion.results, now) : null,
      retryAt: row?.next_attempt || null,
      coverage: coverage
        ? {
            first: coverage.first ?? null,
            last: coverage.last ?? null,
            rows: coverage.rows ?? null,
            archived: !!coverage.archived,
            ...(network
              ? { metrics: network.metrics, expectedMetrics, oldestMetricAsOf: network.oldest }
              : {}),
          }
        : null,
    };
  });
  const stalled =
    !state ||
    now - state.last_started > 180 ||
    (state.outcome === 'running' && state.lease_until < now);
  const reasons: { code: string; key: string; message: string }[] = [];
  if (stalled)
    reasons.push({
      code: 'CRON_STALLED',
      key: 'automation',
      message: '서버 자동 갱신 실행을 3분 이내에 확인하지 못했습니다.',
    });
  const supplemental = (key: string | null | undefined) =>
    !!key && (key.startsWith('derivatives:') || key === 'mempool:BTC');
  if (state?.outcome === 'error' && !supplemental(state.job))
    reasons.push({
      code: 'CRON_JOB_ERROR',
      key: state.job || 'automation',
      message: '최근 자동 갱신 작업이 실패하여 다음 재시도를 기다리고 있습니다.',
    });
  for (const source of sources)
    if (
      source.active &&
      source.status !== 'ok' &&
      source.key !== 'maintenance' &&
      !supplemental(source.key)
    )
      reasons.push({
        code: 'SOURCE_' + source.status.toUpperCase(),
        key: source.key,
        message:
          source.status === 'missing'
            ? '초기 데이터 수집을 기다리고 있습니다.'
            : source.status === 'error'
              ? '원천 연결 또는 데이터 검증 오류로 재시도합니다.'
              : '수집 시각 또는 실제 데이터 시각이 허용 지연을 넘었습니다.',
      });
  for (const policy of expected.values()) {
    if (
      policy.kind === 'price' &&
      !sources.find((source) => source.key === policy.key)?.coverage?.last
    )
      reasons.push({
        code: 'HISTORY_MISSING',
        key: policy.key,
        message: '조회할 가격 이력의 저장 범위를 확인하지 못했습니다.',
      });
    if (
      (policy.kind === 'reference' || policy.kind === 'network') &&
      !sources.find((source) => source.key === policy.key)?.coverage?.last
    )
      reasons.push({
        code: policy.kind === 'network' ? 'NETWORK_MISSING' : 'REFERENCE_MISSING',
        key: policy.key,
        message:
          policy.kind === 'network'
            ? '네트워크 온체인 이력이 아직 저장되지 않았습니다.'
            : '초기 가격 참고 이력이 아직 저장되지 않았습니다.',
      });
    if (policy.key.startsWith('quote:') && !snapshots.results.some((row) => row.key === policy.key))
      reasons.push({
        code: 'QUOTE_MISSING',
        key: policy.key,
        message: '저장된 현재가가 없습니다.',
      });
  }
  if (!onchain)
    reasons.push({
      code: 'ONCHAIN_MISSING',
      key: 'bitview',
      message: '공개된 온체인 데이터가 없습니다.',
    });
  const jobs = policies.map((job) => ({
    key: job.key,
    kind: job.kind,
    cadenceSeconds: job.every,
    dueAt: dueAt(job, ingestion.results, now),
    assets: job.assets,
    market: job.market,
  }));
  return {
    now,
    assets,
    sources,
    history,
    rebuilding,
    health: { ok: !reasons.length, reasons, checkedAt: now },
    automation: {
      runner: 'Cloudflare Cron',
      independentOfVisitors: true,
      tickSeconds: 60,
      lastStartedAt: state?.last_started ?? null,
      lastCompletedAt: state?.last_completed ?? null,
      lastSucceededAt: state?.last_succeeded ?? null,
      lastJob: state?.job ?? null,
      lastRunStatus: state?.outcome ?? 'not_started',
      lastError: cleanError(state?.error),
      leaseUntil: state?.outcome === 'running' ? state.lease_until : null,
      stalled,
      nextTickAt: Math.floor(now / 60) * 60 + 60,
      observation48h: {
        from: now - 48 * 3600,
        firstRunAt: observation?.first ?? null,
        lastRunAt: observation?.last ?? null,
        ticks: observation?.ticks ?? 0,
        failures: observation?.failures ?? 0,
        ready:
          !!observation?.first &&
          observation.first <= now - 48 * 3600 + 60 &&
          !!observation.last &&
          now - observation.last <= 180,
      },
      cadence: {
        quoteBackgroundTargetSeconds: BACKGROUND_QUOTE_SECONDS,
        quoteBackgroundDelaySeconds: 180,
        quoteOnDemandMinSeconds: QUOTE_REFRESH_SECONDS,
        hourlyCandlesSeconds: 3600,
        dailyCandlesSeconds: DAILY_REFRESH_SECONDS,
        dailyUtcBoundaryRefresh: true,
      },
      jobs,
      recentRuns: runs.results.map((r) => ({
        runId: r.run_id,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        job: r.job,
        outcome: r.outcome,
        error: cleanError(r.error),
      })),
    },
    coverage: {
      expectedSources: sources.filter((s) => s.active).length,
      healthySources: sources.filter((s) => s.active && s.status === 'ok').length,
      priceMarkets: assets.length * 2,
      histories: history.filter((h) => assets.includes(h.asset)).length,
    },
  };
}
