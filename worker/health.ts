import { assetDefinition } from '../shared/asset-registry';
import { observeAutomation, type ObservationRun } from '../shared/automation-observation';
import { ASSETS, isPrimaryAsset } from '../shared/catalog';
import { DAY } from '../shared/math';
import type { Asset, Market } from '../shared/types';
import { epoch, QUOTE_REFRESH_SECONDS, quoteRefreshSeconds, type Env } from './storage';
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
export function failureCode(error: unknown): string | null {
  if (!error) return null;
  const message = String(error);
  if (/SQLITE_FULL|database or disk is full|no space left/i.test(message)) return 'STORAGE_FULL';
  if (/SQLITE_BUSY|database is locked/i.test(message)) return 'STORAGE_BUSY';
  if (/rollback.*no transaction/i.test(message)) return 'STORAGE_TRANSACTION';
  if (/HTTP\s+429|API\s+429/.test(message)) return 'PROVIDER_RATE_LIMIT';
  if (/retract|rebuild|required.*rebuild/i.test(message)) return 'SOURCE_REVISION';
  if (/timeout|timed out/i.test(message)) return 'PROVIDER_TIMEOUT';
  return 'SOURCE_OR_VALIDATION';
}
export const cleanError = (error: unknown) => {
  const code = failureCode(error);
  if (!code) return null;
  if (code.startsWith('STORAGE_')) return '저장 처리 오류 · 마지막 정상 관측을 표시합니다';
  if (code === 'SOURCE_REVISION') return '원천 관측 수정 · 이력 재검증 필요';
  return String(error).match(/(?:HTTP|API)\s+\d{3}/)?.[0] || '원천 연결 또는 데이터 검증 오류';
};
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
          every: isPrimaryAsset(asset) ? (metric.endsWith('_daily') ? 3600 : 300) : 21600,
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
        every: isPrimaryAsset(asset) ? 3600 : 21600,
        maxLag: 3 * DAY,
        assets: [asset],
      });
  for (const asset of NETWORK_ASSETS)
    if (assets.includes(asset))
      jobs.push({
        key: 'network:' + asset,
        kind: 'network',
        every: isPrimaryAsset(asset) ? 3600 : 21600,
        maxLag: 3 * DAY,
        assets: [asset],
      });
  for (const market of ['binance', 'upbit'] as Market[]) {
    const marketAssets = assets.filter((a) => assetDefinition(a)?.markets[market]);
    for (let start = 0; start < marketAssets.length; start += 8)
      jobs.push({
        key: 'quotes:' + market + ':' + start / 8,
        kind: 'quote-batch',
        every: BACKGROUND_QUOTE_SECONDS,
        maxLag: 180,
        assets: marketAssets.slice(start, start + 8),
        market,
      });
    for (const asset of marketAssets)
      for (const interval of ['1h', '1d'] as const)
        jobs.push({
          key: asset + ':' + market + ':' + interval,
          kind: 'price',
          every: interval === '1h' || isPrimaryAsset(asset) ? DAILY_REFRESH_SECONDS : 21600,
          maxLag: interval === '1h' ? 7200 : 2 * DAY,
          assets: [asset],
          market,
          interval,
        });
  }
  return jobs;
}
/** Live quotes and primary futures have dedicated lanes; the minute queue handles history. */
export function backgroundPolicies(assets: Asset[], rebuilding: boolean): JobPolicy[] {
  return jobPolicies(assets, rebuilding)
    .filter((job) => job.kind !== 'quote-batch')
    .map((job) =>
      job.kind === 'derivatives' && job.assets?.some(isPrimaryAsset) && !job.key.endsWith('_daily')
        ? { ...job, every: 3600 }
        : job,
    );
}
export function dueAt(
  job: JobPolicy,
  states: IngestionState[],
  now: number,
  index?: Map<string, IngestionState>,
) {
  const state = index ? index.get(job.key) : states.find((s) => s.key === job.key);
  if (state?.next_attempt) return state.next_attempt;
  let due = state?.last_attempt ? state.last_attempt + job.every : 0;
  if (job.kind === 'price' && job.interval === '1d' && state?.data_as_of)
    due = Math.min(due, (Math.floor(state.data_as_of / DAY) + 1) * DAY);
  if (state?.last_attempt && state.data_as_of && now - state.data_as_of > job.maxLag)
    due = Math.min(due, state.last_attempt + 60);
  if (job.kind === 'quote-batch') {
    for (const asset of job.assets!) {
      const key = 'quote:' + asset + ':' + job.market;
      const individual = index ? index.get(key) : states.find((s) => s.key === key);
      if (individual?.next_attempt)
        due = Math.min(
          due,
          Math.max(individual.next_attempt, (individual.last_attempt || 0) + QUOTE_REFRESH_SECONDS),
        );
    }
  }
  return due;
}
export function selectJob(jobs: JobPolicy[], states: IngestionState[], now: number, fair = false) {
  const index = new Map(states.map((s) => [s.key, s]));
  const eligible = jobs
    .map((job) => ({
      job,
      due: fair
        ? Math.max(dueAt(job, states, now, index), (index.get(job.key)?.last_attempt ?? -60) + 60)
        : dueAt(job, states, now, index),
    }))
    .filter((item) => item.due <= now)
    .sort((a, b) => a.due - b.due);
  // VPS quotes have their own lane. Earliest-due service also admits failed
  // sources whose backoff expired, instead of indefinitely preferring healthy
  // primary coins. Attempts advance the deadline even during history catch-up.
  if (fair) return eligible[0]?.job;
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
    recoveryRows,
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
      'SELECT slot,started_at,completed_at,job,outcome FROM cron_runs WHERE started_at>=?',
    )
      .bind(now - 72 * 3600)
      .all<ObservationRun>(),
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
    env.DB.prepare(
      "SELECT key,value FROM state WHERE key LIKE 'cursor:price-backfill:%' ORDER BY key",
    ).all<{ key: string; value: string }>(),
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
      if (assetDefinition(asset)?.markets[market])
        expected.set('quote:' + asset + ':' + market, {
          key: 'quote:' + asset + ':' + market,
          kind: 'quote-batch',
          every: quoteRefreshSeconds(asset, env.RUNTIME_KIND),
          maxLag: quoteRefreshSeconds(asset, env.RUNTIME_KIND) === 60 ? 180 : 600,
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
      errorCode: failureCode(row?.error),
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
  const background = backgroundPolicies(assets, rebuilding);
  const jobs = policies.map((job) => {
    const dedicated =
      job.kind === 'quote-batch'
        ? 'quotes'
        : job.kind === 'derivatives' &&
            job.assets?.some(isPrimaryAsset) &&
            !job.key.endsWith('_daily')
          ? 'recent-futures'
          : null;
    const queued = background.find((item) => item.key === job.key);
    return {
      key: job.key,
      kind: job.kind,
      cadenceSeconds: job.every,
      dueAt: dueAt(queued ?? job, ingestion.results, now),
      assets: job.assets,
      market: job.market,
      lane: dedicated ?? 'background',
      worker:
        env.RUNTIME_KIND === 'vps'
          ? dedicated === 'quotes'
            ? 'quotes'
            : dedicated === 'recent-futures'
              ? 'recent'
              : 'background'
          : dedicated === 'quotes'
            ? 'btc-desk-quotes'
            : dedicated === 'recent-futures'
              ? 'btc-desk'
              : 'btc-desk-background',
      dedicatedCadenceSeconds: dedicated ? job.every : null,
      backgroundCadenceSeconds: queued?.every ?? null,
      dataInterval:
        job.kind === 'quote-batch'
          ? 'snapshot'
          : job.interval === '1h'
            ? '1h'
            : ['onchain', 'network', 'reference', 'stablecoins'].includes(job.kind) ||
                job.key.endsWith('_daily') ||
                job.interval === '1d'
              ? '1d'
              : job.key.endsWith(':funding')
                ? 'settlement'
                : job.kind === 'derivatives'
                  ? '1h'
                  : 'provider-defined',
    };
  });
  const analysisParts = Array.from({ length: 15 }, (_, part) => {
    const key = 'observations:' + part;
    const row = ingestion.results.find((s) => s.key === key);
    return {
      key,
      lastSuccess: row?.last_success ?? null,
      error: cleanError(row?.error),
      healthy: !!row?.last_success && now - row.last_success <= 2400 && !row.error,
    };
  });
  const observation48h = observeAutomation(
    observation.results,
    now,
    Object.fromEntries(ingestion.results.map((s) => [s.key, s.last_success ?? 0])),
    [
      ...sources.filter((s) => s.active && s.status !== 'ok').map((s) => s.key),
      ...ingestion.results.filter((s) => s.key.startsWith('quotes:') && s.error).map((s) => s.key),
      ...analysisParts.filter((s) => !s.healthy).map((s) => s.key),
      ...(stalled ? ['automation'] : []),
    ],
  );
  return {
    now,
    assets,
    sources,
    history,
    historyRecovery: recoveryRows.results.flatMap((row) => {
      const key = row.key.slice('cursor:price-backfill:'.length);
      if (!/^[A-Z0-9_]+:(binance|upbit):(1h|1d)$/.test(key) || !assetDefinition(key.split(':')[0]))
        return [];
      try {
        const value = JSON.parse(row.value);
        if (!Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > now)
          return [];
        return [
          {
            key,
            cursor: value.cursor as number,
            checkedAt: Number.isSafeInteger(value.checkedAt) ? (value.checkedAt as number) : null,
            error: cleanError(value.error),
          },
        ];
      } catch {
        return [];
      }
    }),
    rebuilding,
    health: { ok: !reasons.length, reasons, checkedAt: now },
    automation: {
      runner: env.RUNTIME_KIND === 'vps' ? 'VPS minute scheduler' : 'Cloudflare Cron',
      cronWorkers: env.RUNTIME_KIND === 'vps' ? [] : ['btc-desk', 'btc-desk-quotes'],
      boundWorkers: env.RUNTIME_KIND === 'vps' ? [] : ['btc-desk-background', 'btc-desk-analysis'],
      collectors:
        env.RUNTIME_KIND === 'vps'
          ? ['quotes', 'background', 'recent', 'analysis']
          : ['btc-desk', 'btc-desk-quotes', 'btc-desk-background', 'btc-desk-analysis'],
      observationScope:
        env.RUNTIME_KIND === 'vps'
          ? 'preserved background scheduler ledger; all active source freshness also required'
          : 'background Cron ledger; all active source freshness also required',
      analysisCycleSeconds: 1200,
      analysisParts,
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
      observation48h,
      cadence: {
        quoteBackgroundTargetSeconds: BACKGROUND_QUOTE_SECONDS,
        quoteSecondaryTargetSeconds: quoteRefreshSeconds('SOL', env.RUNTIME_KIND),
        quoteBackgroundDelaySeconds: 180,
        quoteOnDemandMinSeconds: QUOTE_REFRESH_SECONDS,
        quoteOnDemandEnabled: !env.READ_ONLY_API,
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
