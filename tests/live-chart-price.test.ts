import { describe, expect, it } from 'vitest';
import {
  eligibleChartPrice,
  supportsLiveChartPrice,
  type LiveChartPrice,
} from '../shared/live-chart-price';
const quote: LiveChartPrice = {
  asset: 'BTC',
  market: 'upbit',
  price: 100000000,
  time: 1000,
  stale: false,
};
describe('same-source current price reference line', () => {
  it('enables spot-price references only for price, Supertrend, ribbon and Bollinger axes', () => {
    for (const metric of ['view:price', 'view:supertrend', 'view:ribbon', 'view:bb']) {
      expect(supportsLiveChartPrice(metric, 'upbit')).toBe(true);
      expect(supportsLiveChartPrice(metric, 'binance')).toBe(true);
      for (const source of ['reference', 'bybit', '', 'unknown'])
        expect(supportsLiveChartPrice(metric, source)).toBe(false);
    }
    for (const metric of [
      'net:mvrv',
      'net:nupl',
      'view:hash_ribbons',
      'view:hashrate_trend',
      'rsi',
      'view:asset_rainbow',
    ])
      expect(supportsLiveChartPrice(metric, 'binance')).toBe(false);
  });
  it('rejects another asset or currency, including USD reference conversion', () => {
    expect(eligibleChartPrice(quote, 'BTC', 'KRW', 1000)).toBe(true);
    expect(eligibleChartPrice(quote, 'ETH', 'KRW', 1000)).toBe(false);
    for (const unit of ['USD', 'USDT', '배'])
      expect(eligibleChartPrice(quote, 'BTC', unit, 1000)).toBe(false);
    expect(eligibleChartPrice({ ...quote, market: 'binance' }, 'BTC', 'USDT', 1000)).toBe(true);
  });
  it('keeps the 300 second threshold and rejects invalid/future/stale observations', () => {
    expect(eligibleChartPrice(quote, 'BTC', 'KRW', 1300)).toBe(true);
    expect(eligibleChartPrice(quote, 'BTC', 'KRW', 1301)).toBe(false);
    expect(eligibleChartPrice(quote, 'BTC', 'KRW', 939)).toBe(false);
    expect(eligibleChartPrice({ ...quote, stale: true }, 'BTC', 'KRW', 1000)).toBe(false);
    for (const price of [0, -1, NaN, Infinity])
      expect(eligibleChartPrice({ ...quote, price }, 'BTC', 'KRW', 1000)).toBe(false);
  });
});
