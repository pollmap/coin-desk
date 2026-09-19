import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import worker from '../worker/index.ts';
import { DAY, aggregate } from '../shared/math.ts';
import { success, failure } from '../worker/storage.ts';
import { pages } from '../src/lib.ts';
let DB, env, waiting;
function mockSocket(status, result) {
  const send = vi.fn();
  class Socket {
    listeners = {};
    constructor() {
      queueMicrotask(() => this.listeners.open?.());
    }
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    }
    send(message) {
      send(message);
      queueMicrotask(() =>
        this.listeners.message?.({ data: JSON.stringify({ id: 'btc-desk', status, result }) }),
      );
    }
    close() {
      this.listeners.close?.();
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  return send;
}
beforeEach(() => {
  DB = openDatabase(':memory:');
  env = {
    DB,
    ENABLED_ASSETS: 'BTC',
    BITVIEW_BASE_URL: 'https://bitview.space',
    ASSETS: { fetch: async () => new Response('asset') },
  };
  waiting = [];
  globalThis.caches = { default: memoryCache() };
});
afterEach(async () => {
  await Promise.all(waiting);
  vi.restoreAllMocks();
  DB.sqlite.close();
});
const call = async (path, method = 'GET') => {
  const response = await worker.fetch(
    new Request('https://unit.test/api/v1/' + path, { method }),
    env,
    { waitUntil: (p) => waiting.push(p) },
  );
  return { status: response.status, data: await response.json() };
};
function insert(rows) {
  const stmt = DB.sqlite.prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for (const c of rows)
    stmt.run(
      'BTC',
      'binance',
      '1d',
      c.time,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
      c.closeTime,
      Math.floor(Date.now() / 1000),
    );
}
describe('public API contract with real SQLite', () => {
  it.each([
    'candles?asset=UNKNOWN',
    'candles?interval=5m',
    'candles?from=NaN',
    'candles?limit=1001',
    'candles?limit=0',
    'candles?from=2&to=1',
    'series?metric=unknown',
    'candles?market=evil',
  ])('rejects invalid %s', async (path) => {
    expect((await call(path)).status).toBe(400);
  });
  it('read-only methods and unsupported asset', async () => {
    expect((await call('overview', 'POST')).status).toBe(405);
    expect((await call('overview?asset=ETH')).status).toBe(404);
  });
  it('no onchain data is explicit', async () => {
    expect((await call('series')).status).toBe(503);
  });
  it('monthly pagination preserves every daily OHLCV input', async () => {
    const rows = Array.from({ length: 5100 }, (_, i) => ({
      time: 1262304000 + i * DAY,
      open: 100 + i,
      high: 110 + i,
      low: 90 + i,
      close: 105 + i,
      volume: 2,
      closeTime: 1262304000 + (i + 1) * DAY,
      closed: true,
    }));
    insert(rows);
    let cursor = 0,
      result = [];
    for (let i = 0; i < 5; i++) {
      const page = await call('candles?interval=1M&from=' + cursor);
      expect(page.status).toBe(200);
      result.push(...page.data.data);
      if (page.data.nextCursor === null) break;
      expect(page.data.nextCursor).toBeGreaterThan(cursor);
      cursor = page.data.nextCursor;
    }
    expect(result).toEqual(aggregate(rows, '1M'));
  });
  it('from within a week includes its full available bucket', async () => {
    const base = 1704067200;
    insert(
      Array.from({ length: 7 }, (_, i) => ({
        time: base + i * DAY,
        open: 10,
        high: 20,
        low: 5,
        close: 11 + i,
        volume: 1,
        closeTime: base + (i + 1) * DAY,
      })),
    );
    const { data } = await call('candles?interval=1w&from=' + (base + 2 * DAY));
    expect(data.data[0].volume).toBe(7);
    expect(data.data[0].time).toBe(base);
  });
  it.each(['1d', '1w', '1M'])('browser parallel pages preserve all %s bars', async (interval) => {
    const rows = Array.from({ length: 5100 }, (_, i) => ({
      time: 1262304000 + i * DAY,
      open: 100 + i,
      high: 110 + i,
      low: 90 + i,
      close: 105 + i,
      volume: 2,
      closeTime: 1262304000 + (i + 1) * DAY,
      closed: true,
    }));
    insert(rows);
    vi.stubGlobal('fetch', async (url) =>
      worker.fetch(new Request('https://unit.test' + url), env, {
        waitUntil: (p) => waiting.push(p),
      }),
    );
    try {
      const result = await pages(
        '/api/v1/candles?interval=' +
          interval +
          '&limit=1000&from=1262304000&to=' +
          rows.at(-1).closeTime,
      );
      expect(result.data).toEqual(aggregate(rows, interval));
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('429 retains last good quote, marks stale, backs off', async () => {
    const q = {
      asset: 'BTC',
      price: 100,
      change24h: 1,
      volume24h: 20,
      high24h: 110,
      low24h: 90,
      time: 100,
    };
    DB.sqlite
      .prepare('INSERT INTO snapshots VALUES(?,?,?)')
      .run('quote:BTC:binance', JSON.stringify(q), 1);
    const sent = mockSocket(429, {});
    const out = await call('overview');
    expect(out.data.quote.price).toBe(100);
    expect(out.data.meta.stale).toBe(true);
    globalThis.caches.default.clear();
    await call('overview');
    expect(sent).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it('empty upstream response is not converted to a zero quote', async () => {
    mockSocket(200, {});
    const out = await call('overview');
    expect(out.data.quote).toBeNull();
    expect(out.data.meta.stale).toBe(true);
    vi.unstubAllGlobals();
  });
  it('failures preserve last success and recover', async () => {
    await success(DB, 'bitview', 100);
    await failure(DB, 'bitview', new Error('HTTP 429'));
    let row = await DB.prepare('SELECT * FROM ingestion WHERE key=?').bind('bitview').first();
    expect(row.data_as_of).toBe(100);
    expect(row.failures).toBe(1);
    expect(row.next_attempt).toBeGreaterThan(row.last_attempt);
    await success(DB, 'bitview', 200);
    row = await DB.prepare('SELECT * FROM ingestion WHERE key=?').bind('bitview').first();
    expect(row.error).toBeNull();
    expect(row.data_as_of).toBe(200);
  });
});
