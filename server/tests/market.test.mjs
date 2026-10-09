import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite, migrate } from '../sqlite.mjs';
import { createEnvironment } from '../environment.mjs';
import worker from '../../server-dist/api.mjs';

test('Market snapshot reads 150 registered assets without writes and isolates corrupt/stale data', async () => {
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
    .run('quote:ETH:upbit', 'StaleQuoteError: QUOTE_STALE: last trade exceeds 300 seconds');
  db.sqlite
    .prepare('INSERT INTO ingestion(key,error,failures) VALUES(?,?,1)')
    .run('quote:DOGE:upbit', 'StaleQuoteError: QUOTE_STALE: last trade exceeds 300 seconds');
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
  assert.equal(body.rows.length, 150);
  assert.equal(body.currency, 'KRW');
  assert.equal(body.rows.find((r) => r.asset === 'BTC').status, 'ready');
  assert.equal(body.rows.find((r) => r.asset === 'DOGE').quote, null);
  assert.equal(body.rows.find((r) => r.asset === 'DOGE').status, 'error');
  assert.equal(body.rows.find((r) => r.asset === 'ETH').status, 'delayed');
  assert.equal(body.rows.find((r) => r.asset === 'ONDO').status, 'pending');
  assert.equal(body.rows.find((r) => r.asset === 'XRP').status, 'error');
  assert.equal(JSON.stringify(body).includes('must not publish'), false);
  const page = await (
    await worker.fetch(
      new Request(
        'http://localhost/api/v1/market?market=upbit&supported=1&offset=20&limit=20&spark_limit=0',
      ),
      env,
      { waitUntil: () => {} },
    )
  ).json();
  assert.equal(page.rows.length, 20);
  assert.equal(page.total, 103);
  assert.ok(page.rows.every((r) => r.status !== 'unsupported' && r.spark.length === 0));
  const penguin = await (
    await worker.fetch(new Request('http://localhost/api/v1/assets?q=%ED%8E%AD%EA%B7%84'), env, {
      waitUntil: () => {},
    })
  ).json();
  assert.deepEqual(
    penguin.data.map((a) => a.id),
    ['PENGU'],
  );
  const filtered = await (
    await worker.fetch(
      new Request('http://localhost/api/v1/market?market=binance&assets=PENGU,BNB&spark_limit=0'),
      env,
      { waitUntil: () => {} },
    )
  ).json();
  assert.deepEqual(
    filtered.rows.map((r) => r.asset),
    ['PENGU', 'BNB'],
  );
  assert.equal(db.sqlite.prepare('SELECT total_changes() AS n').get().n, before);
  const invalid = await worker.fetch(
    new Request('http://localhost/api/v1/market?market=invalid'),
    env,
    { waitUntil: () => {} },
  );
  assert.equal(invalid.status, 400);
  db.sqlite.close();
});
