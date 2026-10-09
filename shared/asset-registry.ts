import manifest from './asset-registry.json' with { type: 'json' };
import type { Asset, Market } from './types';
export interface AssetDefinition {
  id: Asset;
  name: string;
  englishName: string;
  aliases: string[];
  color: string;
  logo: string;
  coinloreId: string;
  rank: number;
  markets: Record<Market, string | null>;
  network: {
    id: string;
    scope: string;
    metrics: Record<string, { first: string; last: string }>;
  } | null;
  derivative: { symbol: string; quantityMultiplier: number } | null;
  review: { pairVerified: boolean; sources: string[] };
}
/** Frozen identifiers, not a live ranking. Existing URLs and browser keys remain valid. */
export const ASSET_REGISTRY = manifest.assets as AssetDefinition[];
export const ASSET_REGISTRY_VERSION = manifest.version;
export const ASSET_REGISTRY_REVIEWED = manifest.reviewedAt;
const index = new Map<string, AssetDefinition>(ASSET_REGISTRY.map((a) => [a.id, a]));
export const assetDefinition = (id: string) => index.get(id);
export const isAsset = (id: string): id is Asset => index.has(id);
export const supportsMarket = (id: string, market: Market) => !!index.get(id)?.markets[market];
export function availableMarket(id: string, preferred: Market): Market {
  return supportsMarket(id, preferred) ? preferred : preferred === 'upbit' ? 'binance' : 'upbit';
}
export const networkProviderId = (id: Asset) => index.get(id)?.network?.id;
export const referenceAssets = ASSET_REGISTRY.filter((a) => a.network?.metrics.PriceUSD).map(
  (a) => a.id,
);
export const hasNetworkField = (id: Asset, metric: string) =>
  !!index.get(id)?.network?.metrics[metric];
