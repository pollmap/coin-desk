import { ASSETS } from './catalog';
import type { Asset } from './types';

/** Legacy correlation URLs explicitly selected DOGE/BTC or ETH/BTC. */
export function relativePair(asset: Asset, params: URLSearchParams) {
  const legacy = params.get('correlation_asset');
  const migrated = !params.has('benchmark_asset') && (legacy === 'DOGE' || legacy === 'ETH');
  const selected: Asset = migrated ? legacy : asset;
  const requested = migrated ? 'BTC' : params.get('benchmark_asset');
  const benchmark =
    ASSETS.find((a) => a.id === requested && a.id !== selected)?.id ??
    (selected === 'BTC' ? 'ETH' : 'BTC');
  return { asset: selected, benchmark, migrated };
}
