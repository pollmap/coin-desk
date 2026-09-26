import { expect, it } from 'vitest';
import { dailyTechnical, marketAnalysisLink, marketComparisonLink } from '../shared/market-watch';
import { DAY } from '../shared/math';
import { priceBasis } from '../shared/analysis-workspace';

it.each(['upbit', 'binance'] as const)(
  'keeps exchange and currency when entering %s analysis and comparison',
  (market) => {
    const entry = new URL(marketAnalysisLink('DOGE', market), 'https://unit.test');
    expect(priceBasis(entry.searchParams)).toBe(market);
    expect(entry.searchParams.get('period')).toBe('all');
    expect(entry.searchParams.get('asset')).toBe('DOGE');
    const comparison = new URL(marketComparisonLink('ETH', market, '1y'), 'https://unit.test');
    expect(comparison.searchParams.get('assets')).toBe('BTC,ETH');
    expect(comparison.searchParams.get('market')).toBe(market);
    expect(comparison.searchParams.get('period')).toBe('1y');
  },
);
it('does not bridge missing days or report a previous segment as the current RSI', () => {
  const points = Array.from({ length: 210 }, (_, i) => ({ time: (i + 1) * DAY, value: 100 + i }));
  expect(dailyTechnical(points)).toEqual({ asOf: 210 * DAY, rsi: 100, sma200: 209.5 });
  points.push({ time: 212 * DAY, value: 311 });
  expect(dailyTechnical(points)).toEqual({ asOf: 212 * DAY, rsi: null, sma200: null });
  expect(dailyTechnical([])).toEqual({ asOf: null, rsi: null, sma200: null });
});
