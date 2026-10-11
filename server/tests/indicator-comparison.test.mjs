import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite, migrate } from '../sqlite.mjs';
import { createEnvironment } from '../environment.mjs';
import { createHttpServer } from '../http.mjs';
import worker from '../../server-dist/api.mjs';

test('comparison reads full confirmed archive history, shares exact dates, isolates unsupported rows and invalidates cache on writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bori-comparison-'));
  writeFileSync(join(root, 'index.html'), '<main>test</main>');
  const writer = openSqlite(join(root, 'db.sqlite'));
  migrate(writer);
  const now = Math.floor(Date.now() / 1000),
    day = 86400,
    last = Math.floor(now / day) * day - day,
    first = last - 40 * day;
  const prices = Array.from({ length: 41 }, (_, i) => 100 + Math.sin(i * 0.8) * 10 + i);
  for (const asset of ['BTC', 'ETH']) {
    const archive = [];
    for (let i = 0; i < prices.length; i++) {
      const time = first + i * day,
        price = prices[i];
      const candle = [time, price, price + 1, price - 1, price, 100, time + day];
      if (i < 20) archive.push(candle);
      else
        writer.sqlite
          .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(asset, 'binance', '1d', ...candle, now);
    }
    writer.sqlite
      .prepare('INSERT INTO price_archive VALUES(?,?,?,?,?,?,?)')
      .run(asset, 'binance', '1d', first, first + 20 * day, JSON.stringify(archive), now);
    writer.sqlite
      .prepare('INSERT INTO ingestion(key,last_success,data_as_of,next_attempt) VALUES(?,?,?,?)')
      .run(`${asset}:binance:1d`, now, last, now + 3600);
  }
  const reader = openSqlite(join(root, 'db.sqlite'), { readOnly: true });
  const env = await createEnvironment(reader);
  const app = createHttpServer({
    worker,
    env,
    database: reader,
    staticRoot: root,
    publicOrigin: 'https://test.invalid',
    release: 'test',
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const original = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    assert.ok(String(url).startsWith(base), 'read must never collect upstream');
    return original(url, init);
  };
  const read = async (query) =>
    (await fetch(base + '/api/v1/indicator-comparison?' + query)).json();
  try {
    for (const q of [
      'assets=BTC',
      'assets=BTC,BTC',
      'assets=BTC,ETH&source=bybit',
      'metric=garbage',
      'assets=BTC,ETH&from=1&to=0',
    ])
      assert.equal((await fetch(base + '/api/v1/indicator-comparison?' + q)).status, 400, q);
    const from = first + 32 * day;
    const query = `assets=BTC,ETH&metric=rsi&source=binance&period=all&from=${from}&to=${now}`;
    const result = await read(query);
    assert.equal(result.rows[0].state, 'ready');
    assert.equal(result.common.observations, 9);
    // Independent Wilder recurrence over ALL prior candles, including the archive.
    let gain = 0,
      loss = 0;
    for (let i = 1; i <= 14; i++) {
      gain += Math.max(0, prices[i] - prices[i - 1]) / 14;
      loss += Math.max(0, prices[i - 1] - prices[i]) / 14;
    }
    const expected = [];
    for (let i = 14; i < prices.length; i++) {
      if (i > 14) {
        gain = (gain * 13 + Math.max(0, prices[i] - prices[i - 1])) / 14;
        loss = (loss * 13 + Math.max(0, prices[i - 1] - prices[i])) / 14;
      }
      if (i >= 32) expected.push(100 - 100 / (1 + gain / loss));
    }
    result.rows[0].data.forEach((p, i) => assert.ok(Math.abs(p.value - expected[i]) < 1e-10));
    const coverage = await (await fetch(base + '/api/v1/coverage?asset=BTC')).json();
    const daily = coverage.sources.find((s) => s.id === 'binance:1d');
    assert.equal(daily.first, first);
    assert.equal(daily.observations, 41);
    assert.equal(daily.gaps.slots, 0);
    writer.sqlite
      .prepare('INSERT INTO snapshots(key,data,fetched_at) VALUES(?,?,?)')
      .run('quote:BTC:binance', '{broken', now);
    const damaged = await (await fetch(base + '/api/v1/coverage?asset=BTC')).json();
    assert.equal(damaged.sources.find((s) => s.id === 'binance:1d').observations, 41);
    assert.equal(
      damaged.quoteStates.find((s) => s.source === 'binance').condition,
      'collection-error',
    );
    assert.equal(reader.sqlite.prepare('SELECT total_changes() n').get().n, 0);
    const unavailable = await read('assets=ONDO,BTC&metric=net:mvrv');
    assert.equal(unavailable.rows[0].state, 'unsupported');
    assert.equal(unavailable.rows[1].state, 'pending');
    writer.sqlite
      .prepare(
        'UPDATE candles SET close=close+25 WHERE asset=? AND market=? AND interval=? AND time=?',
      )
      .run('BTC', 'binance', '1d', last);
    const corrected = await read(query);
    assert.notEqual(corrected.rows[0].data.at(-1).value, result.rows[0].data.at(-1).value);
    assert.deepEqual(corrected.rows[0].data.slice(0, -1), result.rows[0].data.slice(0, -1));
    writer.sqlite
      .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('BTC', 'binance', '1d', last + day, 1, 2, 0.5, 2, 1, last + 2 * day, now);
    assert.deepEqual(
      (await read(query)).rows[0].data,
      corrected.rows[0].data,
      'in-progress candle never changes confirmed history',
    );
    const dd = await read(
      `assets=BTC,ETH&metric=drawdown&source=binance&period=all&from=${from}&to=${now}`,
    );
    const i = 32,
      peak = Math.max(...prices.slice(0, i + 1));
    assert.ok(Math.abs(dd.rows[0].data[0].value - (prices[i] / peak - 1) * 100) < 1e-10);
    const version = reader.sqlite.prepare('SELECT total_changes() n').get().n;
    await read(query);
    assert.equal(reader.sqlite.prepare('SELECT total_changes() n').get().n, version);
  } finally {
    globalThis.fetch = original;
    await new Promise((resolve) => app.server.close(resolve));
    reader.sqlite.close();
    writer.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  }
});
