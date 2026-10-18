import { availableMarket, hasNetworkField, referenceAssets } from './asset-registry';
import type { Asset, Market } from './types';

/** Market links need the supported default, not the full analysis/guide catalog. */
export const defaultIndicator = (asset: Asset) =>
  hasNetworkField(asset, 'CapMVRVCur') ? 'net:mvrv' : 'rsi';

/** Asset-only navigation opens the overview; explicit indicator links remain focused. */
export function defaultDashboardUrl(asset: Asset, preferred: Market = 'upbit') {
  const market = availableMarket(asset, preferred);
  return (
    '/coins/' +
    asset +
    '?' +
    new URLSearchParams({
      asset,
      market,
      price_source: referenceAssets.includes(asset) ? 'reference' : market,
    })
  );
}

export function hasFocusedAnalysisParams(params: URLSearchParams): boolean {
  return [
    'metric',
    'visual',
    'panels',
    'indicators',
    'draw_tool',
    'patterns',
    'signal',
    'chart_from',
    'chart_to',
    'reading_date',
    'interval',
    'log',
    'chart_style',
    'compare_price',
  ].some((key) => params.has(key));
}

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
      period: 'all',
      interval: '1d',
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

/** Lightweight market entry; the complete guide/chart catalog stays lazy. */
export function defaultCoreAnalysisUrl(asset: Asset, preferred: Market) {
  const market = availableMarket(asset, preferred);
  const metric = defaultIndicator(asset) === 'net:mvrv' ? 'net:mvrv' : 'view:supertrend';
  return (
    '/coins/' +
    asset +
    '?' +
    new URLSearchParams({
      asset,
      metric,
      price_source: market,
      market,
      period: metric === 'net:mvrv' ? '5y' : 'all',
      ...(metric === 'view:supertrend' ? { interval: '1w' } : {}),
    })
  );
}
