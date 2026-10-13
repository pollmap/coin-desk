import { describe, expect, it } from 'vitest';
import {
  aggregateThemeMatrix,
  calculateMarketMatrix,
  MARKET_MATRIX_VERSION,
  type MarketMatrixInput,
  type MarketMatrixOptions,
  type MatrixThemeInput,
} from '../shared/market-matrix';
import type { Asset, Candle } from '../shared/types';

const DAY = 86400;
const basisDay = 21000 * DAY;
const options: MarketMatrixOptions = {
  asOf: basisDay + DAY + 3600,
  market: 'binance',
  currency: 'USDT',
};
function input(
  asset: Asset,
  closes = [100, 110, 120, 130, 140, 150, 160, 170],
  volumes = [1, 2, 3, 4, 5, 6, 7, 8],
): MarketMatrixInput {
  const candles: Candle[] = closes.map((close, i) => ({
    time: basisDay - (7 - i) * DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes[i],
    closeTime: basisDay - (6 - i) * DAY,
    closed: true,
  }));
  return { asset, market: 'binance', currency: 'USDT', candles };
}
const theme = (
  id: string,
  members: [Asset, 'reviewed' | 'pending' | 'rejected'][],
): MatrixThemeInput => ({
  id,
  title: id,
  members: members.map(([asset, review]) => ({ asset, evidence: { review } })),
});

describe('Completed daily return and same-asset base volume matrix', () => {
  it('uses exactly eight observations and excludes the latest volume from the seven-day median', () => {
    const result = calculateMarketMatrix([input('DOGE')], options);
    expect(result.definitionVersion).toBe(MARKET_MATRIX_VERSION);
    expect(result.basisDay).toBe(basisDay);
    expect(result.points[0]).toMatchObject({
      asset: 'DOGE',
      x: 70,
      y: 2,
      return7d: 70,
      medianPriorVolume: 4,
      latestVolume: 8,
      status: 'up-volume-up',
      quadrant: 'up-high',
      benchmarkReturn7d: null,
    });
    expect(result.excluded).toEqual([]);
  });

  it('does not interpolate gaps or retreat the common date to an older observation', () => {
    const missed = input('DOGE');
    missed.candles = missed.candles.filter((_, i) => i !== 3);
    const stale = input('ETH');
    stale.candles = stale.candles.slice(0, -1);
    const result = calculateMarketMatrix([input('BTC'), missed, stale], options);
    expect(result.points.map((p) => p.asset)).toEqual(['BTC']);
    expect(result.excluded).toEqual([
      { asset: 'DOGE', reason: 'missing-day', missingDays: [basisDay - 4 * DAY] },
      { asset: 'ETH', reason: 'missing-day', missingDays: [basisDay] },
    ]);
  });

  it('preserves past results when unfinished or future observations arrive', () => {
    const before = input('BTC');
    const future = {
      ...before.candles[7],
      time: basisDay + DAY,
      closeTime: basisDay + 2 * DAY,
      close: 100000,
      high: 100000,
      volume: 999999,
      closed: false,
    };
    expect(
      calculateMarketMatrix([{ ...before, candles: [...before.candles, future] }], options),
    ).toEqual(calculateMarketMatrix([before], options));
    const unconfirmed = input('DOGE');
    unconfirmed.candles = unconfirmed.candles.map((c, i) => ({ ...c, closed: i !== 7 }));
    expect(calculateMarketMatrix([unconfirmed], options).excluded[0].reason).toBe(
      'unconfirmed-day',
    );
  });

  it('rejects duplicate observations and assets, currency mixing and mismatched daily boundaries', () => {
    const duplicate = input('DOGE');
    duplicate.candles = [...duplicate.candles, duplicate.candles[2]];
    const wrongBoundary = input('SOL');
    wrongBoundary.candles = wrongBoundary.candles.map((c) => ({
      ...c,
      closeTime: c.closeTime - 1,
    }));
    const result = calculateMarketMatrix(
      [
        input('BTC'),
        input('BTC'),
        duplicate,
        { ...input('ETH'), market: 'upbit', currency: 'KRW' },
        wrongBoundary,
      ],
      options,
    );
    expect(result.points).toEqual([]);
    expect(result.excluded.map((e) => [e.asset, e.reason])).toEqual([
      ['BTC', 'duplicate-asset'],
      ['DOGE', 'duplicate-day'],
      ['ETH', 'source-mismatch'],
      ['SOL', 'unconfirmed-day'],
    ]);
  });

  it.each([NaN, Infinity, -1])('does not accept invalid volume %s', (volume) => {
    const bad = input('PEPE');
    bad.candles = bad.candles.map((c, i) => ({ ...c, volume: i === 7 ? volume : c.volume }));
    expect(calculateMarketMatrix([bad], options).excluded[0].reason).toBe('invalid-candle');
  });

  it('keeps zero recent trading as a real value, but does not invent a ratio from a zero median', () => {
    const result = calculateMarketMatrix(
      [
        input('DOGE', undefined, [1, 2, 3, 4, 5, 6, 7, 0]),
        input('PEPE', undefined, [0, 0, 0, 0, 1, 2, 3, 8]),
      ],
      options,
    );
    expect(result.points[0]).toMatchObject({ y: 0, status: 'volume-down', quadrant: 'up-low' });
    expect(result.excluded[0]).toEqual({ asset: 'PEPE', reason: 'zero-baseline-volume' });
  });

  it('reports unchanged price and equal trading at the baseline without an increase label', () => {
    const flat = input('DOGE', Array(8).fill(100), Array(8).fill(5));
    expect(calculateMarketMatrix([flat], options).points[0]).toMatchObject({
      x: 0,
      y: 1,
      status: 'baseline',
      quadrant: null,
    });
    expect(
      calculateMarketMatrix([input('ETH', Array(8).fill(100))], options).points[0],
    ).toMatchObject({ x: 0, y: 2, status: 'baseline', quadrant: null });
  });

  it('distinguishes price decline with increased trading from decline with decreased trading', () => {
    const closes = [200, 190, 180, 170, 160, 150, 140, 100];
    const result = calculateMarketMatrix(
      [input('DOGE', closes), input('ETH', closes, [4, 4, 4, 4, 4, 4, 4, 2])],
      options,
    );
    expect(result.points[0]).toMatchObject({
      x: -50,
      y: 2,
      quadrant: 'down-high',
      status: 'down-volume-up',
    });
    expect(result.points[1]).toMatchObject({
      x: -50,
      y: 0.5,
      quadrant: 'down-low',
      status: 'volume-down',
    });
  });

  it('computes BTC excess performance in percentage points using the same eight dates', () => {
    const result = calculateMarketMatrix(
      [input('BTC', [100, 110, 120, 130, 140, 150, 160, 200]), input('DOGE')],
      { ...options, xMode: 'excess-btc7d' },
    );
    expect(result.benchmark).toBe('BTC');
    expect(result.points[0]).toMatchObject({ x: 0, return7d: 100, benchmarkReturn7d: 100 });
    expect(result.points[1]).toMatchObject({ x: -30, return7d: 70, benchmarkReturn7d: 100 });
    const missingBenchmark = calculateMarketMatrix([input('DOGE')], {
      ...options,
      xMode: 'excess-btc7d',
    });
    expect(missingBenchmark.points).toEqual([]);
    expect(missingBenchmark.excluded).toEqual([{ asset: 'DOGE', reason: 'benchmark-unavailable' }]);
  });

  it('keeps the volume ratio independent of quote-currency price scale and input ordering', () => {
    const original = input('BTC');
    const scaled = {
      ...original,
      market: 'upbit' as const,
      currency: 'KRW' as const,
      candles: [...original.candles].reverse().map((c) => ({
        ...c,
        open: c.open * 1400,
        high: c.high * 1400,
        low: c.low * 1400,
        close: c.close * 1400,
      })),
    };
    const krw = calculateMarketMatrix([scaled], { ...options, market: 'upbit', currency: 'KRW' });
    expect(krw.points[0]).toEqual(calculateMarketMatrix([original], options).points[0]);
    expect(original.candles[0].time).toBe(basisDay - 7 * DAY);
  });

  it('rejects invalid source/options and a current unfinished historical basis', () => {
    expect(() => calculateMarketMatrix([], { ...options, currency: 'KRW' })).toThrow(RangeError);
    expect(() => calculateMarketMatrix([], { ...options, asOf: NaN })).toThrow(RangeError);
    expect(() => calculateMarketMatrix([], { ...options, basisDay: basisDay + DAY })).toThrow(
      RangeError,
    );
    expect(() => calculateMarketMatrix([], { ...options, basisDay: basisDay + 1 })).toThrow(
      RangeError,
    );
  });
});

describe('Verified theme medians', () => {
  it('uses medians of constituent returns and ratios, not pooled volumes or capitalization weights', () => {
    const matrix = calculateMarketMatrix(
      [
        input('BTC'),
        input(
          'DOGE',
          [100, 100, 100, 100, 100, 100, 100, 120],
          [100, 100, 100, 100, 100, 100, 100, 300],
        ),
        input('ETH', [100, 100, 100, 100, 100, 100, 100, 1000], [1, 1, 1, 1, 1, 1, 1, 10]),
      ],
      options,
    );
    const aggregate = aggregateThemeMatrix(matrix, [
      theme('test', [
        ['BTC', 'reviewed'],
        ['DOGE', 'reviewed'],
        ['ETH', 'reviewed'],
      ]),
    ]);
    expect(aggregate.points[0]).toMatchObject({
      x: 70,
      y: 3,
      usableMembers: 3,
      expectedMembers: 3,
    });
    expect(aggregate.excluded).toEqual([]);
  });

  it('does not promote pending/rejected classifications or plot an empty theme at zero', () => {
    const matrix = calculateMarketMatrix([input('BTC')], options);
    const result = aggregateThemeMatrix(matrix, [
      theme('some', [
        ['BTC', 'reviewed'],
        ['DOGE', 'reviewed'],
        ['ETH', 'pending'],
      ]),
      theme('none', [
        ['BTC', 'pending'],
        ['PEPE', 'rejected'],
      ]),
    ]);
    expect(result.points[0]).toMatchObject({
      members: ['BTC'],
      expectedMembers: 3,
      usableMembers: 1,
    });
    expect(result.points[0].omitted).toEqual([
      { asset: 'DOGE', reason: 'no-observation' },
      { asset: 'ETH', reason: 'unreviewed' },
    ]);
    expect(result.excluded[0]).toMatchObject({ id: 'none', usableMembers: 0, expectedMembers: 2 });
    expect('x' in result.excluded[0]).toBe(false);
    expect(JSON.stringify(result)).not.toContain('null');
  });
});
