import { statfsSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem, loadavg, cpus } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const GiB = 1024 ** 3;
const CHECKPOINT = 'history-operator:derivatives:checkpoint';
const readState = async (db, key) => {
  const row = await db.prepare('SELECT value FROM state WHERE key=?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
};
const writeState = (db, key, value) =>
  db
    .prepare(
      'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    )
    .bind(key, JSON.stringify(value))
    .run();

export function assessHistoryResources(sample) {
  if (!Number.isFinite(sample.freeDiskBytes) || sample.freeDiskBytes < 8 * GiB)
    return { allowed: false, reason: 'paused_low_space' };
  if (
    !Number.isFinite(sample.availableMemoryBytes) ||
    sample.availableMemoryBytes < 1.5 * GiB ||
    (sample.cgroupAvailableBytes !== null &&
      (!Number.isFinite(sample.cgroupAvailableBytes) ||
        sample.cgroupAvailableBytes < 128 * 1024 ** 2))
  )
    return { allowed: false, reason: 'paused_low_memory' };
  if (
    !Number.isFinite(sample.load1) ||
    !Number.isFinite(sample.cpus) ||
    sample.cpus < 1 ||
    sample.load1 > Math.max(1, sample.cpus * 0.8)
  )
    return { allowed: false, reason: 'paused_cpu_pressure' };
  if (
    sample.maxTemperatureC !== null &&
    (!Number.isFinite(sample.maxTemperatureC) || sample.maxTemperatureC >= 85)
  )
    return { allowed: false, reason: 'paused_temperature' };
  return { allowed: true, reason: null };
}

/** Read host/cgroup capacity only. Thermal sensors may be unavailable on a VPS. */
export function readHistoryResources(path) {
  const disk = statfsSync(dirname(path));
  let memory = freemem(),
    cgroupAvailableBytes = null,
    cgroupCpuQuota = null;
  try {
    const info = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'));
    if (info) memory = Number(info[1]) * 1024;
  } catch {
    /* Portable local diagnostics. */
  }
  try {
    const maximum = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (maximum !== 'max')
      cgroupAvailableBytes = Math.max(
        0,
        Number(maximum) - Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8')),
      );
  } catch {
    /* The host memory reserve still applies. */
  }
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0)
      cgroupCpuQuota = Number(quota) / Number(period);
  } catch {
    /* Host load must not be divided by a container's fractional quota. */
  }
  const temperatures = [];
  try {
    for (const name of readdirSync('/sys/class/thermal').filter((name) =>
      /^thermal_zone\d+$/.test(name),
    )) {
      try {
        const value = Number(readFileSync('/sys/class/thermal/' + name + '/temp', 'utf8')) / 1000;
        if (Number.isFinite(value) && value > 0) temperatures.push(value);
      } catch {
        /* A disappearing sensor is unavailable, not a fabricated value. */
      }
    }
  } catch {
    /* Most VPS hosts expose no thermal sensor. */
  }
  return {
    freeDiskBytes: disk.bavail * disk.bsize,
    availableMemoryBytes: memory,
    cgroupAvailableBytes,
    load1: loadavg()[0],
    cpus: cpus().length,
    cpuObservationScope: 'host-load-and-host-logical-cpus',
    cgroupCpuQuota,
    maxTemperatureC: temperatures.length ? Math.max(...temperatures) : null,
    temperatureStatus: temperatures.length ? 'measured' : 'not_exposed_by_host',
  };
}

export async function runHistoryBackfill({
  env,
  operations,
  resources,
  now = Date.now,
  sleep = delay,
  shouldStop = () => false,
  maxPages = 10000,
  onEvent = () => {},
}) {
  const grant = env.DERIVATIVE_HISTORY_GRANT;
  operations.derivativeBackfillLimit(env, Math.floor(now() / 1000));
  if (!grant || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100000)
    throw new Error('Explicit private recovery grant and bounded run required');
  let inventory = await operations.derivativeHistoryInventory(env);
  const initialResources = resources();
  const initial = assessHistoryResources(initialResources);
  if (!initial.allowed)
    return {
      outcome: initial.reason,
      partitions: inventory.length,
      resources: initialResources,
      requests: 0,
    };
  let lease = await operations.claimOperatorLease(env);
  if (lease === null) return { outcome: 'operator_busy', requests: 0 };
  let attempts = 0,
    pages = 0,
    observations = 0,
    lastCompleted = -Infinity;
  let outcome = 'page_limit',
    index = 0;
  try {
    const grantKey = 'history-operator:grant:' + grant.id;
    const existingGrant = await readState(env.DB, grantKey);
    if (
      existingGrant &&
      ['kind', 'id', 'issuedAt', 'expiresAt', 'dailyRows'].some(
        (key) => existingGrant[key] !== grant[key],
      )
    )
      throw new Error('An existing recovery grant cannot be extended or replaced');
    if (!existingGrant) await writeState(env.DB, grantKey, grant);
    const checkpoint = await readState(env.DB, CHECKPOINT);
    const restored = inventory.findIndex((part) => part.key === checkpoint?.nextPartition);
    if (restored >= 0) index = restored;
    let roundProgress = 0,
      roundVisited = 0;
    while (attempts < maxPages) {
      if (shouldStop()) {
        outcome = 'stopped';
        break;
      }
      if (now() / 1000 >= grant.expiresAt) {
        outcome = 'paused_expired';
        break;
      }
      const capacity = assessHistoryResources(resources());
      if (!capacity.allowed) {
        outcome = capacity.reason;
        break;
      }
      if (inventory.every((part) => part.complete !== null && part.cursor === null)) {
        outcome = 'complete';
        break;
      }
      const part = inventory[index];
      index = (index + 1) % inventory.length;
      if (part.complete !== null && part.cursor === null) continue;
      // Wait after completion so variable DB/provider time cannot squeeze
      // two actual source requests into the same second.
      const wait = Math.max(0, 1000 - (now() - lastCompleted));
      if (wait) await sleep(wait);
      if (shouldStop()) {
        outcome = 'stopped';
        break;
      }
      if (now() / 1000 >= grant.expiresAt) {
        outcome = 'paused_expired';
        break;
      }
      const checked = assessHistoryResources(resources());
      if (!checked.allowed) {
        outcome = checked.reason;
        break;
      }
      lease = await operations.renewOperatorLease(env, lease);
      if (lease === null) {
        outcome = 'operator_lease_lost';
        break;
      }
      const result = await operations.runDerivativeHistoryPage(env, part.asset, part.metric, lease);
      lastCompleted = now();
      attempts++;
      pages += Number((result.candidateRows ?? 0) > 0);
      observations += result.observations ?? 0;
      if (result.outcome === 'advanced' || result.outcome === 'complete') roundProgress++;
      await writeState(env.DB, CHECKPOINT, {
        grantId: grant.id,
        expiresAt: grant.expiresAt,
        nextPartition: inventory[index].key,
        at: Math.floor(now() / 1000),
        lastPartition: part.key,
        outcome: result.outcome,
        attempts,
        pages,
        observations,
      });
      onEvent({ asset: part.asset, metric: part.metric, ...result });
      if (result.outcome.startsWith('paused_')) {
        outcome = result.outcome;
        break;
      }
      roundVisited++;
      if (
        roundVisited >= inventory.filter((p) => p.complete === null || p.cursor !== null).length
      ) {
        inventory = await operations.derivativeHistoryInventory(env);
        if (!roundProgress) {
          outcome = 'waiting_partition_retry_or_lease';
          break;
        }
        roundProgress = 0;
        roundVisited = 0;
      }
    }
    inventory = await operations.derivativeHistoryInventory(env);
    if (
      outcome === 'page_limit' &&
      inventory.every((p) => p.complete !== null && p.cursor === null)
    )
      outcome = 'complete';
    return {
      outcome,
      attempts,
      pages,
      observations,
      partitions: inventory.length,
      completed: inventory.filter((p) => p.complete !== null && p.cursor === null).length,
      remaining: inventory
        .filter((p) => p.complete === null || p.cursor !== null)
        .map((p) => ({ asset: p.asset, metric: p.metric, cursor: p.cursor })),
      budget: await readState(env.DB, 'budget:derivatives-backfill'),
      hourlyPolicyDays: 30,
      automaticGrantExtension: false,
      latestCollectorsStopped: false,
    };
  } finally {
    if (lease !== null) await operations.releaseOperatorLease(env, lease);
  }
}

export function parseHistoryBackfillArguments(args, now = Math.floor(Date.now() / 1000)) {
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (
      ![
        '--execute-recovery',
        '--acknowledge-existing-budget',
        '--grant-id',
        '--daily-row-limit',
        '--expires-at',
        '--db',
        '--max-pages',
      ].includes(key) ||
      values.has(key)
    )
      throw new Error('Invalid or duplicate history operator argument');
    if (['--execute-recovery', '--acknowledge-existing-budget'].includes(key))
      values.set(key, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing history operator argument');
      values.set(key, value);
    }
  }
  const execute = values.get('--execute-recovery') === true;
  const db = String(values.get('--db') ?? process.env.COIN_DESK_DB ?? '/app/data/coin-desk.sqlite');
  const maxPages = Number(values.get('--max-pages') ?? 10000);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100000)
    throw new Error('Invalid page limit');
  if (!execute) {
    if (
      ['--grant-id', '--daily-row-limit', '--expires-at', '--acknowledge-existing-budget'].some(
        (key) => values.has(key),
      )
    )
      throw new Error('Recovery authorization requires the explicit execution flag');
    return { execute, db, maxPages, grant: null };
  }
  const expires = values.get('--expires-at');
  const grant = {
    kind: 'operator-recovery-v1',
    id: String(values.get('--grant-id') ?? ''),
    issuedAt: now,
    expiresAt: typeof expires === 'string' && /Z$/.test(expires) ? Date.parse(expires) / 1000 : NaN,
    dailyRows: Number(values.get('--daily-row-limit')),
  };
  if (
    !values.get('--acknowledge-existing-budget') ||
    !/^[a-z0-9][a-z0-9-]{7,63}$/.test(grant.id) ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.expiresAt <= now ||
    grant.expiresAt - now > 86400 ||
    !Number.isSafeInteger(grant.dailyRows) ||
    grant.dailyRows <= 10000 ||
    grant.dailyRows > 1000000
  )
    throw new Error('Explicit bounded recovery authorization required');
  return { execute, db, maxPages, grant };
}

async function main() {
  const options = parseHistoryBackfillArguments(process.argv.slice(2));
  if (!existsSync(options.db))
    throw new Error('Existing database required; no bootstrap or migration permitted');
  const { openSqlite } = await import('./sqlite.mjs');
  const db = openSqlite(options.db, { readOnly: !options.execute });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const operator = await import('../server-dist/history-operator.mjs');
    const budget = await import('../server-dist/backfill-budget.mjs');
    if (!options.execute) {
      const inventory = await operator.derivativeHistoryInventory({ DB: db });
      console.log(
        JSON.stringify({
          outcome: 'dry_run',
          partitions: inventory,
          resources: readHistoryResources(options.db),
          writes: 0,
          requests: 0,
        }),
      );
      return;
    }
    const storedGrant = await readState(db, 'history-operator:grant:' + options.grant.id);
    if (storedGrant) options.grant.issuedAt = storedGrant.issuedAt;
    const { createEnvironment } = await import('./environment.mjs');
    const env = await createEnvironment(db);
    env.READ_ONLY_API = false;
    env.DERIVATIVE_HISTORY_GRANT = options.grant;
    env.HISTORY_ALLOWED = () => readHistoryResources(options.db).freeDiskBytes >= 8 * GiB;
    const result = await runHistoryBackfill({
      env,
      operations: { ...operator, ...budget },
      resources: () => readHistoryResources(options.db),
      shouldStop: () => stopped,
      maxPages: options.maxPages,
      onEvent: (event) =>
        console.log(JSON.stringify({ event: 'derivative-history-page', ...event })),
    });
    console.log(JSON.stringify({ event: 'derivative-history-result', ...result }));
    if (result.outcome !== 'complete') process.exitCode = 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    db.sqlite.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ outcome: 'failed', error: String(error.message).slice(0, 200) }),
    );
    process.exitCode = 1;
  });
}
