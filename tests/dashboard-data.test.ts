import { describe, expect, it } from 'vitest';
import {
  dashboardPlot,
  dashboardPriceUrl,
  dashboardPrices,
  dashboardSeriesUrl,
} from '../src/dashboard-data';
import { dashboardValue } from '../src/DashboardChartCard';
import { assetRainbowOrigin } from '../shared/asset-rainbow';
import type { Candle, CandleResponse, Point, SeriesResponse } from '../shared/types';

const DAY = 86400;
const first = Date.UTC(2020, 0, 6) / 1000;
const meta = {
  source: 'test',
  unit: 'USD',
  market: 'reference',
  dataAsOf: first,
  fetchedAt: first,
  stale: false,
  calculationVersion: 'test',
};
const series = (data: Point[]): SeriesResponse => ({ data, price: [], meta, nextCursor: null });
const candles = (data: Candle[]): CandleResponse => ({ data, meta, nextCursor: null });

describe('dashboard shared inputs', () => {
  it('keeps source selection explicit for USD and native exchange candles', () => {
    expect(dashboardPriceUrl('DOGE', 'reference')).toBe('/api/v1/reference?asset=DOGE&limit=1000');
    expect(dashboardPriceUrl('DOGE', 'upbit')).toContain('market=upbit&interval=1d');
    expect(dashboardSeriesUrl('ETH', 'net:mvrv')).toBe(
      '/api/v1/network?asset=ETH&metric=mvrv&limit=1000',
    );
    expect(dashboardSeriesUrl('DOGE', 'btc:lth_mvrv')).toBeNull();
  });
  it('rejects incomplete reference days and native candles without inventing OHLC', () => {
    const data = [
      { time: first, value: 0.12 },
      { time: first + DAY, value: 0.15 },
    ];
    expect(dashboardPrices(series(data), 'reference', first + DAY + 100)).toEqual(data.slice(0, 1));
    const raw: Candle[] = [
      {
        time: first,
        open: 100,
        high: 150,
        low: 90,
        close: 120,
        volume: 10,
        closeTime: first + DAY - 1,
        closed: true,
      },
      {
        time: first + DAY,
        open: 120,
        high: 160,
        low: 100,
        close: 150,
        volume: 10,
        closeTime: first + 2 * DAY - 1,
        closed: false,
      },
    ];
    expect(dashboardPrices(candles(raw), 'upbit', first + 3 * DAY)).toEqual([
      { time: first, value: 120 },
    ]);
    const plot = dashboardPlot({
      asset: 'DOGE',
      metric: 'view:price',
      basis: 'reference',
      prices: data,
    });
    expect(plot.unit).toBe('USD');
    expect(plot.candles).toBeUndefined();
  });
  it('keeps the first real candles visible while weekly Supertrend is warming up', () => {
    const raw: Candle[] = Array.from({ length: 15 }, (_, i) => ({
      time: first + i * 7 * DAY,
      open: 10 + i,
      high: 12 + i,
      low: 9 + i,
      close: 11 + i,
      volume: 100,
      closeTime: first + (i + 1) * 7 * DAY - 1,
      closed: true,
    }));
    const plot = dashboardPlot({
      asset: 'DOGE',
      metric: 'view:supertrend',
      basis: 'binance',
      prices: [{ time: first, value: 100000 }],
      candles: candles(raw),
      now: Infinity,
    });
    expect(plot.points).toHaveLength(15);
    expect(plot.points[0]).toEqual({ time: first, value: 11 });
    expect(plot.candles).toHaveLength(15);
    expect(plot.lines[0].data.length).toBeGreaterThan(0);
    expect(plot.lines[0].data[0].time).toBeGreaterThan(first);
    expect(plot.unit).toBe('USDT');
    expect(plot.step).toBe(7 * DAY);
  });
  it('retains the full reference history below the rainbow and never reuses the visible period as its input', () => {
    const origin = assetRainbowOrigin('DOGE', 'reference')!;
    const data = Array.from({ length: 740 }, (_, i) => ({
      time: origin + i * DAY,
      value: Math.exp(-5 + 0.4 * Math.log1p(i) + Math.sin(i / 12) / 10),
    }));
    const plot = dashboardPlot({
      asset: 'DOGE',
      metric: 'view:asset_rainbow',
      basis: 'reference',
      prices: data,
      now: Infinity,
    });
    expect(plot.points).toHaveLength(740);
    expect(plot.bands).toHaveLength(10);
    expect(plot.bands![0].time).toBe(origin + 730 * DAY);
    expect(plot.lines).toHaveLength(10);
  });
  it('does not turn derived NUPL into gross unrealized loss or multiply a ratio by 100 silently', () => {
    const data = [{ time: first, value: 0.25 }];
    const derived = dashboardPlot({
      asset: 'DOGE',
      metric: 'net:nupl',
      basis: 'reference',
      prices: [],
      series: series(data),
    });
    expect(derived.points).toEqual(data);
    expect(derived.unit).toBe('비율');
    expect(derived.primary?.formula).toContain('1');
    const original = dashboardPlot({
      asset: 'BTC',
      metric: 'btc:nupl',
      basis: 'reference',
      prices: [],
      series: series(data),
    });
    expect(original.points[0].value).toBe(25);
    expect(original.unit).toBe('%');
  });
  it('uses only the selected pair common dates for relative prices', () => {
    const plot = dashboardPlot({
      asset: 'ONDO',
      metric: 'view:relative',
      basis: 'binance',
      prices: [
        { time: first, value: 1 },
        { time: first + DAY, value: 2 },
        { time: first + 2 * DAY, value: 4 },
      ],
      benchmark: [
        { time: first, value: 100 },
        { time: first + 2 * DAY, value: 200 },
      ],
    });
    expect(plot.unit).toBe('BTC');
    expect(plot.primary?.title).toBe('ONDO / BTC');
    expect(plot.points).toEqual([
      { time: first, value: 0.01 },
      { time: first + 2 * DAY, value: 0.02 },
    ]);
  });
  it('preserves GH/s for non-BTC hash-rate trend cards', () => {
    const data = Array.from({ length: 70 }, (_, i) => ({ time: first + i * DAY, value: 100 + i }));
    const plot = dashboardPlot({
      asset: 'ZEC',
      metric: 'view:hashrate_trend',
      basis: 'reference',
      prices: [],
      series: series(data),
      now: Infinity,
    });
    expect(plot.unit).toBe('GH/s');
    expect(plot.points).toHaveLength(11);
    expect(plot.lines[0].unit).toBe('GH/s');
  });
  it('formats small native and BTC-relative prices without rounding them to zero', () => {
    expect(dashboardValue(0.00000819, 'USD')).toBe('$0.00000819');
    expect(dashboardValue(0.00000000819, 'BTC')).not.toMatch(/^0\.0+$/);
    expect(dashboardValue(undefined, 'USD')).toBe('—');
  });
  it('uses a logarithmic MVRV axis without clipping early values and retains nonpositive observations', () => {
    const data = [
      { time: first, value: 140 },
      { time: first + DAY, value: 1.5 },
    ];
    for (const metric of ['net:mvrv', 'btc:mvrv', 'btc:sth_mvrv', 'btc:lth_mvrv']) {
      const plot = dashboardPlot({
        asset: 'BTC',
        metric,
        basis: 'reference',
        prices: [],
        series: series(data),
      });
      expect(plot.log).toBe(true);
      expect(plot.points).toEqual(data);
      const withZero = [...data, { time: first + 2 * DAY, value: 0 }];
      const linear = dashboardPlot({
        asset: 'BTC',
        metric,
        basis: 'reference',
        prices: [],
        series: series(withZero),
      });
      expect(linear.log).toBe(false);
      expect(linear.points).toEqual(withZero);
    }
    for (const metric of ['btc:mvrv_z', 'net:nupl']) {
      const data = [
        { time: first, value: -0.5 },
        { time: first + DAY, value: 1.5 },
      ];
      const plot = dashboardPlot({
        asset: 'BTC',
        metric,
        basis: 'reference',
        prices: [],
        series: series(data),
      });
      expect(plot.log).toBe(false);
      expect(plot.points).toEqual(data);
    }
  });
  it('optional ribbon and Bollinger cards keep original prices and restart after missing dates', () => {
    const data = Array.from({ length: 125 }, (_, i) => ({
      time: first + i * DAY,
      value: 10 + i / 10,
    })).filter((_, i) => i !== 110);
    for (const metric of ['view:ribbon', 'view:bb']) {
      const plot = dashboardPlot({ asset: 'DOGE', metric, basis: 'reference', prices: data });
      expect(plot.points).toEqual(data);
      expect(plot.unit).toBe('USD');
      expect(plot.lines).toHaveLength(metric === 'view:ribbon' ? 4 : 3);
      for (const line of plot.lines) {
        expect(line.data.some((p) => p.time === first + 111 * DAY)).toBe(false);
      }
    }
  });
  it('optional seasonality requires complete calendar years and labels the current path separately', () => {
    const start = Date.UTC(2020, 11, 31) / 1000;
    const now = Date.UTC(2024, 3, 1) / 1000;
    const data = Array.from({ length: (now - start) / DAY }, (_, i) => ({
      time: start + i * DAY,
      value: 100 + i,
    }));
    const plot = dashboardPlot({
      asset: 'DOGE',
      metric: 'view:seasonality',
      basis: 'reference',
      prices: data,
      now,
    });
    expect(plot.seasonality?.years).toEqual([2021, 2022, 2023]);
    expect(plot.seasonality?.summary).toHaveLength(365);
    expect(plot.points).toEqual(plot.seasonality?.current);
    expect(plot.unit).toBe('%');
  });
});
