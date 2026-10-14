import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Existing JavaScript-only local D1 adapter for isolated tests.
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import worker from '../worker/index';
import { aggregate, DAY } from '../shared/math';
import { supertrend } from '../shared/supertrend';
import { pages } from '../src/lib';
import type { Candle, CandleResponse } from '../shared/types';
import type { Env } from '../worker/storage';

const start = Date.UTC(2010, 0, 1) / 1000;
const now = Date.UTC(2026, 9, 14) / 1000;
const candles: Candle[] = Array.from({ length: 5801 }, (_, i) => ({
  time: start + i * DAY,
  closeTime: start + (i + 1) * DAY,
  open: i + 100,
  high: i + 110,
  low: i + 90,
  close: i + 104,
  volume: i + 1,
  closed: true,
}));

describe('entire archived price history through the public pagination contract', () => {
  let db: ReturnType<typeof openDatabase>;
  let env: Env;
  let pending: Promise<unknown>[];
  let requests: URL[];
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    db = openDatabase(':memory:');
    env = {
      DB: db,
      ENABLED_ASSETS: 'BTC',
      BITVIEW_BASE_URL: 'https://bitview.space',
      ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    };
    pending = [];
    requests = [];
    vi.stubGlobal('caches', { default: memoryCache() });
    const archived = db.sqlite.prepare('INSERT INTO price_archive VALUES(?,?,?,?,?,?,?)');
    for (let i = 0; i < candles.length; i += 256) {
      const chunk = candles.slice(i, i + 256);
      archived.run(
        'BTC',
        'binance',
        '1d',
        chunk[0].time,
        chunk.at(-1)!.closeTime,
        JSON.stringify(
          chunk.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume, c.closeTime]),
        ),
        now,
      );
    }
    const recent = db.sqlite.prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    for (const c of candles.slice(-501))
      recent.run(
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
        now,
      );
    vi.stubGlobal('fetch', (input: string) => {
      const url = new URL(input, 'https://unit.test');
      requests.push(url);
      return worker.fetch(new Request(url), env, {
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      } as unknown as ExecutionContext);
    });
  });
  afterEach(async () => {
    await Promise.all(pending);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db.sqlite.close();
  });
  it('retains every daily price across 1000-point pages and archive/recent overlap even without a history metadata row', async () => {
    const data = await pages<CandleResponse>(
      `/api/v1/candles?asset=BTC&market=binance&interval=1d&to=${now}&limit=1000`,
    );
    expect(data.data).toEqual(candles);
    expect(new Set(data.data.map((c) => c.time)).size).toBe(candles.length);
    expect(data.nextCursor).toBeNull();
    expect(data.meta.historyStart).toBe(start);
    expect(requests.length).toBeGreaterThan(1);
    const trend = supertrend(data.data, '1d', { period: 10, multiplier: 3 }, now);
    expect(trend[0].time).toBe(candles[9].time);
    expect(data.data[0].time).toBe(start);
    expect(data.data.slice(0, 9)).toEqual(candles.slice(0, 9));
  });
  it('continues valid archive chunks smaller than 256 points instead of claiming a partial page is complete', async () => {
    db.sqlite.exec('DELETE FROM candles; DELETE FROM price_archive;');
    const archived = db.sqlite.prepare('INSERT INTO price_archive VALUES(?,?,?,?,?,?,?)');
    for (const c of candles.slice(0, 40))
      archived.run(
        'BTC',
        'binance',
        '1d',
        c.time,
        c.closeTime,
        JSON.stringify([[c.time, c.open, c.high, c.low, c.close, c.volume, c.closeTime]]),
        now,
      );
    const response = await worker.fetch(
      new Request('https://unit.test/api/v1/candles?asset=BTC&market=binance&interval=1d&limit=20'),
      env,
      { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext,
    );
    const body = (await response.json()) as CandleResponse;
    expect(body.data).toEqual(candles.slice(0, 20));
    expect(body.nextCursor).toBe(candles[20].time);
    expect(body.meta.historyStart).toBe(start);
    const all = await pages<CandleResponse>(
      '/api/v1/candles?asset=BTC&market=binance&interval=1d&limit=20',
    );
    expect(all.data).toEqual(candles.slice(0, 40));
  });
  it.each(['1w', '1M'] as const)(
    'keeps complete %s OHLC across the 4000-daily-row boundary',
    async (interval) => {
      const data = await pages<CandleResponse>(
        `/api/v1/candles?asset=BTC&market=binance&interval=${interval}&to=${now}&limit=1000`,
      );
      const expected = aggregate(candles, interval, now);
      expect(data.data).toEqual(expected);
      expect(new Set(data.data.map((c) => c.time)).size).toBe(expected.length);
      expect(data.nextCursor).toBeNull();
      expect(requests.length).toBeGreaterThan(1);
    },
  );
});
