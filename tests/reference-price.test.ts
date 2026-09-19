import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
// @ts-expect-error The existing local SQLite harness is a JavaScript-only development adapter.
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import worker from '../worker/index';
import { DAY } from '../shared/math';
import type { Asset, Point, SeriesResponse } from '../shared/types';
import { pages } from '../src/lib';
import { parseReference, REFERENCE_SOURCE, REFERENCE_VERSION } from '../worker/reference-price';
import { success, type Env } from '../worker/storage';

const start = Date.UTC(2010, 0, 1) / 1000;
const now = Date.UTC(2026, 8, 20) / 1000;
const raw = (day: number, price: unknown = '0.05', asset = 'btc') => ({
  asset,
  time: new Date(day * 1000).toISOString(),
  PriceUSD: price,
});

describe('Coin Metrics reference normalization', () => {
  it('includes a daily observation exactly at UTC close and excludes the still-open UTC day', () => {
    const input = { data: [raw(now), raw(now - DAY), raw(now - 2 * DAY)] };
    expect(parseReference(input, 'BTC', now)).toEqual([
      { time: now - 2 * DAY, value: 0.05 },
      { time: now - DAY, value: 0.05 },
    ]);
    expect(parseReference({ data: [raw(now - DAY)] }, 'BTC', now - 1)).toEqual([]);
  });

  it('keeps source precision, sorts dates, and skips missing observations without filling gaps', () => {
    expect(
      parseReference(
        {
          data: [
            raw(start + 3 * DAY, '0.000123456789'),
            raw(start + DAY, null),
            { ...raw(start + 2 * DAY), PriceUSD: undefined },
            raw(start, 0.05),
          ],
        },
        'BTC',
        now,
      ),
    ).toEqual([
      { time: start, value: 0.05 },
      { time: start + 3 * DAY, value: 0.000123456789 },
    ]);
  });

  it('rejects mismatched assets, duplicate dates, non-UTC daily boundaries, and malformed responses', () => {
    for (const body of [
      { data: [raw(start, 1, 'doge')] },
      { data: [raw(start), raw(start)] },
      { data: [raw(start, null), raw(start)] },
      { data: [raw(start + 3600)] },
      { data: [{ ...raw(start), time: 'invalid' }] },
      { data: {} },
      null,
    ])
      expect(() => parseReference(body, 'BTC', now)).toThrow();
  });

  it('rejects zero, negative, non-finite, and non-numeric prices', () => {
    for (const value of [0, -0.1, '-1', NaN, Infinity, 'NaN', 'Infinity', '', 'abc', true, {}])
      expect(() => parseReference({ data: [raw(start, value)] }, 'BTC', now)).toThrow();
  });
});

describe('reference API against actual SQLite and Worker routing', () => {
  let db: { sqlite: DatabaseSync } & D1Database;
  let env: Env;
  let pending: Promise<unknown>[];
  let context: ExecutionContext;
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    db = openDatabase(':memory:');
    env = {
      DB: db,
      ENABLED_ASSETS: 'BTC,DOGE,ETH,XRP,LINK,SOL',
      BITVIEW_BASE_URL: 'https://bitview.space',
      ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    };
    pending = [];
    context = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    } as unknown as ExecutionContext;
    vi.stubGlobal('caches', { default: memoryCache() });
  });
  afterEach(async () => {
    await Promise.all(pending);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db.sqlite.close();
  });
  const request = (query: string) =>
    worker.fetch(new Request('https://unit.test/api/v1/reference?' + query), env, context);
  const insert = (points: Point[], asset: Asset = 'BTC') => {
    const statement = db.sqlite.prepare(
      'INSERT INTO reference_prices(asset,time,value,fetched_at) VALUES(?,?,?,?)',
    );
    for (const point of points) statement.run(asset, point.time, point.value, now);
  };

  it('returns asset-specific daily points with explicit provenance, never invented candles or a second price source', async () => {
    for (const [index, asset] of (['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'] as const).entries()) {
      insert([{ time: now - DAY, value: index + 0.12345678 }], asset);
      await success(db, 'reference:' + asset, now - DAY);
      const response = await request('asset=' + asset);
      expect(response.status).toBe(200);
      const body = (await response.json()) as SeriesResponse;
      expect(body.data).toEqual([{ time: now - DAY, value: index + 0.12345678 }]);
      expect(body.price).toEqual([]);
      expect(Object.keys(body.data[0]).sort()).toEqual(['time', 'value']);
      expect(body.meta).toMatchObject({
        source: REFERENCE_SOURCE,
        unit: 'USD',
        market: asset + ' / USD reference',
        calculationVersion: REFERENCE_VERSION,
        historyStart: now - DAY,
        dataAsOf: now - DAY,
        fetchedAt: now,
        stale: false,
      });
      expect(body.meta.priceBasis).toContain('거래소 OHLCV 아님');
      expect(body.nextCursor).toBeNull();
    }
  });

  it('uses inclusive from and exclusive to with gap-safe cursors and stable full-history metadata', async () => {
    insert([4, 3, 1, 0].map((day) => ({ time: start + day * DAY, value: day + 1 })));
    const first = (await (
      await request(`asset=BTC&from=${start}&to=${start + 4 * DAY}&limit=2`)
    ).json()) as SeriesResponse;
    expect(first.data.map((p) => p.time)).toEqual([start, start + DAY]);
    expect(first.nextCursor).toBe(start + 2 * DAY);
    expect(first.meta.historyStart).toBe(start);
    expect(first.meta.dataAsOf).toBe(start + 4 * DAY);
    const second = (await (
      await request(`asset=BTC&from=${first.nextCursor}&to=${start + 4 * DAY}&limit=2`)
    ).json()) as SeriesResponse;
    expect(second.data).toEqual([{ time: start + 3 * DAY, value: 4 }]);
    expect(second.nextCursor).toBeNull();
  });

  it('loads all 5,880 observations through the browser pagination path without truncation or fabricated gaps', async () => {
    // Explicit deterministic test fixtures; production observations come only from the provider.
    const expected = Array.from({ length: 5880 }, (_, i) => ({
      time: start + i * DAY,
      value: i + 0.01,
    }));
    insert([...expected].reverse());
    const fetcher = vi.fn((input: string | URL | Request) =>
      worker.fetch(new Request(new URL(String(input), 'https://unit.test')), env, context),
    );
    vi.stubGlobal('fetch', fetcher);
    const body = await pages<SeriesResponse>(
      `/api/v1/reference?asset=BTC&from=${start}&to=${start + 5880 * DAY}&limit=1000`,
    );
    expect(body.data).toEqual(expected);
    expect(body.price).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
    expect(body.meta.historyStart).toBe(start);
  });

  it('rejects unsupported assets, ambiguous query keys, and invalid ranges before returning data', async () => {
    for (const query of [
      'asset=SOL',
      'asset=UNKNOWN',
      'asset=BTC&asset=DOGE',
      'asset=BTC&market=binance',
      'limit=1001',
      'limit=0',
      'from=2&to=1',
      'from=NaN',
    ])
      expect((await request(query)).status).toBe(400);
    expect((await request('asset=PEPE')).status).toBe(404);
  });

  it('returns explicit empty and stale metadata when the requested asset has no stored observations', async () => {
    const response = await request('asset=DOGE');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [],
      price: [],
      nextCursor: null,
      meta: {
        historyStart: null,
        dataAsOf: null,
        fetchedAt: null,
        stale: true,
        source: REFERENCE_SOURCE,
      },
    });
  });
});
