import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectExchange } from '../quote-hub.mjs';

function transport() {
  const sockets = [];
  class Socket {
    handlers = new Map();
    sent = [];
    closeCalls = 0;
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    addEventListener(name, listener) {
      this.handlers.set(name, listener);
    }
    emit(name, event) {
      return this.handlers.get(name)?.(event);
    }
    send(message) {
      this.sent.push(JSON.parse(message));
    }
    close() {
      this.closeCalls++;
    }
  }
  return { Socket, sockets };
}
function observedHub() {
  const ingested = [];
  return {
    ingested,
    markets: { upbit: { connected: false }, binance: { connected: false } },
    ingest(market, message) {
      ingested.push({ market, message });
      return true;
    },
  };
}
function delayedFrame() {
  let resolve;
  const text = new Promise((done) => (resolve = done));
  return { event: { data: { text: () => text } }, resolve };
}

test('stopped exchange connections cannot accept an already decoding binary frame or reopen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1800000000000 });
  const hub = observedHub();
  const network = transport();
  const stop = connectExchange(hub, 'upbit', network.Socket);
  const first = network.sockets[0];
  first.emit('open');
  assert.equal(hub.markets.upbit.connected, true);
  const frame = delayedFrame();
  const decoding = first.emit('message', frame.event);
  stop();
  frame.resolve(JSON.stringify({ type: 'ticker', code: 'KRW-BTC', trade_price: 100 }));
  await decoding;
  assert.deepEqual(hub.ingested, [], 'a pending Blob decode must not ingest after stop');
  first.emit('open');
  assert.equal(hub.markets.upbit.connected, false);
  assert.equal(first.sent.length, 1, 'the stopped socket cannot resubscribe');
  first.emit('close');
  t.mock.timers.tick(200000);
  assert.equal(network.sockets.length, 1, 'stopped connections cannot retry');
});

test('a replaced connection cannot deliver delayed binary data or change the replacement lifecycle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1800000000000 });
  const hub = observedHub();
  const network = transport();
  const stop = connectExchange(hub, 'binance', network.Socket);
  try {
    const old = network.sockets[0];
    old.emit('open');
    const frame = delayedFrame();
    const decoding = old.emit('message', frame.event);
    old.emit('close');
    t.mock.timers.tick(2001);
    assert.equal(network.sockets.length, 2);
    const current = network.sockets[1];
    current.emit('open');
    await current.emit('message', { data: JSON.stringify({ source: 'current' }) });
    frame.resolve(JSON.stringify({ source: 'old-delayed' }));
    await decoding;
    assert.deepEqual(
      hub.ingested.map((r) => r.message.source),
      ['current'],
    );
    old.emit('error');
    assert.equal(current.closeCalls, 0, 'old errors cannot close the replacement socket');
    old.emit('close');
    assert.equal(hub.markets.binance.connected, true, 'old close cannot mark replacement offline');
    t.mock.timers.tick(2001);
    assert.equal(network.sockets.length, 2, 'one close creates at most one replacement');
  } finally {
    stop();
  }
});
