import { ASSET_REGISTRY, ASSET_REGISTRY_VERSION, ASSET_REGISTRY_REVIEWED } from './asset-registry';
import { matchesCoin } from './coin-search';
import { INDICATORS_CATALOG } from './indicator-catalog';
import { THEMES } from './knowledge';

/** Public discovery metadata; no quotes, personal storage, or live provider requests. */
export function discoverAssets(query: URLSearchParams) {
  const market = query.get('market'),
    metric = query.get('metric'),
    theme = query.get('theme');
  const matched = ASSET_REGISTRY.filter(
    (a) =>
      matchesCoin(a.id, query.get('q') ?? '') &&
      (!market || ((market === 'upbit' || market === 'binance') && a.markets[market])) &&
      (!metric || INDICATORS_CATALOG.find((d) => d.id === metric)?.assets.includes(a.id)) &&
      (!theme || THEMES.find((t) => t.id === theme)?.members.some((m) => m.asset === a.id)),
  );
  const offset = Math.max(0, Number(query.get('offset')) || 0);
  const limit = Math.min(150, Math.max(1, Number(query.get('limit')) || 50));
  return {
    version: ASSET_REGISTRY_VERSION,
    reviewedAt: ASSET_REGISTRY_REVIEWED,
    total: matched.length,
    offset,
    limit,
    data: matched.slice(offset, offset + limit).map((a) => ({
      id: a.id,
      name: a.name,
      englishName: a.englishName,
      aliases: a.aliases,
      markets: a.markets,
      indicators: INDICATORS_CATALOG.filter((d) => d.assets.includes(a.id)).map((d) => d.id),
      themes: THEMES.filter((t) => t.members.some((m) => m.asset === a.id)).map((t) => t.id),
    })),
  };
}
