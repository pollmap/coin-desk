import type { Asset, CandleResponse, SeriesResponse } from './types';
import type { PriceBasis } from './analysis-workspace';
import { supportsMarket, referenceAssets } from './asset-registry';
import origins from './price-history-origins.json' with { type: 'json' };

/** Select one verified full history; never splice providers or change its unit. */
export function longestPriceBasis(asset: Asset, fallback: PriceBasis): PriceBasis {
  const dates = (origins.assets as Record<string, Partial<Record<PriceBasis, number>>>)[asset];
  const available = (Object.entries(dates ?? {}) as [PriceBasis, number][]).filter(([source]) =>
    source === 'reference' ? referenceAssets.includes(asset) : supportsMarket(asset, source),
  );
  // Preserve the chosen unit on ties. Explicit URLs/workspaces do not call this helper.
  available.sort((a, b) => a[1] - b[1] || Number(b[0] === fallback) - Number(a[0] === fallback));
  return available[0]?.[0] ?? fallback;
}

/** Preserve the traded quote unit; do not splice or convert reference prices. */
export function closeHistory(response: CandleResponse): SeriesResponse {
  return {
    data: response.data
      .filter((p) => p.closed && Number.isFinite(p.close) && p.close > 0)
      .map((p) => ({ time: p.time, value: p.close })),
    price: [],
    meta: response.meta,
    nextCursor: response.nextCursor,
  };
}
