import { describe, expect, it } from 'vitest';
import { ASSET_REGISTRY, assetDefinition, availableMarket } from '../shared/asset-registry';
import { discoverAssets } from '../shared/asset-discovery';
import { defaultIndicator, indicatorDefinition } from '../shared/indicator-catalog';
import { derivativeContract } from '../shared/derivative-contracts';
import { networkSourceMetrics, parseNetwork } from '../worker/network-data';
import { networkMetrics } from '../shared/network-catalog';
import { DAY } from '../shared/math';

describe('frozen public asset identities and capabilities', () => {
  it('registers 150 distinct reviewed identities with a tradable price source', () => {
    expect(ASSET_REGISTRY).toHaveLength(150);
    expect(new Set(ASSET_REGISTRY.map((a) => a.id)).size).toBe(150);
    for (const asset of ASSET_REGISTRY) {
      expect(asset.review.pairVerified).toBe(true);
      expect(asset.review.sources.length).toBeGreaterThan(0);
      expect(asset.markets[availableMarket(asset.id, 'upbit')]).toBeTruthy();
      expect(asset.markets[availableMarket(asset.id, 'binance')]).toBeTruthy();
      expect(indicatorDefinition(defaultIndicator(asset.id))?.assets).toContain(asset.id);
    }
    for (const ambiguous of ['GTC', 'FRAX', 'BFUSD', 'TON'])
      expect(assetDefinition(ambiguous)).toBeUndefined();
    expect(assetDefinition('BEAM')?.network).toBeNull();
  });
  it('searches aliases and paginates without inventing exchange coverage', () => {
    const penguin = discoverAssets(new URLSearchParams('q=펭귄'));
    expect(penguin.data.map((a) => a.id)).toEqual(['PENGU']);
    expect(penguin.data[0].markets).toEqual({ upbit: 'KRW-PENGU', binance: 'PENGUUSDT' });
    const first = discoverAssets(new URLSearchParams('limit=50'));
    const next = discoverAssets(new URLSearchParams('offset=50&limit=50'));
    expect(first.total).toBe(150);
    expect(new Set([...first.data, ...next.data].map((a) => a.id)).size).toBe(100);
    expect(discoverAssets(new URLSearchParams('market=upbit')).total).toBe(103);
  });
  it('keeps provider IDs and derivative quantity units separate', () => {
    expect(assetDefinition('SHIB')?.network?.id).toBe('shib_eth');
    expect(derivativeContract('PEPE')).toMatchObject({
      symbol: '1000PEPEUSDT',
      quantityMultiplier: 1000,
    });
    expect(assetDefinition('PEPE')?.markets.binance).toBe('PEPEUSDT');
    expect(derivativeContract('SHIB')).toMatchObject({
      symbol: 'SHIB1000USDT',
      quantityMultiplier: 1000,
    });
  });
  it('expands only observed network fields and excludes invalid historical fees', () => {
    for (const asset of ['ADA', 'AAVE', 'SHIB'] as const) {
      expect(defaultIndicator(asset)).toBe('net:mvrv');
      const now = Math.floor(Date.now() / 1000 / DAY) * DAY;
      const input = {
        data: [
          {
            ...Object.fromEntries(networkSourceMetrics(asset).map((field) => [field, null])),
            asset: assetDefinition(asset)!.network!.id,
            time: new Date((now - DAY) * 1000).toISOString(),
            CapMVRVCur: '1.42',
          },
        ],
      };
      expect(parseNetwork(input, asset, now)[0].values.mvrv).toBe(1.42);
    }
    for (const asset of ['DASH', 'DCR'] as const) {
      expect(networkSourceMetrics(asset)).not.toContain('FeeTotNtv');
      expect(networkMetrics(asset).map((m) => m.id)).not.toContain('fees_native');
    }
    for (const asset of ['SOL', 'ONDO', 'PEPE'] as const)
      expect(defaultIndicator(asset)).toBe('rsi');
  });
});
