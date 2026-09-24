import { DAY, zStep, type ZState } from '../shared/math';
import type { Asset, Market } from '../shared/types';
import { bitviewPage, getQuotes, getRecentCandles } from './providers';
import {
  claimRefresh,
  epoch,
  failure,
  putState,
  readState,
  success,
  QUOTE_REFRESH_SECONDS,
  refreshLeaseStatement,
  successStatement,
  type Env,
} from './storage';
import { updateDominance, updateStable } from './dominance';
import { updateReference } from './reference-price';
import { updateNetworkData } from './network-data';
import { isNetworkAsset } from '../shared/network-catalog';
import { derivativeAsset, derivativeMetric, updateDerivatives } from './derivatives';
import { updateMempool } from './mempool';
import {
  cleanError,
  enabledAssets,
  jobPolicies,
  selectJob,
  type CronState,
  type IngestionState,
  type JobPolicy,
} from './health';
interface Build {
  generation: string;
  cursor: number;
  versions: Record<string, number> | null;
  n: number;
  mean: number;
  m2: number;
  start: number | null;
}
async function rawSample(env: Env, key: string, data: unknown) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
  )
    .bind(key, key, epoch(), JSON.stringify(data))
    .run();
}

async function writeOnchain(
  env: Env,
  generation: string,
  rows: { time: number; data: Record<string, number | null> }[],
  state: ZState,
) {
  const statements: D1PreparedStatement[] = [];
  let s = state;
  for (const row of rows) {
    const next = zStep(s, row.data.market_cap, row.data.realized_cap);
    s = next.state;
    row.data.mvrv_z = next.value;
    row.data.mvrv_source = row.data.mvrv;
    row.data.nupl_source = row.data.nupl;
    const mc = row.data.market_cap,
      rc = row.data.realized_cap;
    row.data.mvrv = mc && rc && mc > 0 && rc > 0 ? mc / rc : null;
    row.data.nupl = mc && rc && mc > 0 && rc > 0 ? (mc - rc) / mc : null;
    statements.push(
      env.DB.prepare(
        'INSERT INTO onchain(generation,time,data,n,mean,m2,fetched_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(generation,time) DO UPDATE SET data=excluded.data,n=excluded.n,mean=excluded.mean,m2=excluded.m2,fetched_at=excluded.fetched_at WHERE onchain.data!=excluded.data OR onchain.n!=excluded.n OR onchain.mean!=excluded.mean OR onchain.m2!=excluded.m2',
      ).bind(generation, row.time, JSON.stringify(row.data), s.n, s.mean, s.m2, epoch()),
    );
  }
  for (let i = 0; i < statements.length; i += 20) await env.DB.batch(statements.slice(i, i + 20));
  return s;
}
export async function updateOnchain(env: Env) {
  let build = await readState<Build | null>(env.DB, 'onchain_build', null);
  const generation = await readState<string | null>(env.DB, 'onchain_generation', null);
  if (!generation && !build) {
    build = {
      generation: 'auto-' + epoch(),
      cursor: 0,
      versions: null,
      n: 0,
      mean: 0,
      m2: 0,
      start: null,
    };
  }
  if (build) {
    const page = await bitviewPage(env.BITVIEW_BASE_URL, build.cursor, 32);
    await rawSample(env, 'bitview', page.raw);
    if (build.versions && JSON.stringify(build.versions) !== JSON.stringify(page.versions)) {
      await putState(env.DB, 'onchain_build', {
        generation: 'auto-' + epoch(),
        cursor: 0,
        versions: null,
        n: 0,
        mean: 0,
        m2: 0,
        start: null,
      });
      return;
    }
    const s = await writeOnchain(env, build.generation, page.rows, build);
    const start = build.start ?? page.rows[0]?.time ?? null;
    if (page.finished) {
      const latest = await env.DB.prepare(
        'SELECT time FROM onchain WHERE generation=? ORDER BY time DESC LIMIT 1',
      )
        .bind(build.generation)
        .first<{ time: number }>();
      if (!latest) throw new Error('Rebuilt history is empty');
      const firstValid = await env.DB.prepare(
        'SELECT time FROM onchain WHERE generation=? AND n=1 ORDER BY time LIMIT 1',
      )
        .bind(build.generation)
        .first<{ time: number }>();
      await env.DB.batch([
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_generation',
          JSON.stringify(build.generation),
        ),
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_versions',
          JSON.stringify(page.versions),
        ),
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_history_start',
          JSON.stringify(start),
        ),
        env.DB.prepare('INSERT OR REPLACE INTO state(key,value) VALUES (?,?)').bind(
          'onchain_calculation_start',
          JSON.stringify(firstValid?.time ?? null),
        ),
        env.DB.prepare('DELETE FROM state WHERE key=?').bind('onchain_build'),
      ]);
      await success(env.DB, 'bitview', latest.time);
    } else
      await putState(env.DB, 'onchain_build', {
        generation: build.generation,
        cursor: page.next,
        versions: page.versions,
        ...s,
        start,
      });
    return;
  }
  const last = await env.DB.prepare(
    'SELECT time FROM onchain WHERE generation=? ORDER BY time DESC LIMIT 1',
  )
    .bind(generation)
    .first<{ time: number }>();
  const start = Math.min(epoch() - 8 * DAY, (last?.time ?? epoch()) - 2 * DAY);
  const date = new Date(start * 1000).toISOString().slice(0, 10);
  const page = await bitviewPage(env.BITVIEW_BASE_URL, date, 16);
  await rawSample(env, 'bitview', page.raw);
  const versions = await readState(env.DB, 'onchain_versions', {});
  if (JSON.stringify(versions) !== JSON.stringify(page.versions)) {
    await putState(env.DB, 'onchain_build', {
      generation: 'auto-' + epoch(),
      cursor: 0,
      versions: null,
      n: 0,
      mean: 0,
      m2: 0,
      start: null,
    });
    return;
  }
  if (!page.rows.length) throw new Error('No closed onchain observations');
  const previous = await env.DB.prepare(
    'SELECT n,mean,m2 FROM onchain WHERE generation=? AND time<? ORDER BY time DESC LIMIT 1',
  )
    .bind(generation, page.rows[0].time)
    .first<ZState>();
  await writeOnchain(env, generation!, page.rows, previous ?? { n: 0, mean: 0, m2: 0 });
  await success(env.DB, 'bitview', page.rows.at(-1)!.time);
}
export async function updatePrice(env: Env, asset: Asset, market: Market, interval: '1h' | '1d') {
  const step = interval === '1h' ? 3600 : DAY;
  const latest = await env.DB.prepare(
    'SELECT time FROM candles WHERE asset=? AND market=? AND interval=? ORDER BY time DESC LIMIT 1',
  )
    .bind(asset, market, interval)
    .first<{ time: number }>();
  const rows = await getRecentCandles(
    asset,
    market,
    interval,
    latest
      ? Math.max(latest.time - 2 * step, interval === '1h' ? epoch() - 90 * DAY : 0)
      : undefined,
    env,
  );
  const now = epoch();
  const priorHistory = await readState<{
    first: number;
    last: number;
    rows: number | null;
    archived?: boolean;
  } | null>(env.DB, 'history:' + asset + ':' + market + ':' + interval, null);
  const key = asset + ':' + market + ':' + interval;
  const historyKey = 'history:' + key;
  const historyStatement = priorHistory?.archived
    ? env.DB.prepare(
        "INSERT OR REPLACE INTO state(key,value) SELECT ?,json_object('first',?,'last',MAX(time),'rows',?,'archived',json('true'),'asset',?,'market',?,'interval',?,'fetched',?) FROM candles WHERE asset=? AND market=? AND interval=?",
      ).bind(
        historyKey,
        interval === '1h'
          ? Math.max(priorHistory.first, Math.ceil((now - 90 * DAY) / 3600) * 3600)
          : priorHistory.first,
        // Rolling archives expire in chunks; do not publish an uncounted total.
        interval === '1h' || priorHistory.rows === null
          ? null
          : priorHistory.rows + rows.filter((c) => c.time > priorHistory.last).length,
        asset,
        market,
        interval,
        now,
        asset,
        market,
        interval,
      )
    : env.DB.prepare(
        "INSERT OR REPLACE INTO state(key,value) SELECT ?,json_object('first',MIN(time),'last',MAX(time),'rows',COUNT(*),'asset',?,'market',?,'interval',?,'fetched',?) FROM candles WHERE asset=? AND market=? AND interval=?",
      ).bind(historyKey, asset, market, interval, now, asset, market, interval);
  // D1 executes a batch as one ordered transaction. Metadata observes the preceding
  // upserts and a failure keeps the previous raw sample, history, and success state.
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
    ).bind(key, key, now, JSON.stringify({ normalizedSourceSample: rows })),
    ...rows.map((c) =>
      env.DB.prepare(
        'INSERT INTO candles(asset,market,interval,time,open,high,low,close,volume,close_time,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset,market,interval,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,close_time=excluded.close_time,fetched_at=excluded.fetched_at WHERE candles.open!=excluded.open OR candles.high!=excluded.high OR candles.low!=excluded.low OR candles.close!=excluded.close OR candles.volume!=excluded.volume OR candles.close_time!=excluded.close_time',
      ).bind(
        asset,
        market,
        interval,
        c.time,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        c.closeTime,
        now,
      ),
    ),
    historyStatement,
    env.DB.prepare(
      'INSERT INTO ingestion(key,last_attempt,last_success,data_as_of,failures,error,next_attempt) VALUES (?,?,?,?,0,NULL,0) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,data_as_of=excluded.data_as_of,failures=0,error=NULL,next_attempt=0',
    ).bind(key, now, now, rows.at(-1)?.time ?? 0),
  ]);
}
export async function updateQuoteBatch(
  env: Env,
  assets: Asset[],
  market: Market,
  states: IngestionState[],
) {
  const now = epoch();
  const candidates = assets.filter((asset) => {
    const state = states.find((s) => s.key === 'quote:' + asset + ':' + market);
    return (
      (!state?.next_attempt || state.next_attempt <= now) &&
      (!state?.last_success || now - state.last_success >= QUOTE_REFRESH_SECONDS)
    );
  });
  if (!candidates.length) return false;
  const claims = await env.DB.batch(
    candidates.map((asset) =>
      refreshLeaseStatement(env.DB, 'quote:' + asset + ':' + market, QUOTE_REFRESH_SECONDS, now),
    ),
  );
  const selected = candidates.filter((_asset, i) => claims[i].meta.changes > 0);
  if (!selected.length) return false;
  const result = await getQuotes(selected, market, env);
  const statements = result.quotes.flatMap((quote) => [
    env.DB.prepare('INSERT OR REPLACE INTO snapshots(key,data,fetched_at) VALUES(?,?,?)').bind(
      'quote:' + quote.asset + ':' + market,
      JSON.stringify(quote),
      epoch(),
    ),
    successStatement(env.DB, 'quote:' + quote.asset + ':' + market, quote.time),
  ]);
  if (statements.length) await env.DB.batch(statements);
  for (const problem of result.errors)
    await failure(env.DB, 'quote:' + problem.asset + ':' + market, problem.error);
  return result.errors.length > 0;
}

async function maintenance(env: Env, now: number) {
  const active = await readState(env.DB, 'onchain_generation', '');
  const build = await readState<Build | null>(env.DB, 'onchain_build', null);
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM candles WHERE rowid IN (SELECT rowid FROM candles WHERE interval=? AND time<? LIMIT 200)',
    ).bind('1h', now - 90 * DAY),
    env.DB.prepare(
      'DELETE FROM price_archive WHERE rowid IN (SELECT rowid FROM price_archive WHERE interval=? AND end<? LIMIT 20)',
    ).bind('1h', now - 90 * DAY),
    env.DB.prepare(
      'DELETE FROM onchain WHERE rowid IN (SELECT rowid FROM onchain WHERE generation!=? AND generation!=? LIMIT 200)',
    ).bind(active, build?.generation || ''),
    successStatement(env.DB, 'maintenance', now),
  ]);
}

async function executeJob(env: Env, job: JobPolicy, states: IngestionState[]) {
  if (job.kind === 'quote-batch') {
    const partial = await updateQuoteBatch(env, job.assets!, job.market!, states);
    // Batch completion is recorded separately from each actual quote's status/time.
    await success(env.DB, job.key, epoch());
    return partial;
  }
  if (job.key === 'bitview') await updateOnchain(env);
  else if (job.kind === 'mempool') await updateMempool(env);
  else if (job.kind === 'derivatives') {
    const asset = job.assets![0];
    const metric = job.key.split(':')[2];
    if (!derivativeAsset(asset) || !derivativeMetric(metric))
      throw new Error('Unsupported derivatives job');
    await updateDerivatives(env, asset, metric);
  } else if (job.kind === 'network') {
    const asset = job.assets![0];
    if (!isNetworkAsset(asset)) throw new Error('Unsupported network job');
    await updateNetworkData(env, asset);
  } else if (job.kind === 'reference')
    await updateReference(
      env,
      job.assets![0] as (typeof import('./reference-price').REFERENCE_ASSETS)[number],
    );
  else if (job.key === 'defillama') await updateStable(env);
  else if (job.key === 'coinlore') {
    if (await claimRefresh(env.DB, 'dominance', 300)) await updateDominance(env);
  } else if (job.key === 'maintenance') await maintenance(env, epoch());
  else await updatePrice(env, job.assets![0], job.market!, job.interval!);
  return false;
}

/** Cloudflare runs this independently of visitors. One bounded source job per minute. */
export async function scheduled(env: Env, scheduledAt = epoch()) {
  const now = epoch(),
    tick = Math.floor(scheduledAt / 60),
    runId = crypto.randomUUID();
  const [previous, rows, build] = await Promise.all([
    env.DB.prepare('SELECT * FROM cron_state WHERE id=1').first<CronState>(),
    env.DB.prepare('SELECT * FROM ingestion').all<IngestionState>(),
    readState<Build | null>(env.DB, 'onchain_build', null),
  ]);
  if (previous && (previous.lease_until > now || previous.last_tick >= tick)) return;
  const interrupted = previous?.outcome === 'running' ? previous : null;
  const retry = rows.results.find(
    (row) => row.key === interrupted?.job && (row.last_success || 0) < interrupted.last_started,
  );
  if (retry) retry.next_attempt = now;
  const job = selectJob(jobPolicies(enabledAssets(env), !!build), rows.results, now);
  // Keep 72 hours of minute ticks so a full 48-hour unattended run is auditable.
  const slot = tick % 4320;
  // The run lease, bounded ledger, and selected-job attempt are one transaction.
  // Conditional SELECTs keep duplicate deliveries from overwriting the winning run.
  const initial = [
    env.DB.prepare(
      "INSERT INTO cron_state(id,run_id,last_tick,last_started,lease_until,job,outcome) VALUES(1,?,?,?,?,?,'running') ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,last_tick=excluded.last_tick,last_started=excluded.last_started,lease_until=excluded.lease_until,job=excluded.job,outcome='running',error=NULL WHERE cron_state.lease_until<=? AND cron_state.last_tick<?",
    ).bind(runId, tick, now, now + 120, job?.key ?? null, now, tick),
  ];
  if (interrupted)
    initial.push(
      env.DB.prepare(
        "UPDATE cron_runs SET completed_at=?,outcome='interrupted',error=? WHERE run_id=? AND EXISTS(SELECT 1 FROM cron_state WHERE id=1 AND run_id=?)",
      ).bind(
        now,
        '이전 실행이 완료되기 전에 중단되어 다시 예약했습니다.',
        interrupted.run_id,
        runId,
      ),
    );
  if (retry)
    initial.push(
      env.DB.prepare(
        'UPDATE ingestion SET next_attempt=? WHERE key=? AND EXISTS(SELECT 1 FROM cron_state WHERE id=1 AND run_id=?)',
      ).bind(now, retry.key, runId),
    );
  initial.push(
    env.DB.prepare(
      "INSERT OR REPLACE INTO cron_runs(slot,run_id,started_at,job,outcome) SELECT ?,?,?,?,'running' FROM cron_state WHERE id=1 AND run_id=?",
    ).bind(slot, runId, now, job?.key ?? null, runId),
  );
  if (job)
    initial.push(
      env.DB.prepare(
        'INSERT INTO ingestion(key,last_attempt) SELECT ?,? FROM cron_state WHERE id=1 AND run_id=? ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt',
      ).bind(job.key, now, runId),
    );
  const claimed = await env.DB.batch(initial);
  if (!claimed[0].meta.changes) return;
  let outcome = 'idle',
    error: string | null = null;
  try {
    if (job) {
      outcome = (await executeJob(env, job, rows.results)) ? 'partial' : 'ok';
      if (outcome === 'partial')
        error = '일부 자산의 시세를 갱신하지 못했습니다. 정상 자산은 저장했습니다.';
    }
  } catch (cause) {
    outcome = 'error';
    error = cleanError(cause);
    if (job) await failure(env.DB, job.key, cause);
  } finally {
    const completed = epoch();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE cron_state SET last_completed=?,last_succeeded=CASE WHEN ? IN ('ok','idle') THEN ? ELSE last_succeeded END,lease_until=0,outcome=?,error=? WHERE id=1 AND run_id=?",
      ).bind(completed, outcome, completed, outcome, error, runId),
      env.DB.prepare(
        'UPDATE cron_runs SET completed_at=?,outcome=?,error=? WHERE slot=? AND run_id=?',
      ).bind(completed, outcome, error, slot, runId),
    ]);
  }
}
