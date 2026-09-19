import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import worker from '../worker/index.ts';
import { claimRefresh } from '../worker/storage.ts';
import { getQuote, validateQuote, getRecentCandles } from '../worker/providers.ts';
let DB, env, waiting;
const now = () => Math.floor(Date.now() / 1000);
const goodQuote = () => ({
  asset: 'BTC',
  price: 100,
  change24h: 1,
  volume24h: 20,
  high24h: 110,
  low24h: 90,
  time: now(),
});
beforeEach(() => {
  DB = openDatabase(':memory:');
  env = {
    DB,
    ENABLED_ASSETS: 'BTC,DOGE',
    BITVIEW_BASE_URL: 'https://bitview.space',
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
  };
  waiting = [];
  vi.stubGlobal('caches', { default: memoryCache() });
});
afterEach(async () => {
  await Promise.all(waiting);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  DB.sqlite.close();
});
const call = (path, host = 'unit.test') =>
  worker.fetch(new Request('https://' + host + path), env, { waitUntil: (p) => waiting.push(p) });
function mockSocket(result) {
  let calls = 0;
  class Socket {
    listeners = {};
    constructor() {
      queueMicrotask(() => this.listeners.open?.());
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    send() {
      calls++;
      queueMicrotask(() =>
        this.listeners.message?.({ data: JSON.stringify({ id: 'btc-desk', status: 200, result }) }),
      );
    }
    close() {
      this.listeners.close?.();
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  return () => calls;
}
it('only one concurrent lease changes the database; rejected claims write zero rows', async () => {
  expect(
    (
      await Promise.all(
        Array.from({ length: 20 }, () => claimRefresh(DB, 'quote:BTC:binance', 120)),
      )
    ).filter(Boolean),
  ).toHaveLength(1);
  const before = DB.sqlite.prepare('SELECT total_changes() n').get().n;
  expect(await claimRefresh(DB, 'quote:BTC:binance', 120)).toBe(false);
  expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(before);
  DB.sqlite
    .prepare('UPDATE state SET value=? WHERE key=?')
    .run(String(now() - 1), 'lease:quote:BTC:binance');
  expect(await claimRefresh(DB, 'quote:BTC:binance', 120)).toBe(true);
});
it('equivalent and concurrent quote requests refresh once and persist the latest quote', async () => {
  const calls = mockSocket({
    lastPrice: '100',
    priceChangePercent: '1',
    quoteVolume: '20',
    highPrice: '110',
    lowPrice: '90',
    closeTime: Date.now(),
  });
  const replies = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      call(i % 2 ? '/api/v1/overview?market=binance&asset=btc' : '/api/v1/overview'),
    ),
  );
  for (const res of replies) {
    expect(res.status).toBe(200);
    expect((await res.json()).quote.price).toBe(100);
  }
  expect(calls()).toBe(1);
  expect(JSON.parse(DB.sqlite.prepare('SELECT data FROM snapshots').get().data).price).toBe(100);
  globalThis.caches.default.clear(); // Another edge location still sees the durable snapshot.
  expect((await (await call('/api/v1/overview')).json()).quote.price).toBe(100);
  expect(calls()).toBe(1);
});
it.each([
  'overview?bust=1',
  'overview?asset=BTC&asset=DOGE',
  'candles?from=',
  'candles?from=0x10',
  'candles?from=1e3',
  'candles?to=9999999999999',
  'status?' + 'x'.repeat(2050),
])('rejects query abuse before any external request: %s', async (path) => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect((await call('/api/v1/' + path)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it('fresh retrieval does not hide an old quote or old candles', async () => {
  DB.sqlite
    .prepare('INSERT INTO snapshots VALUES(?,?,?)')
    .run('quote:BTC:binance', JSON.stringify({ ...goodQuote(), time: now() - 4000 }), now());
  DB.sqlite
    .prepare('INSERT INTO state VALUES(?,?)')
    .run(
      'history:BTC:binance:1h',
      JSON.stringify({ first: now() - 86400, last: now() - 86400, fetched: now() }),
    );
  const quote = await (await call('/api/v1/overview')).json();
  const candles = await (await call('/api/v1/candles?interval=1h')).json();
  expect(quote.meta.stale).toBe(true);
  expect(candles.meta.stale).toBe(true);
});
it.each([
  { volume24h: -1 },
  { high24h: 99 },
  { low24h: 101 },
  { time: 1 },
  { time: now() + 1000 },
  { change24h: -100 },
  { low24h: NaN },
])('rejects malformed or implausible quotes %j', async (override) => {
  expect(() => validateQuote({ ...goodQuote(), ...override })).toThrow();
});
it('Upbit exposes UTC-day range separately and validates its actual last-trade timestamp', async () => {
  const timestamp = now() * 1000;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url) =>
        new Response(
          JSON.stringify(
            url.includes('/ticker?')
              ? [
                  {
                    trade_price: 100,
                    timestamp,
                    trade_timestamp: timestamp - 1000,
                    acc_trade_price_24h: 20,
                    high_price: 110,
                    low_price: 90,
                  },
                ]
              : [
                  {
                    trade_price: 80,
                    candle_date_time_utc: new Date(timestamp - 86400000 - 60000)
                      .toISOString()
                      .slice(0, 19),
                  },
                ],
          ),
          { status: 200 },
        ),
    ),
  );
  expect(await getQuote('BTC', 'upbit')).toMatchObject({
    rangeBasis: 'utc-day',
    changeBasis: 'rolling24h-minute',
    change24h: 25,
    time: timestamp / 1000 - 1,
  });
});
it.each(['old', 'empty', 'unavailable'])(
  'missing %s Upbit reference preserves the fresh quote and explicitly omits only 24h change',
  async (kind) => {
    const timestamp = now() * 1000;
    const referenceAt = Math.floor((timestamp / 1000 - 86400 - 420) / 60) * 60;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.includes('/ticker?'))
          return Response.json([
            {
              trade_price: 0.00575,
              timestamp,
              trade_timestamp: timestamp,
              acc_trade_price_24h: 100,
              high_price: 0.006,
              low_price: 0.005,
            },
          ]);
        if (kind === 'unavailable') return new Response('limited', { status: 429 });
        return Response.json(
          kind === 'empty'
            ? []
            : [
                {
                  trade_price: 0.00526,
                  candle_date_time_utc: new Date(referenceAt * 1000).toISOString().slice(0, 19),
                },
              ],
        );
      }),
    );
    env.ENABLED_ASSETS += ',PEPE';
    const result = await (await call('/api/v1/overview?asset=PEPE&market=upbit')).json();
    expect(result.quote).toMatchObject({
      asset: 'PEPE',
      price: 0.00575,
      volume24h: 100,
      time: timestamp / 1000,
      change24h: null,
    });
    expect(result.quote.changeUnavailableReason).toContain('등락률을 표시하지 않습니다.');
    expect(result.quote.referenceAt).toBe(kind === 'old' ? referenceAt : null);
    expect(result.meta.stale).toBe(false);
    expect(
      JSON.parse(
        DB.sqlite.prepare('SELECT data FROM snapshots WHERE key=?').get('quote:PEPE:upbit').data,
      ).change24h,
    ).toBeNull();
  },
);
it('a failed current-price source still fails instead of returning an empty or fabricated quote', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('limited', { status: 429 })),
  );
  await expect(getQuote('PEPE', 'upbit')).rejects.toThrow('429');
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it('future and misaligned source candles are rejected', async () => {
  for (const t of [Math.ceil(now() / 3600) * 3600 + 3600, 1704067201]) {
    mockSocket([[t * 1000, '10', '20', '5', '15', '30']]);
    await expect(getRecentCandles('BTC', 'binance', '1h')).rejects.toThrow('OHLC');
  }
});
it('source status never publishes raw upstream errors or local paths', async () => {
  DB.sqlite
    .prepare('INSERT INTO ingestion(key,error) VALUES(?,?)')
    .run('bitview', 'Error: C:/private/path token=secret source response');
  const data = await (await call('/api/v1/status')).json();
  expect(data.sources[0].error).toBe('원천 연결 또는 데이터 검증 오류');
  expect(JSON.stringify(data)).not.toContain('secret');
});
it('cache failures fall back to the API and internal validation errors are not blamed on the user', async () => {
  globalThis.caches.default.match = vi.fn(async () => {
    throw new Error('cache unavailable');
  });
  expect((await call('/api/v1/metrics')).status).toBe(200);
  vi.spyOn(DB, 'prepare').mockImplementation(() => {
    throw new Error('Invalid internal row token=private');
  });
  const response = await call('/api/v1/status');
  expect(response.status).toBe(503);
  const payload = await response.json();
  expect(payload.code).toBe('SOURCE_UNAVAILABLE');
  expect(JSON.stringify(payload)).not.toContain('private');
});
it('the old public origin redirects paths and queries without looping Pages, API, or local traffic', async () => {
  const response = await call('/chart/DOGE?interval=1w', 'btc-desk.lch68-workers.workers.dev');
  expect(response.status).toBe(308);
  expect(response.headers.get('location')).toBe(
    'https://coin-desk.pages.dev/chart/DOGE?interval=1w',
  );
  expect((await call('/chart/DOGE', 'coin-desk.pages.dev')).status).toBe(200);
  expect((await call('/chart/DOGE', 'localhost')).status).toBe(200);
  expect((await call('/api/v1/metrics', 'btc-desk.lch68-workers.workers.dev')).status).toBe(200);
});
