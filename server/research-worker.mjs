import { pathToFileURL } from 'node:url';
import { statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { constants as sqliteConstants } from 'node:sqlite';
import { openSqlite } from './sqlite.mjs';
import {
  researchSchemaReady,
  collectResearch,
  collectorLease,
  releaseCollectorLease,
  dueReportJobs,
  claimReport,
  renewReport,
  failReport,
  publishReport,
  buildStoredReport,
  errorCode,
} from '../server-dist/research.mjs';

export function restrictResearchWrites(sqlite) {
  const tables = new Set([
    'onchain_markets',
    'onchain_observations',
    'onchain_provider_state',
    'onchain_report_runs',
    'onchain_reports',
    'onchain_report_evidence',
  ]);
  const reads = new Set([
    sqliteConstants.SQLITE_READ,
    sqliteConstants.SQLITE_SELECT,
    sqliteConstants.SQLITE_FUNCTION,
    sqliteConstants.SQLITE_TRANSACTION,
    sqliteConstants.SQLITE_SAVEPOINT,
    sqliteConstants.SQLITE_RECURSIVE,
  ]);
  // Verified Node 24 API. No legacy table writes, deletes, attached DBs or schema changes.
  if (typeof sqlite.setAuthorizer !== 'function') throw new Error('RESEARCH_AUTHORIZER_REQUIRED');
  sqlite.setAuthorizer((action, table) =>
    reads.has(action) ||
    ((action === sqliteConstants.SQLITE_INSERT || action === sqliteConstants.SQLITE_UPDATE) &&
      tables.has(table))
      ? sqliteConstants.SQLITE_OK
      : sqliteConstants.SQLITE_DENY,
  );
}

export function researchConfig(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const value = env[key] ?? String(fallback);
    if (!/^\d+$/.test(value) || +value < min || +value > max)
      throw new Error('INVALID_RESEARCH_CONFIG');
    return +value;
  };
  if (!['0', '1', 'false', 'true'].includes(env.COIN_DESK_RESEARCH_ENABLED ?? '0'))
    throw new Error('INVALID_RESEARCH_CONFIG');
  return {
    enabled: ['1', 'true'].includes(env.COIN_DESK_RESEARCH_ENABLED ?? '0'),
    path: env.COIN_DESK_DB ?? '/app/data/coin-desk.sqlite',
    maxSeconds: integer('COIN_DESK_RESEARCH_MAX_JOB_SECONDS', 600, 30, 600),
    maxMarkets: integer('COIN_DESK_RESEARCH_MAX_MARKETS', 10, 1, 10),
    coinGeckoKey: env.COINGECKO_DEMO_API_KEY || undefined,
  };
}
export async function heartbeat(
  db,
  enabled,
  { now = Math.floor(Date.now() / 1000), lastTickAt = null, errorCode = null } = {},
) {
  const checkpoint = JSON.stringify({
    enabled,
    pid: process.pid,
    heartbeatAt: now,
    lastTickAt,
    errorCode,
  });
  await db
    .prepare(
      `INSERT INTO onchain_provider_state(provider,scope,last_attempt,last_success,checkpoint) VALUES('runtime','research',?,?,?)
    ON CONFLICT(provider,scope) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,checkpoint=excluded.checkpoint`,
    )
    .bind(now, now, checkpoint)
    .run();
}
export async function researchHealth(db, now = Math.floor(Date.now() / 1000)) {
  if (!(await researchSchemaReady(db))) return { ok: false, state: 'migration_required' };
  const row = await db
    .prepare(
      "SELECT checkpoint FROM onchain_provider_state WHERE provider='runtime' AND scope='research'",
    )
    .first();
  if (!row?.checkpoint) return { ok: false, state: 'not_started' };
  const record = JSON.parse(row.checkpoint);
  return {
    ok:
      Number.isInteger(record.heartbeatAt) &&
      now - record.heartbeatAt <= 120 &&
      record.heartbeatAt <= now + 30,
    state: record.enabled ? 'enabled' : 'disabled',
    lastTickAt: record.lastTickAt,
  };
}
export async function runResearchTick(
  db,
  config,
  {
    now = () => Math.floor(Date.now() / 1000),
    signal,
    collector = collectResearch,
    spaceAvailable = () => true,
  } = {},
) {
  if (!config.enabled) return { state: 'disabled', reports: 0 };
  const owner = crypto.randomUUID(),
    started = now();
  if (!(await collectorLease(db, owner, started, config.maxSeconds + 60)))
    return { state: 'overlap', reports: 0 };
  let reports = 0;
  try {
    // Optional research collection does not compete with core prices when disk is low.
    if (!spaceAvailable()) return { state: 'paused_low_space', reports: 0 };
    const stop = AbortSignal.any([
      AbortSignal.timeout(config.maxSeconds * 1000),
      ...(signal ? [signal] : []),
    ]);
    const collected = await collector(db, started, {
      signal: stop,
      maxMarkets: config.maxMarkets,
      coinGeckoKey: config.coinGeckoKey,
      now,
    });
    stop.throwIfAborted();
    for (const job of dueReportJobs(now())) {
      const claim = await claimReport(db, job, owner, now());
      if (!claim) continue;
      let renewing = false;
      const timer = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void renewReport(db, claim, now())
          .catch(() => {})
          .finally(() => {
            renewing = false;
          });
      }, 30000);
      try {
        const report = await buildStoredReport(db, job, now());
        stop.throwIfAborted();
        if (!report) {
          await failReport(db, claim, now(), 'INSUFFICIENT_OBSERVATIONS');
          continue;
        }
        await publishReport(db, claim, report, now());
        reports++;
      } catch (error) {
        await failReport(db, claim, now(), errorCode(error));
      } finally {
        clearInterval(timer);
      }
    }
    return {
      state: collected.failed.length ? 'partial' : 'ok',
      reports,
      providers: collected.success.length,
      failed: collected.failed.length,
    };
  } finally {
    await releaseCollectorLease(db, owner, now());
  }
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.some((a) => !['--health', '--once', '--dry-run'].includes(a)) || argv.length > 1)
    throw new Error('INVALID_RESEARCH_ARGUMENT');
  const config = researchConfig(env),
    readOnly = argv.includes('--health') || argv.includes('--dry-run');
  const db = openSqlite(config.path, { readOnly });
  let heartbeatTimer = null,
    stop = null;
  try {
    if (
      !(await researchSchemaReady(db)) ||
      !db.sqlite
        .prepare("SELECT 1 FROM _coin_desk_migrations WHERE name='0010_research_reports.sql'")
        .get()
    )
      throw new Error('RESEARCH_MIGRATION_REQUIRED');
    if (argv.includes('--health')) {
      const health = await researchHealth(db);
      console.log(JSON.stringify(health));
      if (!health.ok) process.exitCode = 1;
      return;
    }
    if (argv.includes('--dry-run')) {
      const at = Math.floor(Date.now() / 1000),
        results = [];
      for (const job of dueReportJobs(at)) {
        const report = await buildStoredReport(db, job, at);
        results.push({
          id: report?.reportId ?? null,
          quality: report?.dataQuality ?? 'unavailable',
          evidence: report?.evidence.length ?? 0,
        });
      }
      console.log(JSON.stringify({ dryRun: true, reports: results }));
      return;
    }
    restrictResearchWrites(db.sqlite);
    const abort = new AbortController();
    let running = false,
      stopping = false,
      lastTickAt = null,
      lastError = null;
    const beat = () => heartbeat(db, config.enabled, { lastTickAt, errorCode: lastError });
    stop = () => {
      stopping = true;
      abort.abort();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    await beat();
    heartbeatTimer = setInterval(() => {
      void beat().catch(() => {
        lastError = 'STORAGE_UNAVAILABLE';
      });
    }, 30000);
    const tick = async () => {
      if (running || stopping) return;
      running = true;
      try {
        const result = await runResearchTick(db, config, {
          signal: abort.signal,
          spaceAvailable: () => {
            const info = statfsSync(dirname(resolve(config.path)));
            return info.bavail * info.bsize >= 8 * 1024 ** 3;
          },
        });
        lastTickAt = Math.floor(Date.now() / 1000);
        lastError = result.state === 'paused_low_space' ? 'LOW_SPACE' : null;
        console.log(JSON.stringify({ event: 'research_tick', ...result }));
      } catch (error) {
        lastError = errorCode(error);
        console.error(JSON.stringify({ event: 'research_tick_failed', code: lastError }));
      } finally {
        lastTickAt = Math.floor(Date.now() / 1000);
        running = false;
        await beat();
      }
    };
    await tick();
    if (!argv.includes('--once'))
      while (!stopping) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!running && Date.now() / 1000 - (lastTickAt ?? 0) >= 60) await tick();
      }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (stop) {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
    }
    db.sqlite.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        event: 'research_start_failed',
        code: /^RESEARCH_|^INVALID_RESEARCH_/.test(error.message)
          ? error.message
          : 'RESEARCH_UNAVAILABLE',
      }),
    );
    process.exitCode = 1;
  });
