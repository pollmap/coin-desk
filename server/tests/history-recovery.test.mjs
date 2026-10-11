import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite, migrate } from '../sqlite.mjs';
import { recoverDerivativeGap } from '../../server-dist/history-recovery.mjs';

test('bounded derivative repair inserts only verified missing observations and preserves live state, source units and budget', async () => {
  const db = openSqlite(':memory:');
  migrate(db);
  const from = 1791342000,
    to = from + 3 * 3600;
  const originalState = JSON.stringify({ saved: 'unchanged' });
  db.sqlite
    .prepare('INSERT INTO state VALUES(?,?)')
    .run('cursor:derivatives:PEPE:open_interest', originalState);
  db.sqlite
    .prepare('INSERT INTO ingestion(key,last_success,data_as_of,next_attempt) VALUES(?,?,?,?)')
    .run('derivatives:PEPE:open_interest', 100, 200, 300);
  db.sqlite
    .prepare('INSERT INTO derivative_series VALUES(?,?,?,?,?)')
    .run('PEPE', 'open_interest', from, 1000, 1);
  let requests = 0;
  const env = {
    DB: db,
    HISTORY_ALLOWED: () => true,
    FEED_SERVICE: {
      fetch: async (request) => {
        requests++;
        const url = new URL(request.url);
        assert.equal(url.searchParams.get('endTime'), String(to * 1000 - 1));
        return Response.json({
          retCode: 0,
          result: {
            category: 'linear',
            symbol: '1000PEPEUSDT',
            list: [
              { timestamp: String((from + 7200) * 1000), openInterest: '3' },
              { timestamp: String((from + 3600) * 1000), openInterest: '2' },
              { timestamp: String(from * 1000), openInterest: '999' },
            ],
          },
        });
      },
    },
  };
  try {
    const changes = db.sqlite.prepare('SELECT total_changes() n').get().n;
    assert.equal(
      (await recoverDerivativeGap(env, 'PEPE', 'open_interest', from, to)).outcome,
      'recoverable',
    );
    assert.equal(
      db.sqlite.prepare('SELECT total_changes() n').get().n,
      changes,
      'dry-run writes nothing',
    );
    const result = await recoverDerivativeGap(env, 'PEPE', 'open_interest', from, to, true);
    assert.equal(result.inserted, 2);
    assert.equal(result.remainingSlots, 0);
    assert.deepEqual(
      db.sqlite
        .prepare('SELECT value FROM derivative_series ORDER BY time')
        .all()
        .map((r) => r.value),
      [1000, 2000, 3000],
    );
    assert.equal(
      db.sqlite
        .prepare('SELECT value FROM state WHERE key=?')
        .get('cursor:derivatives:PEPE:open_interest').value,
      originalState,
    );
    assert.equal(db.sqlite.prepare('SELECT last_success FROM ingestion').get().last_success, 100);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM raw_samples').get().n, 1);
    assert.equal(
      (await recoverDerivativeGap(env, 'PEPE', 'open_interest', from, to, true)).outcome,
      'already_present',
    );
    const day = Math.floor(Date.now() / 1000 / 86400);
    db.sqlite
      .prepare("UPDATE state SET value=? WHERE key='budget:derivatives-backfill'")
      .run(JSON.stringify({ day, reserved: 10000 }));
    const before = requests;
    assert.equal(
      (await recoverDerivativeGap(env, 'PEPE', 'open_interest', from, to, true)).outcome,
      'paused_daily_budget',
    );
    assert.equal(requests, before);
  } finally {
    db.sqlite.close();
  }
});

test('malformed or empty providers never invent an observation or advance collector success', async () => {
  const db = openSqlite(':memory:');
  migrate(db);
  const from = 1791342000,
    to = from + 3600;
  let data = { retCode: 0, result: { category: 'linear', symbol: 'ETHUSDT', list: [] } };
  const env = {
    DB: db,
    HISTORY_ALLOWED: () => true,
    FEED_SERVICE: { fetch: async () => Response.json(data) },
  };
  try {
    await assert.rejects(
      recoverDerivativeGap(env, 'BTC', 'open_interest', from, to, true),
      /Invalid derivatives/,
    );
    data = { retCode: 0, result: { category: 'linear', symbol: 'BTCUSDT', list: [] } };
    assert.equal(
      (await recoverDerivativeGap(env, 'BTC', 'open_interest', from, to, true)).outcome,
      'provider_no_observation_at_check',
    );
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM derivative_series').get().n, 0);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM ingestion').get().n, 0);
  } finally {
    db.sqlite.close();
  }
});
