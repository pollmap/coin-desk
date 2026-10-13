import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicBinanceSession } from '../binance-session.mjs';

function transport(reply = (request) => ({ id: request.id, status: 200, result: [] })) {
  const sockets = [],
    requests = [];
  class Socket {
    readyState = 0;
    listeners = {};
    constructor(url) {
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.listeners.open?.();
      });
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    send(text) {
      const request = JSON.parse(text);
      requests.push(request);
      const response = reply(request);
      if (response)
        queueMicrotask(() => this.listeners.message?.({ data: JSON.stringify(response) }));
    }
    close() {
      this.readyState = 3;
      this.listeners.close?.();
    }
  }
  return { Socket, sockets, requests };
}
test('150 bounded public requests reuse one socket, retain unique response identities, and never accept trading methods', async () => {
  const t = transport((r) => ({ id: r.id, status: 200, result: [r.id] }));
  const session = createPublicBinanceSession({ WebSocketClass: t.Socket });
  try {
    const ids = [];
    for (let batch = 0; batch < 19; batch++) {
      const rows = await Promise.all(
        Array.from({ length: Math.min(8, 150 - ids.length) }, () =>
          session.request(
            'trades.aggregate',
            { symbol: 'BTCUSDT', endTime: Date.now(), limit: 1 },
            1500,
          ),
        ),
      );
      ids.push(...rows.flat());
    }
    assert.equal(ids.length, 150);
    assert.equal(new Set(ids).size, 150);
    assert.equal(t.sockets.length, 1);
    assert.equal(t.requests.length, 150);
    for (const [method, params] of [
      ['order.place', { symbol: 'BTCUSDT' }],
      ['trades.aggregate', { symbol: 'UNKNOWN', endTime: Date.now(), limit: 1 }],
      ['trades.aggregate', { symbol: 'BTCUSDT', endTime: Date.now(), limit: 1, fromId: 1 }],
    ])
      await assert.rejects(session.request(method, params));
    assert.equal(t.requests.length, 150);
  } finally {
    session.close();
  }
});
test('source rate limits respect retryAfter without repeated reconnects, and timed-out requests release their slot', async () => {
  let now = Date.now();
  const t = transport((r) => ({ id: r.id, status: 429, retryAfter: now + 60000 }));
  const session = createPublicBinanceSession({ WebSocketClass: t.Socket, clock: () => now });
  try {
    await assert.rejects(session.request('ticker.24hr', { symbol: 'BTCUSDT' }), /429/);
    await assert.rejects(session.request('ticker.24hr', { symbol: 'BTCUSDT' }), /retry wait/);
    assert.equal(t.requests.length, 1);
    assert.equal(t.sockets.length, 1);
    now += 60001;
    await assert.rejects(session.request('ticker.24hr', { symbol: 'BTCUSDT' }), /429/);
    assert.equal(t.requests.length, 2);
  } finally {
    session.close();
  }
  const silent = transport(() => null);
  const timed = createPublicBinanceSession({ WebSocketClass: silent.Socket, maxPending: 1 });
  try {
    const pending = assert.rejects(
      timed.request('ticker.24hr', { symbol: 'BTCUSDT' }, 20),
      /timeout/,
    );
    await assert.rejects(timed.request('ticker.24hr', { symbol: 'BTCUSDT' }, 20), /queue full/);
    await pending;
    await assert.rejects(timed.request('ticker.24hr', { symbol: 'BTCUSDT' }, 20), /timeout/);
    assert.equal(silent.sockets.length, 1);
  } finally {
    timed.close();
  }
});
test('connection failure is bounded and the next request reconnects; the idle connection is closed', async () => {
  const t = transport(() => null);
  const session = createPublicBinanceSession({ WebSocketClass: t.Socket, idleMs: 10 });
  try {
    const waiting = assert.rejects(
      session.request('ticker.24hr', { symbol: 'BTCUSDT' }),
      /connection failed/,
    );
    await new Promise((r) => setImmediate(r));
    t.sockets[0].listeners.error();
    await waiting;
    const again = assert.rejects(
      session.request('ticker.24hr', { symbol: 'BTCUSDT' }, 10),
      /timeout/,
    );
    await again;
    assert.equal(t.sockets.length, 2);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(t.sockets.at(-1).readyState, 3);
  } finally {
    session.close();
  }
});
