import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteHub, parseTick } from '../quote-hub.mjs';
import { ASSET_REGISTRY } from '../../server-dist/assets.mjs';

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
test('Upbit same-millisecond fills use provider event order without advancing the actual trade time', async () => {
  const now = 1800000000;
  const hub = createQuoteHub({ clock: () => now + 400 });
  const tick = (price, eventMs, tradeMs = now * 1000 + 130) => ({
    type: 'ticker',
    code: 'KRW-XAUT',
    trade_price: price,
    trade_timestamp: tradeMs,
    timestamp: eventMs,
  });
  try {
    assert.equal(hub.ingest('upbit', tick(5606000, now * 1000 + 150)), true);
    assert.equal(hub.ingest('upbit', tick(5610000, now * 1000 + 180)), true);
    const latest = hub.snapshot('upbit').quotes[0];
    assert.equal(latest.price, 5610000);
    assert.equal(latest.tradedAt, now + 0.13);
    assert.equal(latest.sourceEventTime, now + 0.18);
    assert.ok(now + 400 - latest.tradedAt > 300, 'event order never rescues an old actual trade');
    assert.equal(hub.ingest('upbit', tick(5609000, now * 1000 + 160)), false);
    assert.equal(hub.ingest('upbit', tick(9, now * 1000 + 1000, now * 1000 + 129)), false);
    assert.equal(hub.ingest('upbit', tick(1, now * 1000 + 180)), false);
    assert.equal(hub.snapshot('upbit').quotes[0].price, 5610000);
    assert.equal(parseTick('upbit', tick(1, (now + 461) * 1000), now + 400), null);
    assert.equal(parseTick('upbit', tick(1, now * 1000 + 129), now + 400), null);
  } finally {
    await hub.close();
  }
});
test('selected Upbit SSE emits a same-time price correction once and coalesces unchanged ticker events', async () => {
  const now = 1800000000;
  const hub = createQuoteHub({ clock: () => now + 1 });
  const controller = new AbortController();
  const tick = (price, eventMs) => ({
    type: 'ticker',
    code: 'KRW-XAUT',
    trade_price: price,
    trade_timestamp: now * 1000 + 130,
    timestamp: now * 1000 + eventMs,
  });
  hub.ingest('upbit', tick(5606000, 150));
  await new Promise((resolve) => hub.server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(
      'http://127.0.0.1:' + hub.server.address().port + '/stream?market=upbit&assets=XAUT',
      { signal: controller.signal },
    );
    const reader = response.body.getReader();
    let buffer = '';
    async function frame() {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary < 0) {
          const next = await reader.read();
          assert.equal(next.done, false);
          buffer += new TextDecoder().decode(next.value);
          continue;
        }
        const message = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = message.split('\n').find((line) => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
      }
    }
    assert.equal((await frame()).quotes[0].price, 5606000);
    hub.ingest('upbit', tick(5610000, 180));
    const correction = (await frame()).quotes;
    assert.equal(correction.length, 1);
    assert.equal(correction[0].price, 5610000);
    assert.equal(correction[0].tradedAt, now + 0.13);
    assert.equal(correction[0].sourceEventTime, now + 0.18);
    hub.ingest('upbit', tick(5610000, 200));
    assert.deepEqual(
      (await frame()).quotes,
      [],
      'a ticker heartbeat does not count as a changed price',
    );
    assert.equal(hub.ingest('upbit', tick(5609000, 190)), false);
    hub.ingest('upbit', tick(5611000, 220));
    assert.equal((await frame()).quotes[0].price, 5611000);
  } finally {
    controller.abort();
    await hub.close();
  }
});
test('private minute proofs retain only 64 exact trades per selected registered asset', async () => {
  const now = 1800000000;
  const hub = createQuoteHub({ clock: () => now + 10 });
  await new Promise((r) => hub.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  try {
    for (let id = 1; id <= 70; id++)
      assert.equal(
        hub.ingest('binance', {
          e: 'aggTrade',
          s: 'BTCUSDT',
          p: String(100 + id),
          T: now * 1000 + id,
          l: id,
        }),
        true,
      );
    assert.equal(
      hub.ingest('binance', { e: 'aggTrade', s: 'BTCUSDT', p: '171', T: now * 1000 + 70, l: 71 }),
      true,
    );
    const response = await fetch(base + '/snapshot?market=binance&assets=BTC');
    const proof = await response.json();
    assert.equal(response.status, 200);
    assert.equal(proof.trades.length, 64);
    assert.equal(proof.trades[0].lastTradeId, 8);
    assert.equal(proof.trades.at(-1).lastTradeId, 71);
    assert.equal(proof.trades.at(-1).price, 171);
    assert.equal(proof.trades.at(-1).tradedAt, now + 0.07);
    assert.ok(proof.trades.every((t) => t.asset === 'BTC'));
    for (const path of [
      '/snapshot?market=binance',
      '/snapshot?market=binance&assets=BTC,BTC',
      '/snapshot?market=upbit&assets=BTC',
      '/snapshot?market=binance&assets=UNKNOWN',
      '/snapshot?market=binance&assets=BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE,PENGU',
    ])
      assert.equal((await fetch(base + path)).status, 400);
  } finally {
    await hub.close();
  }
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
      controllers.map(async (c, i) => {
        const r = await fetch(base + '/stream?market=' + (i % 2 ? 'upbit' : 'binance'), {
          signal: c.signal,
        });
        assert.equal(r.status, 200);
        const reader = r.body.getReader();
        await reader.read();
        return reader;
      }),
    );
    const started = performance.now();
    hub.markets.binance.connected = true;
    hub.markets.upbit.connected = true;
    const delivered = [];
    const memoryBefore = process.memoryUsage().rss;
    for (const asset of ASSET_REGISTRY) {
      if (asset.markets.binance)
        hub.ingest('binance', { e: 'aggTrade', s: asset.markets.binance, p: 77777, T: Date.now() });
      if (asset.markets.upbit)
        hub.ingest('upbit', {
          type: 'ticker',
          code: asset.markets.upbit,
          trade_price: 77777,
          trade_timestamp: Date.now(),
        });
    }
    await Promise.all(
      readers.map(async (reader) => {
        let text = '';
        while (!text.includes('77777')) {
          const next = await reader.read();
          assert.equal(next.done, false);
          text += new TextDecoder().decode(next.value);
        }
        assert.match(text, /"connected":true/);
        delivered.push(performance.now() - started);
      }),
    );
    const latency = performance.now() - started;
    assert.ok(latency < 3000, `Local fanout took ${latency}ms`);
    console.log(
      JSON.stringify({
        test: 'local-sse-100',
        clients: 100,
        registryAssets: ASSET_REGISTRY.length,
        marketPairs: ASSET_REGISTRY.reduce(
          (n, a) => n + Number(!!a.markets.upbit) + Number(!!a.markets.binance),
          0,
        ),
        p95Ms: Math.round(delivered.sort((a, b) => a - b)[94]),
        memoryGrowthBytes: process.memoryUsage().rss - memoryBefore,
        allDeliveredMs: Math.round(latency),
        environment: 'local simulated ticks; not VPS or exchange latency',
      }),
    );
  } finally {
    controllers.forEach((c) => c.abort());
    await hub.close();
  }
});

test('selected-asset SSE only sends changed selected trades and reconnects with a snapshot', async () => {
  const hub = createQuoteHub();
  await new Promise((r) => hub.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + hub.server.address().port;
  const controllers = [];
  async function connection() {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(base + '/stream?market=binance&assets=PENGU', {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let buffer = '';
    return async () => {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find((s) => s.startsWith('data: '));
          if (data) return JSON.parse(data.slice(6));
        } else {
          const next = await reader.read();
          assert.equal(next.done, false);
          buffer += new TextDecoder().decode(next.value);
        }
      }
    };
  }
  try {
    const read = await connection();
    assert.deepEqual((await read()).quotes, []);
    hub.ingest('binance', { e: 'aggTrade', s: 'PENGUUSDT', p: '0.03', T: Date.now() });
    hub.ingest('binance', { e: 'aggTrade', s: 'BTCUSDT', p: '77777', T: Date.now() });
    const changed = await read();
    assert.equal(changed.delta, true);
    assert.deepEqual(
      changed.quotes.map((q) => q.asset),
      ['PENGU'],
    );
    assert.deepEqual((await read()).quotes, []);
    const reconnect = await connection();
    assert.deepEqual(
      (await reconnect()).quotes.map((q) => q.asset),
      ['PENGU'],
    );
    assert.equal((await fetch(base + '/stream?market=binance&assets=UNKNOWN')).status, 400);
  } finally {
    controllers.forEach((c) => c.abort());
    await hub.close();
  }
});
