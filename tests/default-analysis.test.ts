import { describe, it, expect } from 'vitest';
import { ASSETS } from '../shared/catalog';
import {
  defaultAnalysisUrl,
  defaultCoreAnalysisUrl,
  defaultIndicator,
  defaultPriceUrl,
} from '../shared/default-analysis';
import { availableMarket } from '../shared/asset-registry';
import { resolveIndicator } from '../shared/indicator-catalog';
import { indicatorUrl, INDICATORS_CATALOG } from '../shared/indicator-catalog';

describe('light market links preserve analysis defaults', () => {
  it('core market entries match canonical MVRV/Supertrend links without changing legacy defaults', () => {
    for (const asset of ASSETS)
      for (const market of ['upbit', 'binance'] as const) {
        const id = defaultIndicator(asset.id) === 'net:mvrv' ? 'net:mvrv' : 'view:supertrend';
        const actual = new URL(defaultCoreAnalysisUrl(asset.id, market), 'https://test.invalid');
        const full = new URL(
          indicatorUrl(asset.id, id, new URLSearchParams({ market, price_source: market })),
          'https://test.invalid',
        );
        expect(actual.pathname).toBe(full.pathname);
        expect(Object.fromEntries(actual.searchParams)).toEqual(
          Object.fromEntries(full.searchParams),
        );
        expect(resolveIndicator(asset.id, actual.pathname, actual.searchParams).supported).toBe(
          true,
        );
      }
  });
  it('opens actual market prices for all 150 assets without changing explicit analysis links', () => {
    for (const asset of ASSETS)
      for (const preferred of ['upbit', 'binance'] as const) {
        const url = new URL(defaultPriceUrl(asset.id, preferred), 'https://test.invalid');
        expect(url.searchParams.get('market')).toBe(availableMarket(asset.id, preferred));
        expect(url.searchParams.get('price_source')).toBe(url.searchParams.get('market'));
        expect(resolveIndicator(asset.id, url.pathname, url.searchParams).id).toBe('view:price');
        expect(url.searchParams.get('period')).toBe('all');
        expect(url.searchParams.get('log')).toBe('0');
        expect(resolveIndicator(asset.id, url.pathname, new URLSearchParams()).id).toBe(
          'view:price',
        );
        expect(resolveIndicator(asset.id, '/onchain', new URLSearchParams()).id).toBe('net:mvrv');
      }
  });
  it('matches supported definitions and the full link builder for all 150 assets and both markets', () => {
    for (const asset of ASSETS)
      for (const market of ['upbit', 'binance'] as const) {
        const id = defaultIndicator(asset.id);
        const definition = INDICATORS_CATALOG.find((d) => d.id === id)!;
        expect(definition.assets).toContain(asset.id);
        const actual = new URL(defaultAnalysisUrl(asset.id, market), 'https://test.invalid');
        const full = new URL(
          indicatorUrl(asset.id, id, new URLSearchParams({ market, price_source: market })),
          'https://test.invalid',
        );
        expect(actual.pathname).toBe(full.pathname);
        expect(Object.fromEntries(actual.searchParams)).toEqual(
          Object.fromEntries(full.searchParams),
        );
      }
  });
});
