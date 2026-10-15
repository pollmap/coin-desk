import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite, migrate } from '../sqlite.mjs';
import {
  assessHistoryResources,
  parseHistoryBackfillArguments,
  runHistoryBackfill,
} from '../history-backfill.mjs';
import * as operator from '../../server-dist/history-operator.mjs';
import * as budget from '../../server-dist/backfill-budget.mjs';

const GiB = 1024 ** 3;
const healthy = () => ({
  freeDiskBytes: 9 * GiB,
  availableMemoryBytes: 3 * GiB,
  cgroupAvailableBytes: 512 * 1024 ** 2,
  load1: 0.1,
  cpus: 2,
  maxTemperatureC: null,
});
function setup() {
  const db = openSqlite(':memory:');
  migrate(db);
  const at = Math.floor(Date.now() / 1000);
  const env = {
    DB: db,
    RUNTIME_KIND: 'vps',
    READ_ONLY_API: false,
    HISTORY_ALLOWED: () => true,
    DERIVATIVE_HISTORY_GRANT: {
      kind: 'operator-recovery-v1',
      id: 'recovery-20261015',
      issuedAt: at,
      expiresAt: at + 3600,
      dailyRows: 1000000,
    },
    FEED_SERVICE: {
      fetch: async () => Response.json({ retCode: 0, result: { category: 'linear', list: [] } }),
    },
  };
  return { db, env, operations: { ...operator, ...budget } };
}

test('CLI is read-only by default and requires bounded, explicit authorization, not environment defaults', () => {
  const now = 1792022400;
  assert.equal(parseHistoryBackfillArguments([], now).execute, false);
  const args = [
    '--execute-recovery',
    '--acknowledge-existing-budget',
    '--grant-id',
    'recovery-20261015',
    '--daily-row-limit',
    '1000000',
    '--expires-at',
    new Date((now + 3600) * 1000).toISOString(),
  ];
  assert.equal(parseHistoryBackfillArguments(args, now).grant.dailyRows, 1000000);
  for (const bad of [
    args.filter((x) => x !== '--execute-recovery'),
    args.filter((x) => x !== '--acknowledge-existing-budget'),
    [...args, '--daily-row-limit', '200000'],
    args.map((x) => (x === '1000000' ? '1000001' : x)),
    args.map((x) => (x === args.at(-1) ? new Date((now + 86401) * 1000).toISOString() : x)),
    ['--grant-id', 'recovery-20261015'],
  ])
    assert.throws(() => parseHistoryBackfillArguments(bad, now));
});

test('disk, memory, CPU and thermal gates cannot be relaxed; absent thermal exposure is explicit', () => {
  assert.equal(assessHistoryResources(healthy()).allowed, true);
  // Host load and host CPU count share a scope; the runtime's 0.5 CPU limit
  // separately constrains the runner, rather than making host load look busy.
  assert.equal(
    assessHistoryResources({ ...healthy(), cpus: 8, load1: 2.5, cgroupCpuQuota: 0.5 }).allowed,
    true,
  );
  assert.equal(
    assessHistoryResources({ ...healthy(), cpus: 8, load1: 6.5, cgroupCpuQuota: 0.5 }).reason,
    'paused_cpu_pressure',
  );
  for (const [field, value, reason] of [
    ['freeDiskBytes', 8 * GiB - 1, 'paused_low_space'],
    ['availableMemoryBytes', 1.5 * GiB - 1, 'paused_low_memory'],
    ['cgroupAvailableBytes', 128 * 1024 ** 2 - 1, 'paused_low_memory'],
    ['load1', 2, 'paused_cpu_pressure'],
    ['maxTemperatureC', 85, 'paused_temperature'],
  ])
    assert.equal(assessHistoryResources({ ...healthy(), [field]: value }).reason, reason);
});

test('low space makes no request or lease/budget write', async () => {
  const { db, env, operations } = setup();
  let requests = 0;
  env.FEED_SERVICE.fetch = async () => {
    requests++;
    throw new Error('must not run');
  };
  try {
    const before = db.sqlite.prepare('SELECT total_changes() n').get().n;
    const result = await runHistoryBackfill({
      env,
      operations,
      resources: () => ({ ...healthy(), freeDiskBytes: 8 * GiB - 1 }),
    });
    assert.equal(result.outcome, 'paused_low_space');
    assert.equal(requests, 0);
    assert.equal(db.sqlite.prepare('SELECT total_changes() n').get().n, before);
  } finally {
    db.sqlite.close();
  }
});

test('real SQLite checkpoints resume all-partition scheduling, pace calls and leave latest health untouched', async () => {
  const { db, env, operations } = setup();
  let clock = Date.now(),
    stop = false;
  const starts = [],
    assets = [];
  env.FEED_SERVICE.fetch = async (request) => {
    starts.push(clock);
    assets.push(new URL(request.url).searchParams.get('asset'));
    return Response.json({ retCode: 0, result: { category: 'linear', list: [] } });
  };
  try {
    await budget.reserveDerivativeBackfill(db, 10000, Math.floor(clock / 1000));
    const options = {
      env,
      operations,
      resources: healthy,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      maxPages: 3,
    };
    const first = await runHistoryBackfill(options);
    assert.equal(first.pages, 3);
    assert.equal(first.completed, 3);
    assert.equal(first.budget.reserved, 10600);
    assert.ok(starts.slice(1).every((at, i) => at - starts[i] >= 1000));
    const checkpoint = JSON.parse(
      db.sqlite.prepare('SELECT value FROM state WHERE key=?').get(operator.OPERATOR_CHECKPOINT)
        .value,
    );
    const expected = operator.historyPartitions()[3];
    assert.equal(checkpoint.nextPartition, expected.key);
    const second = await runHistoryBackfill({
      ...options,
      maxPages: 1,
      shouldStop: () => stop,
      onEvent: () => {
        stop = true;
      },
    });
    assert.equal(assets[3], expected.asset);
    assert.equal(second.budget.reserved, 10800);
    assert.equal(
      db.sqlite.prepare('SELECT COUNT(*) n FROM ingestion').get().n,
      0,
      'empty historical source cannot claim recent collection success',
    );
    assert.equal(
      db.sqlite
        .prepare('SELECT value FROM state WHERE key=?')
        .get('lease:derivatives-history-operator'),
      undefined,
    );
    const granted = JSON.parse(
      db.sqlite
        .prepare('SELECT value FROM state WHERE key=?')
        .get('history-operator:grant:recovery-20261015').value,
    );
    assert.deepEqual(granted, env.DERIVATIVE_HISTORY_GRANT);
  } finally {
    db.sqlite.close();
  }
});

test('stop, expiration and incompatible grant resumes never extend authorization or reset the budget', async () => {
  const { db, env, operations } = setup();
  let clock = Date.now(),
    stopped = false,
    requests = 0;
  env.FEED_SERVICE.fetch = async () => {
    requests++;
    return Response.json({ retCode: 0, result: { category: 'linear', list: [] } });
  };
  const options = {
    env,
    operations,
    resources: healthy,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    shouldStop: () => stopped,
  };
  try {
    const stoppedRun = await runHistoryBackfill({
      ...options,
      onEvent: () => {
        stopped = true;
      },
    });
    assert.equal(stoppedRun.outcome, 'stopped');
    assert.equal(requests, 1);
    const savedBudget = JSON.parse(
      db.sqlite.prepare("SELECT value FROM state WHERE key='budget:derivatives-backfill'").get()
        .value,
    );
    stopped = false;
    clock = env.DERIVATIVE_HISTORY_GRANT.expiresAt * 1000;
    await assert.rejects(runHistoryBackfill(options), /expired/);
    assert.equal(requests, 1);
    assert.deepEqual(
      JSON.parse(
        db.sqlite.prepare("SELECT value FROM state WHERE key='budget:derivatives-backfill'").get()
          .value,
      ),
      savedBudget,
    );
    clock = Date.now();
    env.DERIVATIVE_HISTORY_GRANT.expiresAt += 60;
    await assert.rejects(runHistoryBackfill(options), /cannot be extended/);
    assert.equal(requests, 1);
  } finally {
    db.sqlite.close();
  }
});

test('an opaque feed HTTP failure stops the whole provider run after one request without automatic retry', async () => {
  const { db, env, operations } = setup();
  let requests = 0;
  env.FEED_SERVICE.fetch = async () => {
    requests++;
    return new Response('Bybit unavailable', { status: 502 });
  };
  try {
    const result = await runHistoryBackfill({ env, operations, resources: healthy });
    assert.equal(result.outcome, 'paused_source_http');
    assert.equal(requests, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.budget.reserved, 200);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n, 0);
    assert.equal(
      db.sqlite
        .prepare("SELECT COUNT(*) n FROM state WHERE key LIKE 'history-complete:derivatives:%'")
        .get().n,
      0,
    );
  } finally {
    db.sqlite.close();
  }
});

test('all 680 completed partitions require no source request or budget reservation', async () => {
  const { db, env, operations } = setup();
  let requests = 0;
  env.FEED_SERVICE.fetch = async () => {
    requests++;
    throw new Error('completed partitions must not refetch');
  };
  const insert = db.sqlite.prepare('INSERT INTO state VALUES(?,?)');
  for (const part of operator.historyPartitions())
    insert.run('history-complete:' + part.key, String(Math.floor(Date.now() / 1000)));
  try {
    const result = await runHistoryBackfill({ env, operations, resources: healthy });
    assert.equal(result.outcome, 'complete');
    assert.equal(result.completed, 680);
    assert.equal(result.attempts, 0);
    assert.equal(requests, 0);
    assert.equal(result.budget, null);
  } finally {
    db.sqlite.close();
  }
});
