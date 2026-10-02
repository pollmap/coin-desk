/** Local operational rehearsal. Production uses the isolated Compose services. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSqlite, migrate, migrationHash } from './sqlite.mjs';
import { LANES } from './runtime.mjs';
import { checkUpstreams } from './upstream-check.mjs';

export function liveOptions(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--database', '--port', '--hub-port'].includes(args[i]) ||
      !args[i + 1] ||
      values.has(args[i])
    )
      throw new Error('Use --database <validated SQLite> [--port 5209] [--hub-port 8091]');
    values.set(args[i], args[i + 1]);
  }
  if (!values.get('--database'))
    throw new Error(
      'An explicit validated database is required; the original cache is never selected automatically',
    );
  const port = Number(values.get('--port') || 5209),
    hubPort = Number(values.get('--hub-port') || 8091);
  if (
    [port, hubPort].some((p) => !Number.isInteger(p) || p < 1024 || p > 65535) ||
    port === hubPort
  )
    throw new Error('Two distinct unprivileged local ports are required');
  return { database: resolve(values.get('--database')), port, hubPort };
}

async function availablePort(port) {
  const server = createServer();
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', done);
  });
  await new Promise((done) => server.close(done));
}

export async function verifyLiveDatabase(path) {
  await access(path);
  const db = openSqlite(path, { readOnly: true });
  try {
    const ledger = db.sqlite
      .prepare("SELECT 1 FROM sqlite_schema WHERE name='_coin_desk_migrations' AND type='table'")
      .get();
    if (!ledger)
      throw new Error(
        'Database has no validated import ledger; use the isolated rehearsal importer first',
      );
    const { readdir } = await import('node:fs/promises');
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql'))) {
      const recorded = db.sqlite
        .prepare('SELECT sha256 FROM _coin_desk_migrations WHERE name=?')
        .get(name);
      if (
        !recorded ||
        recorded.sha256 !== migrationHash(await readFile(resolve('migrations', name), 'utf8'))
      )
        throw new Error('Database migration verification failed');
    }
    if (Object.values(db.sqlite.prepare('PRAGMA quick_check(1)').get())[0] !== 'ok')
      throw new Error('Database integrity verification failed');
  } finally {
    db.sqlite.close();
  }
}

export function liveServicePlan(options) {
  const root = dirname(options.database);
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    COIN_DESK_DB: options.database,
    COIN_DESK_RELEASE: 'local-live',
    COIN_DESK_QUOTE_HUB: `http://127.0.0.1:${options.hubPort}`,
    COIN_DESK_BACKUP_STATUS: resolve(root, 'backup-status.json'),
    COIN_DESK_BACKUP_FOLDER: resolve(root, 'backups'),
  };
  return [
    {
      name: 'quote-hub',
      file: 'server/quote-hub.mjs',
      env: { ...env, PORT: String(options.hubPort) },
    },
    { name: 'api', file: 'server/index.mjs', env: { ...env, PORT: String(options.port) } },
    ...LANES.map((lane) => ({
      name: lane,
      file: 'server/scheduler.mjs',
      env: { ...env, COIN_DESK_LANE: lane },
    })),
    { name: 'backup', file: 'server/backup-runner.mjs', env },
  ];
}

/** Fail together: a forgotten or crashed collector cannot leave a healthy-looking API alone. */
export function supervise(services, { spawnProcess = spawn, graceMs = 28000 } = {}) {
  const children = new Set();
  let stopping = false,
    status = 0;
  let resolveDone;
  const done = new Promise((resolveDoneCallback) => {
    resolveDone = resolveDoneCallback;
  });
  let force;
  const finish = () => {
    if (stopping && children.size === 0) {
      clearTimeout(force);
      resolveDone(status);
    }
  };
  const stop = (code = 0) => {
    status = Math.max(status, code);
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    if (children.size)
      force = setTimeout(() => {
        for (const child of children) child.kill('SIGKILL');
      }, graceMs);
    finish();
  };
  for (const service of services) {
    if (stopping) break;
    try {
      const child = spawnProcess(process.execPath, [service.file], {
        env: service.env,
        stdio: 'inherit',
        windowsHide: true,
      });
      children.add(child);
      child.once('error', () => {
        console.error(JSON.stringify({ service: service.name, event: 'service_start_failed' }));
        stop(1);
      });
      child.once('close', () => {
        children.delete(child);
        if (!stopping) {
          console.error(JSON.stringify({ service: service.name, event: 'service_stopped' }));
          stop(1);
        }
        finish();
      });
    } catch {
      stop(1);
    }
  }
  return { stop, done };
}

export async function startLive(options) {
  await verifyLiveDatabase(options.database);
  await Promise.all([
    availablePort(options.port),
    availablePort(options.hubPort),
    access('dist/index.html'),
    access('server-dist/api.mjs'),
  ]);
  const { createEnvironment } = await import('./environment.mjs');
  const providers = await import('../server-dist/providers.mjs');
  const report = await checkUpstreams(await createEnvironment(null), providers);
  console.log(JSON.stringify({ event: 'upstream_preflight', ...report }));
  if (
    !report.checks.some((c) => ['upbit', 'binance'].includes(c.source) && c.ok) ||
    !report.checks.some((c) => c.source === 'coin-metrics' && c.ok)
  )
    throw new Error(
      'Price or onchain sources are unavailable; live mode was not started. Restore network/source access first.',
    );
  const db = openSqlite(options.database);
  try {
    migrate(db);
  } finally {
    db.sqlite.close();
  }
  console.log(
    JSON.stringify({
      event: 'starting_local_live',
      url: `http://127.0.0.1:${options.port}/`,
      collectionSeconds: 60,
      onchain: 'source-observation-cadence',
      allUpstreamsPassed: report.ok,
    }),
  );
  const supervised = supervise(liveServicePlan(options));
  const stop = () => supervised.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const result = await supervised.done;
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await startLive(liveOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
