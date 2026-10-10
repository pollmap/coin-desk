import { describe, it, expect } from 'vitest';
import { ASSETS } from '../shared/catalog';
import { defaultAnalysisUrl, defaultIndicator } from '../shared/default-analysis';
import { indicatorUrl, INDICATORS_CATALOG } from '../shared/indicator-catalog';

describe('light market links preserve analysis defaults', () => {
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
