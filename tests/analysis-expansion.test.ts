import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript-only local SQLite adapter.
import { openDatabase } from '../scripts/local-db.mjs';
import { DAY } from '../shared/math';
import { btcCycle } from '../shared/cycle-analysis';
import { relativeAnalysis } from '../shared/relative-analysis';
import {
  parseDerivativeRows,
  readDerivativeSeries,
  updateDerivatives,
} from '../worker/derivatives';
import { parseMempool } from '../worker/mempool';
import type { Env } from '../worker/storage';

const utc = Date.UTC(2026, 8, 23) / 1000;
const sample = (count: number, start = Date.UTC(2020, 0, 6) / 1000) =>
  Array.from({ length: count }, (_, index) => ({ time: start + index * DAY, value: 100 + index }));

describe('BTC cycle and same-UTC relative analysis', () => {
  it('uses only prior observations for moving averages and excludes the current incomplete week', () => {
    const input = sample(1505);
    const cycle = btcCycle(input);
    expect(cycle.ma111[0]).toEqual({
      time: input[110].time,
      value: input.slice(0, 111).reduce((sum, point) => sum + point.value, 0) / 111,
    });
    expect(cycle.ma730[0].time).toBe(input[729].time);
    expect(cycle.ma730x5[0].value).toBeCloseTo(cycle.ma730[0].value * 5);
    expect(cycle.ma350x2[0].value).toBeCloseTo(
      (2 * input.slice(0, 350).reduce((sum, point) => sum + point.value, 0)) / 350,
    );
    expect(cycle.ma200w[0].value).toBeCloseTo(
      Array.from({ length: 200 }, (_, index) => input[index * 7 + 6].value).reduce(
        (sum, value) => sum + value,
        0,
      ) / 200,
    );
    expect(cycle.ma200w[0].time).toBe(input[199 * 7 + 6].time);
    expect(cycle.drawdown).toBe(0);
    const gap = btcCycle(sample(805).filter((_, index) => index !== 500));
    expect(gap.ma730).toEqual([]);
  });

  it('aligns UTC dates, gives a base-100 ratio and withholds correlation across gaps', () => {
    const btc = Array.from({ length: 100 }, (_, index) => ({
      time: index * DAY,
      value: 100 + index * 2 + (index % 3),
    }));
    const doge = btc.map((point, index) => ({
      time: point.time,
      value: (10 + index) * (index % 5 === 0 ? 1.02 : 1),
    }));
    const result = relativeAnalysis(doge, btc);
    expect(result.relative[0].value).toBe(100);
    expect(result.ratio[10].value).toBeCloseTo(doge[10].value / btc[10].value);
    expect(result.drawdown).toBeLessThanOrEqual(0);
    expect(result.correlation30).not.toBeNull();
    expect(result.correlation90).not.toBeNull();
    expect(
      relativeAnalysis(
        doge.filter((_, index) => index !== 80),
        btc,
      ).correlation30,
    ).toBeNull();
  });
});

describe('Binance USDT perpetual history', () => {
  let db: ReturnType<typeof openDatabase>;
  let env: Env;
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(utc * 1000);
    db = openDatabase(':memory:');
    env = {
      DB: db,
      ENABLED_ASSETS: 'BTC,DOGE,ETH',
      BITVIEW_BASE_URL: 'https://bitview.space',
    } as Env;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db.sqlite.close();
  });
  it('keeps negative funding in percentage points, rejects mixed symbols and future observations', () => {
    const rows = [{ symbol: 'DOGEUSDT', fundingTime: (utc - 3600) * 1000, fundingRate: '-0.0001' }];
    expect(parseDerivativeRows(rows, 'DOGE', 'funding', utc)).toEqual([
      { time: utc - 3600, value: -0.01 },
    ]);
    expect(() => parseDerivativeRows(rows, 'BTC', 'funding', utc)).toThrow('symbol');
    expect(() =>
      parseDerivativeRows(
        [{ ...rows[0], fundingTime: (utc + 600) * 1000 }],
        'DOGE',
        'funding',
        utc,
      ),
    ).toThrow();
    expect(
      parseDerivativeRows(
        [{ symbol: 'ETHUSDT', timestamp: (utc - 3600) * 1000, sumOpenInterestValue: '123.5' }],
        'ETH',
        'open_interest',
        utc,
      )[0].value,
    ).toBe(123.5);
  });
  it('persists actual pages and returns an exclusive range with source, units and cursor', async () => {
    const base = Date.UTC(2019, 0, 1) / 1000;
    const fetcher = vi.fn(async (_url: string) =>
      Response.json([
        { symbol: 'BTCUSDT', fundingTime: base * 1000, fundingRate: '0.0001' },
        { symbol: 'BTCUSDT', fundingTime: (base + 8 * 3600) * 1000, fundingRate: '-0.0002' },
      ]),
    );
    vi.stubGlobal('fetch', fetcher);
    await updateDerivatives(env, 'BTC', 'funding');
    const one = await readDerivativeSeries(db, 'BTC', 'funding', base, base + DAY, 1);
    expect(one.data).toEqual([{ time: base, value: 0.01 }]);
    expect(one.nextCursor).toBe(base + 1);
    expect(one.range).toEqual({ from: base, to: base + DAY });
    expect(one.meta).toMatchObject({
      source: 'Binance USDⓈ-M Futures',
      unit: '%',
      historyStart: base,
      dataAsOf: base + 8 * 3600,
      stale: true,
    });
    const all = await readDerivativeSeries(db, 'BTC', 'funding', base, base + 8 * 3600, 100);
    expect(all.data).toHaveLength(1);
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('startTime')).toBe(
      String(base * 1000),
    );
  });
});

it('validates the BTC mempool snapshot before displaying an exact source observation', () => {
  expect(
    parseMempool(
      { count: 101, vsize: 345_000 },
      { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 2 },
      utc,
    ),
  ).toMatchObject({ count: 101, vsize: 345_000, observedAt: utc, source: 'mempool.space' });
  expect(() =>
    parseMempool(
      { count: -1, vsize: 345_000 },
      { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 2 },
      utc,
    ),
  ).toThrow();
});
