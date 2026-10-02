import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite, migrate } from '../sqlite.mjs';
import { liveOptions, liveServicePlan, verifyLiveDatabase, supervise } from '../live.mjs';
import { schedulerState } from '../runtime.mjs';

test('Live startup requires an explicit verified DB and preserves an untracked cache', async () => {
  assert.throws(() => liveOptions([]), /explicit validated/);
  assert.throws(() => liveOptions(['--database', 'a.sqlite', '--port', '80']), /unprivileged/);
  assert.throws(
    () => liveOptions(['--database', 'a.sqlite', '--port', '5209', '--hub-port', '5209']),
    /distinct/,
  );
  const folder = mkdtempSync(join(tmpdir(), 'coin-live-'));
  const path = join(folder, 'live.sqlite');
  const db = openSqlite(path);
  try {
    db.sqlite.exec("CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('existing');");
    assert.deepEqual(
      schedulerState(db).map((r) => r.healthy),
      [false, false, false, false],
    );
    await assert.rejects(verifyLiveDatabase(path), /no validated import/);
    assert.equal(db.sqlite.prepare('SELECT value FROM preserved').get().value, 'existing');
    const tracked = openSqlite(join(folder, 'tracked.sqlite'));
    try {
      migrate(tracked);
      await verifyLiveDatabase(join(folder, 'tracked.sqlite'));
      tracked.sqlite
        .prepare('UPDATE _coin_desk_migrations SET sha256=? WHERE name=?')
        .run('bad', '0001_initial.sql');
      await assert.rejects(
        verifyLiveDatabase(join(folder, 'tracked.sqlite')),
        /migration verification/,
      );
    } finally {
      tracked.sqlite.close();
    }
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('A collector exit stops all seven owned services instead of leaving a stale API', async () => {
  const plan = liveServicePlan(liveOptions(['--database', 'work/validated.sqlite']));
  const children = [];
  const supervised = supervise(plan, {
    spawnProcess: (_command, args, options) => {
      const child = new EventEmitter();
      child.killed = false;
      child.kill = () => {
        if (!child.killed) {
          child.killed = true;
          queueMicrotask(() => child.emit('close', 0));
        }
      };
      children.push({ child, file: args[0], env: options.env });
      return child;
    },
    graceMs: 1000,
  });
  assert.equal(children.length, 7);
  const api = children.find((c) => c.file.endsWith('/index.mjs'));
  const hub = children.find((c) => c.file.endsWith('/quote-hub.mjs'));
  assert.equal(api.env.COIN_DESK_QUOTE_HUB, `http://127.0.0.1:${hub.env.PORT}`);
  assert.equal(children.filter((c) => c.env.COIN_DESK_LANE).length, 4);
  const failed = children.find((c) => c.env.COIN_DESK_LANE === 'quotes');
  failed.child.emit('close', 1);
  assert.equal(await supervised.done, 1);
  assert.ok(children.filter((c) => c !== failed).every((c) => c.child.killed));
});

test('Operator stop shuts down the owned services without reporting success on a crashed child', async () => {
  const children = [];
  const group = supervise([{ name: 'api', file: 'server/index.mjs', env: {} }], {
    spawnProcess: () => {
      const child = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit('close', 0));
      children.push(child);
      return child;
    },
  });
  group.stop();
  assert.equal(await group.done, 0);
});
