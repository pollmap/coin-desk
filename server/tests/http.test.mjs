import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite, migrate } from '../sqlite.mjs';
import { createEnvironment } from '../environment.mjs';
import { createHttpServer } from '../http.mjs';
import worker from '../../server-dist/api.mjs';

test('Native server uses the real API, preserves units and errors, and never refreshes on a read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'coin-http-'));
  writeFileSync(join(root, 'PriorChart-abcdef12.js'), 'export const prior = true;');
  writeFileSync(
    join(root, 'index.html'),
    '<main>Coin Desk</main><meta content="https://coin-desk.pages.dev/brand/coin-desk-shiba-smile.png">',
  );
  const writer = openSqlite(join(root, 'db.sqlite'));
  migrate(writer);
  await writer
    .prepare('INSERT INTO reference_prices VALUES(?,?,?,?)')
    .bind('BTC', 1700000000, 35000, 1700000001)
    .run();
  const reader = openSqlite(join(root, 'db.sqlite'), { readOnly: true });
  const env = await createEnvironment(reader);
  const app = createHttpServer({
    worker,
    env,
    database: reader,
    staticRoot: root,
    retainedAssetRoot: root,
    publicOrigin: 'https://coins.example.test',
    release: 'test',
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  let upstream = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (!String(input).startsWith(base)) {
      upstream++;
      throw new Error('No external request allowed');
    }
    return original(input, init);
  };
  try {
    assert.equal((await (await fetch(base + '/healthz')).json()).ok, true);
    const reference = await (await fetch(base + '/api/v1/reference?asset=BTC')).json();
    assert.equal(reference.meta.unit, 'USD');
    assert.equal(reference.data[0].value, 35000);
    for (const asset of ['SOL', 'ONDO', 'PEPE'])
      assert.equal((await fetch(base + '/api/v1/reference?asset=' + asset)).status, 400);
    for (const asset of ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE']) {
      const response = await fetch(base + '/api/v1/overview?asset=' + asset + '&market=binance');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).quote, null);
    }
    assert.equal(upstream, 0);
    assert.equal(await writer.prepare('SELECT COUNT(*) n FROM ingestion').first('n'), 0);
    assert.equal((await fetch(base + '/api/v1/runtime')).status, 200);
    const market = await (await fetch(base + '/api/v1/market?market=upbit')).json();
    assert.equal(market.collection.healthy, false);
    assert.equal(market.collection.reason, 'not_started');
    assert.equal((await fetch(base + '/api/v1/reference', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    assert.match(await (await fetch(base + '/assets/PriorChart-abcdef12.js')).text(), /prior/);
    assert.equal((await fetch(base + '/api/v1/quotes/stream?market=other')).status, 400);
    assert.equal((await fetch(base + '/api/v1/quotes/stream?market=upbit')).status, 503);
    assert.match(await (await fetch(base + '/learn')).text(), /Coin Desk/);
    assert.match(
      await (await fetch(base + '/learn')).text(),
      /https:\/\/coins.example.test\/brand/,
    );
    assert.equal(await (await fetch(base + '/learn', { method: 'HEAD' })).text(), '');
  } finally {
    globalThis.fetch = original;
    await app.drain();
    reader.sqlite.close();
    writer.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  }
});
