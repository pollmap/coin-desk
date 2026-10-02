import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteHub, parseTick } from '../quote-hub.mjs';

test('Ticks preserve actual trade time, spot PEPE units, and reject malformed or foreign markets', () => {
  const now = 1800000000;
  const q = parseTick(
    'upbit',
    {
      type: 'ticker',
      code: 'KRW-BTC',
      trade_price: 100000000,
      trade_timestamp: now * 1000,
      timestamp: (now + 10) * 1000,
      signed_change_rate: 0.7,
    },
    now,
  );
  assert.equal(q.tradedAt, now);
  assert.equal(q.price, 100000000);
  assert.equal(q.change24h, undefined);
  assert.equal(
    parseTick(
      'binance',
      { data: { e: 'aggTrade', s: 'PEPEUSDT', p: '0.000007', T: now * 1000 } },
      now,
    ).price,
    0.000007,
  );
  for (const data of [
    { e: 'aggTrade', s: '1000PEPEUSDT', p: '.007', T: now * 1000 },
    { e: '24hrTicker', s: 'BTCUSDT', p: '4', T: now * 1000 },
    { e: 'aggTrade', s: 'BTCUSDT', p: 'NaN', T: now * 1000 },
    { e: 'aggTrade', s: 'BTCUSDT', p: '1', T: (now + 61) * 1000 },
  ])
    assert.equal(parseTick('binance', data, now), null);
});
test('Old and duplicate trades cannot overwrite the latest quote, and restarts have a new epoch', async () => {
  const hub = createQuoteHub({ clock: () => 1800000000 });
  const tick = (time, price) => ({ e: 'aggTrade', s: 'BTCUSDT', p: price, T: time * 1000 });
  assert.equal(hub.ingest('binance', tick(1800000000, 10)), true);
  assert.equal(hub.ingest('binance', tick(1800000000, 9)), false);
  assert.equal(hub.ingest('binance', tick(1799999999, 8)), false);
  assert.equal(hub.snapshot('binance').quotes[0].price, 10);
  const other = createQuoteHub();
  assert.notEqual(hub.snapshot('binance').epoch, other.snapshot('binance').epoch);
  await hub.close();
  await other.close();
});
test('100 local SSE clients receive coalesced ticks and invalid markets fail closed', async () => {
  const hub = createQuoteHub();
  await new Promise((r) => hub.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const controllers = Array.from({ length: 100 }, () => new AbortController());
  try {
    for (const market of ['other', '__proto__', 'constructor'])
      assert.equal((await fetch(base + '/stream?market=' + market)).status, 400);
    assert.equal(parseTick('binance', null), null);
    assert.equal((await fetch(base + '/stream?market=upbit&market=binance')).status, 400);
    const readers = await Promise.all(
      controllers.map(async (c) => {
        const r = await fetch(base + '/stream?market=binance', { signal: c.signal });
        assert.equal(r.status, 200);
        const reader = r.body.getReader();
        await reader.read();
        return reader;
      }),
    );
    const started = performance.now();
    hub.markets.binance.connected = true;
    hub.ingest('binance', { e: 'aggTrade', s: 'BTCUSDT', p: 77777, T: Date.now() });
    await Promise.all(
      readers.map(async (reader) => {
        let text = '';
        while (!text.includes('77777')) {
          const next = await reader.read();
          assert.equal(next.done, false);
          text += new TextDecoder().decode(next.value);
        }
        assert.match(text, /"connected":true/);
      }),
    );
    const latency = performance.now() - started;
    assert.ok(latency < 3000, `Local fanout took ${latency}ms`);
    console.log(
      JSON.stringify({
        test: 'local-sse-100',
        clients: 100,
        allDeliveredMs: Math.round(latency),
        environment: 'local simulated ticks; not VPS or exchange latency',
      }),
    );
  } finally {
    controllers.forEach((c) => c.abort());
    await hub.close();
  }
});
