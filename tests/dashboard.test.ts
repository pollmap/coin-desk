import { describe, expect, it } from 'vitest';
import { ASSETS } from '../shared/catalog';
import { availableMarket, referenceAssets } from '../shared/asset-registry';
import { defaultDashboardUrl, hasFocusedAnalysisParams } from '../shared/default-analysis';
import {
  availableDashboardChartIds,
  dashboardParams,
  dashboardSettingsFromParams,
  defaultChartIds,
  isDashboardSettings,
  normalizeDashboardSettings,
} from '../shared/dashboard';
import { indicatorDefinition } from '../shared/indicator-catalog';
import { DEFAULT_DESK, importDesk, normalizeDesk, workspaceUrl } from '../shared/workspace';

describe('coin overview navigation and local saved state', () => {
  it('opens all 150 assets without an implicit metric and keeps the chosen market distinct from price history', () => {
    for (const asset of ASSETS)
      for (const market of ['upbit', 'binance'] as const) {
        const url = new URL(defaultDashboardUrl(asset.id, market), 'https://example.test');
        expect(url.pathname).toBe('/coins/' + asset.id);
        expect(url.searchParams.get('asset')).toBe(asset.id);
        expect(url.searchParams.get('market')).toBe(availableMarket(asset.id, market));
        expect(url.searchParams.get('price_source')).toBe(
          referenceAssets.includes(asset.id) ? 'reference' : availableMarket(asset.id, market),
        );
        expect(hasFocusedAnalysisParams(url.searchParams)).toBe(false);
        expect(url.searchParams.has('period')).toBe(false);
        expect(url.searchParams.has('dashboard_scroll')).toBe(false);
      }
  });
  it('preserves explicit legacy chart and indicator links', () => {
    for (const key of [
      'metric',
      'visual',
      'panels',
      'indicators',
      'patterns',
      'draw_tool',
      'signal',
      'chart_from',
      'chart_to',
      'reading_date',
      'interval',
      'log',
      'chart_style',
      'compare_price',
    ])
      expect(hasFocusedAnalysisParams(new URLSearchParams({ [key]: '' }))).toBe(true);
    expect(
      hasFocusedAnalysisParams(new URLSearchParams('market=binance&period=5y&knowledge=1')),
    ).toBe(false);
  });
  it('never adds BTC-only or unsupported onchain series to another asset', () => {
    for (const asset of ASSETS) {
      const ids = defaultChartIds(asset.id);
      expect(ids.slice(0, 2)).toEqual(['view:price', 'view:supertrend']);
      expect(ids.every((id) => indicatorDefinition(id)?.assets.includes(asset.id))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.includes('net:active_addresses')).toBe(
        indicatorDefinition('net:active_addresses')!.assets.includes(asset.id),
      );
      expect(availableDashboardChartIds(asset.id).includes('net:transactions')).toBe(
        indicatorDefinition('net:transactions')!.assets.includes(asset.id),
      );
      expect(ids).not.toContain('net:transactions');
    }
    expect(defaultChartIds('ONDO')).not.toContain('net:mvrv');
    expect(defaultChartIds('BTC')).toContain('view:hash_ribbons');
    expect(defaultChartIds('BTC')).not.toContain('view:hashrate_trend');
    expect(defaultChartIds('DOGE')).toContain('view:hashrate_trend');
    expect(defaultChartIds('ETH')).not.toContain('view:hashrate_trend');
    expect(defaultChartIds('ETH')).toContain('net:active_addresses');
  });
  it('preserves optional supported charts without adding them to the default view', () => {
    for (const asset of ASSETS) {
      for (const id of ['view:ribbon', 'view:bb', 'view:seasonality']) {
        expect(defaultChartIds(asset.id)).not.toContain(id);
        expect(availableDashboardChartIds(asset.id)).toContain(id);
      }
      const configured = normalizeDashboardSettings(asset.id, {
        charts: ['view:bb', 'view:ribbon', 'view:seasonality'],
        ranges: {},
        scrollY: 0,
      });
      expect(configured.charts).toEqual(['view:bb', 'view:ribbon', 'view:seasonality']);
      expect(isDashboardSettings(asset.id, configured)).toBe(true);
    }
  });
  it('roundtrips optional v2 multi-chart order, independent windows and explicit saved scroll', () => {
    const dashboard = normalizeDashboardSettings('DOGE', {
      charts: ['view:supertrend', 'view:price', 'net:mvrv'],
      ranges: {
        'view:price': { from: 1609459200, to: 1735689600 },
        'net:mvrv': { from: 1704067200, to: 1735689600 },
      },
      scrollY: 1234,
      ohlcSource: 'binance',
    });
    const desk = normalizeDesk({
      ...DEFAULT_DESK,
      workspaces: [
        {
          name: '도지 흐름',
          asset: 'DOGE',
          market: 'upbit',
          priceSource: 'reference',
          period: 'all',
          view: 'dashboard',
          dashboard,
          cards: [],
        },
      ],
    });
    const restored = importDesk(JSON.stringify(desk));
    expect(restored).toEqual(desk);
    const url = new URL(workspaceUrl(restored.workspaces[0]), 'https://example.test');
    expect(url.pathname).toBe('/coins/DOGE');
    expect(hasFocusedAnalysisParams(url.searchParams)).toBe(false);
    expect(url.searchParams.get('price_source')).toBe('reference');
    expect(dashboardSettingsFromParams('DOGE', url.searchParams)).toEqual(dashboard);
    expect(
      isDashboardSettings('DOGE', {
        scrollY: 1234,
        ranges: dashboard.ranges,
        charts: dashboard.charts,
        ohlcSource: 'binance',
      }),
    ).toBe(true);
  });
  it('retains old v1/v2 dashboard links and annotations instead of reinterpreting them as multi-chart saves', () => {
    for (const version of [1, 2]) {
      const desk = normalizeDesk({
        ...DEFAULT_DESK,
        version,
        workspaces: [
          {
            name: '기존 저장',
            asset: 'BTC',
            view: 'dashboard',
            metric: 'net:mvrv',
            cards: [],
          },
        ],
      });
      const url = new URL(
        workspaceUrl(importDesk(JSON.stringify(desk)).workspaces[0]),
        'https://example.test',
      );
      expect(url.pathname).toBe('/');
      expect(url.searchParams.get('metric')).toBe('net:mvrv');
      expect(desk.workspaces[0].dashboard).toBeUndefined();
    }
  });
  it('bounds untrusted restore data and does not serialize unrelated notes, URLs or unsupported charts', () => {
    const safe = normalizeDashboardSettings('ONDO', {
      charts: ['net:mvrv', 'view:price', 'view:price', 'javascript:bad'],
      ranges: {
        'net:mvrv': { from: 1, to: 2 },
        'view:price': { from: 5, to: 1 },
        note: 'private original',
      },
      scrollY: Infinity,
      note: 'private note',
    });
    expect(safe).toEqual({ charts: ['view:price'], ranges: {}, scrollY: 0 });
    expect(dashboardParams(safe).toString()).not.toMatch(/private|javascript|mvrv/);
    expect(
      dashboardSettingsFromParams('ONDO', new URLSearchParams({ dashboard_ranges: '{bad' })).ranges,
    ).toEqual({});
    for (const invalid of [
      null,
      { ...safe, charts: ['net:mvrv'] },
      { ...safe, scrollY: -1 },
      { ...safe, ranges: { 'view:price': { from: 2, to: 1 } } },
      { ...safe, ohlcSource: 'reference' },
    ])
      expect(isDashboardSettings('ONDO', invalid)).toBe(false);
  });
  it('rejects invalid new dashboard imports before replacing local saved data', () => {
    const desk = normalizeDesk({
      ...DEFAULT_DESK,
      workspaces: [{ name: 'saved', asset: 'ONDO', view: 'dashboard', dashboard: {}, cards: [] }],
    });
    const item = desk.workspaces[0];
    expect(() =>
      importDesk(
        JSON.stringify({
          ...desk,
          workspaces: [{ ...item, dashboard: { ...item.dashboard, charts: ['net:mvrv'] } }],
        }),
      ),
    ).toThrow();
  });
});
