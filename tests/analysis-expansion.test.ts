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

describe('Bybit USDT perpetual history', () => {
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
    const rows = [{ symbol: 'DOGEUSDT', fundingRateTimestamp: String((utc - 3600) * 1000), fundingRate: '-0.0001' }];
    const response = (list: unknown[], symbol = 'DOGEUSDT') => ({ retCode: 0, result: { category: 'linear', symbol, list } });
    expect(parseDerivativeRows(response(rows), 'DOGE', 'funding', utc)).toEqual([
      { time: utc - 3600, value: -0.01 },
    ]);
    expect(() => parseDerivativeRows(response(rows), 'BTC', 'funding', utc)).toThrow('symbol');
    expect(() =>
      parseDerivativeRows(
        response([{ ...rows[0], fundingRateTimestamp: String((utc + 600) * 1000) }]),
        'DOGE',
        'funding',
        utc,
      ),
    ).toThrow();
    expect(
      parseDerivativeRows(
        response([{ timestamp: String((utc - 3600) * 1000), openInterest: '123.5' }], 'ETHUSDT'),
        'ETH',
        'open_interest',
        utc,
      )[0].value,
    ).toBe(123.5);
  });
  it('reads long-holder share as a percentage and rejects inconsistent or mixed contracts', () => {
    const row = { symbol: 'DOGEUSDT', timestamp: String((utc - 3600) * 1000), buyRatio: '0.4927', sellRatio: '0.5073' };
    const payload = (list: unknown[]) => ({ retCode: 0, result: { list } });
    expect(parseDerivativeRows(payload([row]), 'DOGE', 'long_account_ratio', utc))
      .toEqual([{ time: utc - 3600, value: 49.27 }]);
    expect(() => parseDerivativeRows(payload([{ ...row, symbol: 'BTCUSDT' }]), 'DOGE', 'long_account_ratio', utc)).toThrow('symbol');
    expect(() => parseDerivativeRows(payload([{ ...row, sellRatio: '0.3' }]), 'DOGE', 'long_account_ratio', utc)).toThrow();
  });
  it('persists actual pages and returns an exclusive range with source, units and cursor', async () => {
    const base = utc - 16 * 3600;
    const fetcher = vi.fn(async (_url: string) =>
      Response.json({ retCode: 0, result: { category: 'linear', list: [
        { symbol: 'BTCUSDT', fundingRateTimestamp: String((base + 8 * 3600) * 1000), fundingRate: '-0.0002' },
        { symbol: 'BTCUSDT', fundingRateTimestamp: String(base * 1000), fundingRate: '0.0001' },
      ] } }),
    );
    vi.stubGlobal('fetch', fetcher);
    await updateDerivatives(env, 'BTC', 'funding');
    const one = await readDerivativeSeries(db, 'BTC', 'funding', base, base + DAY, 1);
    expect(one.data).toEqual([{ time: base, value: 0.01 }]);
    expect(one.nextCursor).toBe(base + 1);
    expect(one.range).toEqual({ from: base, to: base + DAY });
    expect(one.meta).toMatchObject({
      source: 'Bybit V5 public market data',
      unit: '%',
      historyStart: base,
      dataAsOf: base + 8 * 3600,
      stale: false,
    });
    const all = await readDerivativeSeries(db, 'BTC', 'funding', base, base + 8 * 3600, 100);
    expect(all.data).toHaveLength(1);
    const requested = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(requested.searchParams.get('category')).toBe('linear');
    expect(requested.searchParams.get('symbol')).toBe('BTCUSDT');
  });
  it('backfills open interest with an exclusive Bybit endTime and preserves coin units', async () => {
    const initial = Array.from({ length: 200 }, (_, index) => ({
      timestamp: String((utc - (index + 1) * 3600) * 1000),
      openInterest: String(1000 + index),
    }));
    const older = [{ timestamp: String((utc - 201 * 3600) * 1000), openInterest: '1201' }];
    const fetcher = vi.fn(async (_url: string) => Response.json({
      retCode: 0,
      result: { category: 'linear', symbol: 'DOGEUSDT', list: fetcher.mock.calls.length === 1 ? initial : older },
    }));
    vi.stubGlobal('fetch', fetcher);
    await updateDerivatives(env, 'DOGE', 'open_interest');
    await updateDerivatives(env, 'DOGE', 'open_interest');
    const requested = new URL(String(fetcher.mock.calls[1]?.[0]));
    expect(requested.searchParams.get('endTime')).toBe(String((utc - 200 * 3600) * 1000 - 1));
    expect(requested.searchParams.get('intervalTime')).toBe('1h');
    const result = await readDerivativeSeries(db, 'DOGE', 'open_interest', utc - 30 * DAY, utc, 1000);
    expect(result.data).toHaveLength(201);
    expect(result.meta.unit).toBe('DOGE');
    expect(result.data[0].value).toBe(1201);
    expect(db.sqlite.prepare("SELECT value FROM state WHERE key='cursor:derivatives:DOGE:open_interest'").get()).toBeUndefined();
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
