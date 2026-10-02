import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite, migrate } from '../sqlite.mjs';
import { createEnvironment } from '../environment.mjs';
import worker from '../../server-dist/api.mjs';

test('Market snapshot reads all eight assets without writes and isolates corrupt/stale data', async () => {
  const db = openSqlite(':memory:');
  migrate(db);
  const now = Math.floor(Date.now() / 1000);
  const put = (asset, data) =>
    db.sqlite
      .prepare('INSERT INTO snapshots VALUES(?,?,?)')
      .run(`quote:${asset}:upbit`, JSON.stringify({ volume24h: 0, change24h: null, ...data }), now);
  put('BTC', { asset: 'BTC', price: 100000000, time: now, change24h: 2, volume24h: 300 });
  put('DOGE', { asset: 'ETH', price: 4, time: now });
  put('ETH', { asset: 'ETH', price: 100, time: now - 301 });
  db.sqlite
    .prepare('INSERT INTO ingestion(key,error,failures) VALUES(?,?,1)')
    .run('quote:XRP:upbit', 'must not publish raw error detail');
  const before = db.sqlite.prepare('SELECT total_changes() AS n').get().n;
  const env = await createEnvironment(db);
  const out = await worker.fetch(new Request('http://localhost/api/v1/market?market=upbit'), env, {
    waitUntil: () => {},
  });
  assert.equal(out.status, 200);
  const body = await out.json();
  assert.equal(body.rows.length, 8);
  assert.equal(body.currency, 'KRW');
  assert.equal(body.rows.find((r) => r.asset === 'BTC').status, 'ready');
  assert.equal(body.rows.find((r) => r.asset === 'DOGE').quote, null);
  assert.equal(body.rows.find((r) => r.asset === 'DOGE').status, 'error');
  assert.equal(body.rows.find((r) => r.asset === 'ETH').status, 'delayed');
  assert.equal(body.rows.find((r) => r.asset === 'ONDO').status, 'pending');
  assert.equal(body.rows.find((r) => r.asset === 'XRP').status, 'error');
  assert.equal(JSON.stringify(body).includes('must not publish'), false);
  assert.equal(db.sqlite.prepare('SELECT total_changes() AS n').get().n, before);
  const invalid = await worker.fetch(
    new Request('http://localhost/api/v1/market?market=invalid'),
    env,
    { waitUntil: () => {} },
  );
  assert.equal(invalid.status, 400);
  db.sqlite.close();
});
