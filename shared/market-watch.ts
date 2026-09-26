import type { Asset, Market, Point } from './types';
import { contiguousCalculation } from './analysis-workspace';

export function marketAnalysisLink(asset: Asset, market: Market) {
  return (
    '/?' + new URLSearchParams({ asset, market, price_source: market, period: 'all', log: '1' })
  );
}

/** Only the latest uninterrupted run of confirmed daily observations can yield a current value. */
export function dailyTechnical(points: Point[]) {
  const asOf = points.at(-1)?.time ?? null;
  const latest = (kind: 'sma' | 'rsi', window: number) => {
    const result = contiguousCalculation(points, kind, window).at(-1);
    return result?.time === asOf ? result.value : null;
  };
  return { rsi: latest('rsi', 14), sma200: latest('sma', 200), asOf };
}

export function marketComparisonLink(asset: Asset, market: Market, period = 'all') {
  const assets = asset === 'BTC' ? ['BTC', 'DOGE', 'ETH'] : ['BTC', asset];
  return '/compare?' + new URLSearchParams({ assets: assets.join(','), market, period });
}
