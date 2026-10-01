import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite, migrate } from '../sqlite.mjs';
import { MinuteRunner, schedulerState } from '../runtime.mjs';

test('SQLite batch is atomic, validates ownership, and read-only connections reject writes', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'coin-sql-'));
  const db = openSqlite(join(folder, 'test.sqlite')),
    other = openSqlite(':memory:');
  try {
    migrate(db);
    await assert.rejects(
      db.batch([
        db.prepare('INSERT INTO state VALUES(?,?)').bind('a', 'first'),
        db.prepare('INSERT INTO state VALUES(?,?)').bind('a', 'second'),
      ]),
    );
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM state').first('n'), 0);
    await assert.rejects(db.batch([other.prepare('SELECT 1')]));
    const [result] = await db.batch([
      db.prepare('INSERT INTO state VALUES(?,?) RETURNING value').bind('a', 'saved'),
    ]);
    assert.equal(result.results[0].value, 'saved');
    const reader = openSqlite(join(folder, 'test.sqlite'), { readOnly: true });
    try {
      assert.equal(
        await reader.prepare('SELECT value FROM state WHERE key=?').bind('a').first('value'),
        'saved',
      );
      await assert.rejects(reader.prepare('DELETE FROM state').run());
    } finally {
      reader.sqlite.close();
    }
  } finally {
    db.sqlite.close();
    other.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('Migration ledger preserves historical cron runs and rejects altered applied migration', () => {
  const folder = mkdtempSync(join(tmpdir(), 'coin-migration-'));
  const db = openSqlite(':memory:');
  try {
    migrate(db);
    db.sqlite
      .prepare('INSERT INTO cron_runs VALUES(?,?,?,?,?,?,?)')
      .run(1, 'historical', 100, 101, 'background', 'ok', null);
    migrate(db);
    assert.equal(db.sqlite.prepare('SELECT run_id FROM cron_runs').get().run_id, 'historical');
    const file = '0001_initial.sql';
    writeFileSync(join(folder, file), readFileSync('migrations/' + file, 'utf8') + '\n-- changed');
    assert.throws(() => migrate(db, folder), /changed/);
    const untracked = openSqlite(':memory:');
    try {
      untracked.sqlite.exec('CREATE TABLE personal_note(value TEXT)');
      assert.throws(() => migrate(untracked), /validated export/);
    } finally {
      untracked.sqlite.close();
    }
  } finally {
    db.sqlite.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('Slow background does not block quotes; duplicate tick, overlap and failure remain observable', async () => {
  const db = openSqlite(':memory:');
  migrate(db);
  let now = 120000,
    release;
  const slow = new MinuteRunner(
    db,
    'background',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    { now: () => now },
  );
  let calls = 0;
  const fast = new MinuteRunner(
    db,
    'quotes',
    async () => {
      calls++;
    },
    { now: () => now },
  );
  try {
    const pending = slow.tick(120);
    await fast.tick(120);
    await fast.tick(120);
    assert.equal(calls, 1);
    now = 180000;
    await slow.tick(180);
    await fast.tick(180);
    assert.equal(calls, 2);
    assert.equal(
      db.sqlite
        .prepare(
          "SELECT outcome FROM _coin_desk_runtime_runs WHERE lane='background' AND scheduled_at=180",
        )
        .get().outcome,
      'skipped_overlap',
    );
    release();
    await pending;
    const error = new MinuteRunner(
      db,
      'recent',
      async () => {
        throw new Error('do not print secret');
      },
      { now: () => now },
    );
    await error.tick(180);
    assert.equal(schedulerState(db, 180).find((r) => r.lane === 'recent').healthy, false);
    assert.equal(schedulerState(db, 500).find((r) => r.lane === 'quotes').healthy, false);
    fast.stop();
    await fast.tick(240);
    assert.equal(calls, 2);
  } finally {
    db.sqlite.close();
  }
});
