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
  vi.unstubAllGlobals();
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
it('refreshes a quote after one minute and shares that refresh with subsequent readers', async () => {
  const now = Math.floor(Date.now() / 1000);
  DB.sqlite
    .prepare('INSERT INTO snapshots VALUES(?,?,?)')
    .run(
      'quote:BTC:binance',
      JSON.stringify({ asset: 'BTC', price: 100, time: now - 61 }),
      now - 61,
    );
  const send = mockSocket(200, {
    symbol: 'BTCUSDT',
    lastPrice: '120',
    priceChangePercent: '1',
    quoteVolume: '1000',
    highPrice: '125',
    lowPrice: '90',
    closeTime: now * 1000,
  });
  try {
    const first = await call('overview');
    const second = await call('overview');
    expect(first.data.quote.price).toBe(120);
    expect(second.data.quote.price).toBe(120);
    expect(first.data.meta.stale).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it('overview bypasses stale edge responses after the server updates its snapshot', async () => {
  const now = Math.floor(Date.now() / 1000);
  const quote = { asset: 'BTC', price: 120, time: now };
  DB.sqlite
    .prepare('INSERT INTO snapshots VALUES(?,?,?)')
    .run('quote:BTC:binance', JSON.stringify(quote), now);
  const match = vi
    .spyOn(caches.default, 'match')
    .mockResolvedValue(
      new Response(JSON.stringify({ quote: { price: 99 }, meta: { stale: true } })),
    );
  const out = await call('overview');
  expect(out.status).toBe(200);
  expect(out.data.quote.price).toBe(120);
  expect(out.data.meta.stale).toBe(false);
  expect(match).not.toHaveBeenCalled();
});

it('exhausted D1 writes keep stored prices readable and explicitly delayed', async () => {
  const now = Math.floor(Date.now() / 1000);
  DB.sqlite
    .prepare('INSERT INTO snapshots VALUES(?,?,?)')
    .run(
      'quote:BTC:binance',
      JSON.stringify({ asset: 'BTC', price: 120, time: now - 600 }),
      now - 600,
    );
  DB.sqlite.exec(
    "CREATE TRIGGER deny_state_write BEFORE INSERT ON state BEGIN SELECT RAISE(FAIL, 'D1_ERROR: daily row write limit'); END",
  );
  // Model both outages explicitly; never depend on the real exchange being unavailable.
  mockSocket(429, {});
  const out = await call('overview');
  expect(out.status).toBe(200);
  expect(out.data.quote.price).toBe(120);
  expect(out.data.meta.stale).toBe(true);
  expect(out.data.meta.warning).toContain('저장·갱신');
  expect(out.data.technical).toBeDefined();
});

it.each([true, false])(
  'quota failure still returns a fresh exchange quote (stored snapshot: %s)',
  async (hasSnapshot) => {
    const now = Math.floor(Date.now() / 1000);
    if (hasSnapshot)
      DB.sqlite
        .prepare('INSERT INTO snapshots VALUES(?,?,?)')
        .run(
          'quote:BTC:binance',
          JSON.stringify({ asset: 'BTC', price: 120, time: now - 600 }),
          now - 600,
        );
    DB.sqlite.exec(
      "CREATE TRIGGER deny_state_write BEFORE INSERT ON state BEGIN SELECT RAISE(FAIL, 'D1_ERROR: daily row write limit'); END",
    );
    mockSocket(200, {
      symbol: 'BTCUSDT',
      lastPrice: '150',
      priceChangePercent: '1',
      quoteVolume: '1000',
      highPrice: '155',
      lowPrice: '90',
      closeTime: now * 1000,
    });
    const out = await call('overview');
    expect(out.status).toBe(200);
    expect(out.data.quote.price).toBe(150);
    expect(out.data.meta.stale).toBe(false);
    expect(out.data.meta.warning).toContain('자동 저장');
    const stored = DB.sqlite
      .prepare('SELECT data FROM snapshots WHERE key=?')
      .get('quote:BTC:binance');
    expect(stored ? JSON.parse(stored.data).price : null).toBe(hasSnapshot ? 120 : null);
  },
);

it('a failed failure-log write does not hide the last good quote', async () => {
  DB.sqlite
    .prepare('INSERT INTO snapshots VALUES(?,?,?)')
    .run('quote:BTC:binance', JSON.stringify({ asset: 'BTC', price: 120, time: 100 }), 100);
  DB.sqlite.exec(
    "CREATE TRIGGER deny_error_write BEFORE INSERT ON ingestion BEGIN SELECT RAISE(FAIL, 'D1_ERROR: daily row write limit'); END",
  );
  mockSocket(429, {});
  const out = await call('overview');
  expect(out.status).toBe(200);
  expect(out.data.quote.price).toBe(120);
  expect(out.data.meta.stale).toBe(true);
  vi.unstubAllGlobals();
});

it('a collector winning the refresh lease is re-read before returning the quote', async () => {
  const now = Math.floor(Date.now() / 1000);
  DB.sqlite
    .prepare('INSERT INTO snapshots VALUES(?,?,?)')
    .run(
      'quote:BTC:binance',
      JSON.stringify({ asset: 'BTC', price: 99, time: now - 600 }),
      now - 600,
    );
  DB.sqlite
    .prepare('INSERT INTO state VALUES(?,?)')
    .run('lease:quote:BTC:binance', String(now + 180));
  const prepare = DB.prepare.bind(DB);
  let advanced = false;
  vi.spyOn(DB, 'prepare').mockImplementation((sql) => {
    if (!advanced && sql.startsWith('INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT')) {
      advanced = true;
      DB.sqlite
        .prepare('UPDATE snapshots SET data=?,fetched_at=?')
        .run(JSON.stringify({ asset: 'BTC', price: 120, time: now }), now);
    }
    return prepare(sql);
  });
  const out = await call('overview');
  expect(advanced).toBe(true);
  expect(out.data.quote.price).toBe(120);
  expect(out.data.meta.stale).toBe(false);
});

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

it('overview refreshes technicals when a new closed day arrives and excludes the live candle', async () => {
  const now = Math.floor(Date.now() / 1000),
    today = Math.floor(now / DAY) * DAY;
  DB.sqlite
    .prepare('INSERT INTO snapshots VALUES(?,?,?)')
    .run('quote:BTC:binance', JSON.stringify({ asset: 'BTC', price: 300, time: now }), now);
  const insert = DB.sqlite.prepare(
    'INSERT INTO candles(asset,market,interval,time,open,high,low,close,volume,close_time,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (let i = 0; i < 200; i++) {
    const t = today - (201 - i) * DAY,
      value = 100 + i;
    insert.run('BTC', 'binance', '1d', t, value, value, value, value, 1, t + DAY - 1, now);
  }
  const first = await call('overview?asset=BTC&market=binance');
  expect(first.data.technical).toMatchObject({ asOf: today - 2 * DAY, sma200: 199.5 });
  insert.run('BTC', 'binance', '1d', today - DAY, 300, 300, 300, 300, 1, today - 1, now);
  insert.run('BTC', 'binance', '1d', today, 99999, 99999, 99999, 99999, 1, today + DAY - 1, now);
  const next = await call('overview?asset=BTC&market=binance');
  expect(next.data.technical).toMatchObject({ asOf: today - DAY, sma200: 200.5 });
});
