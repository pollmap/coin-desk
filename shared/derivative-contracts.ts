import { ASSET_REGISTRY, assetDefinition } from './asset-registry';
import type { Asset } from './types';
export const DERIVATIVE_ASSETS: readonly Asset[] = ASSET_REGISTRY.filter((a) => a.derivative).map(
  (a) => a.id,
);
export type DerivativeAsset = (typeof DERIVATIVE_ASSETS)[number];
export function derivativeContract(asset: Asset) {
  const contract = assetDefinition(asset)?.derivative;
  if (!contract) throw new Error('Unsupported derivatives contract: ' + asset);
  return contract;
}
