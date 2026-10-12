import { availableMarket, hasNetworkField } from './asset-registry';
import type { Asset, Market } from './types';

/** Market links need the supported default, not the full analysis/guide catalog. */
export const defaultIndicator = (asset: Asset) =>
  hasNetworkField(asset, 'CapMVRVCur') ? 'net:mvrv' : 'rsi';

/** Plain asset/price navigation is distinct from an explicit indicator entry. */
export function defaultPriceUrl(asset: Asset, preferred: Market) {
  const market = availableMarket(asset, preferred);
  return (
    '/coins/' +
    asset +
    '?' +
    new URLSearchParams({
      market,
      price_source: market,
      asset,
      metric: 'view:price',
      period: '1m',
      interval: '1d',
      log: '0',
    })
  );
}

export function defaultAnalysisUrl(asset: Asset, preferred: Market) {
  const market = availableMarket(asset, preferred),
    metric = defaultIndicator(asset);
  return (
    '/coins/' +
    asset +
    '?' +
    new URLSearchParams({
      market,
      price_source: market,
      asset,
      metric,
      period: metric === 'rsi' ? '1y' : '5y',
    })
  );
}
