import { describe, expect, it } from 'vitest';
import { eligibleChartPrice, type LiveChartPrice } from '../shared/live-chart-price';
const quote: LiveChartPrice = {
  asset: 'BTC',
  market: 'upbit',
  price: 100000000,
  time: 1000,
  stale: false,
};
describe('same-source current price reference line', () => {
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
