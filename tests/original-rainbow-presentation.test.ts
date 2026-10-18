import { describe, expect, it } from 'vitest';
import { ORIGINAL_RAINBOW_BASELINE } from '../shared/btc-rainbow-original';
import { originalRainbowLines } from '../src/original-rainbow-plot';
import { dashboardPlot } from '../src/dashboard-data';
import { defaultChartIds, normalizeDashboardSettings, dashboardSettingsFromParams, isDashboardSettings } from '../shared/dashboard';
import { indicatorDefinition, indicatorUrl } from '../shared/indicator-catalog';
import { DEFAULT_DESK, normalizeDesk, workspaceUrl } from '../shared/workspace';

const day = (date: string) => Date.parse(date + 'T00:00:00Z') / 1000;

describe('Original rainbow presentation and saved model identity', () => {
  it('renders ten original centerlines without relabeling them as our nine residual bands', () => {
    const prices = [
      { time: day('2012-01-01'), value: 5 },
      { time: day('2024-05-24'), value: 60000 }, // Official date is absent; own USD price remains genuine.
      { time: day('2026-10-18'), value: 80000 },
    ];
    const before = structuredClone(prices);
    const lines = originalRainbowLines(prices, ORIGINAL_RAINBOW_BASELINE, day('2026-10-19'));
    expect(lines).toHaveLength(10);
    expect(lines.every((line) => line.unit === 'USD' && line.overlay)).toBe(true);
    expect(lines[0].data.map((p) => p.time)).toEqual([day('2012-01-01'), day('2026-10-18')]);
    expect(lines[0].data[0].value).toBeCloseTo(35.09617567, 7);
    expect(lines[9].data[0].value).toBeCloseTo(1.42409843, 7);
    expect(lines[0].data[1].value).toBeCloseTo(1343195.97714898, 6);
    expect(prices).toEqual(before);
  });

  it('keeps price history before the model start and uses only actual USD for the original', () => {
    const prices = [{ time: day('2010-07-18'), value: 0.1 }, { time: day('2012-01-01'), value: 5 }];
    const plot = dashboardPlot({ asset: 'BTC', metric: 'view:btc_rainbow_original', basis: 'reference', prices });
    expect(plot.points).toEqual(prices);
    expect(plot.lines).toHaveLength(10);
    expect(plot.bands).toBeUndefined();
    expect(plot.unit).toBe('USD');
    expect(plot.lines[0].data[0].time).toBe(day('2012-01-01'));
    expect(indicatorDefinition('view:btc_rainbow_original')?.assets).toEqual(['BTC']);
  });

  it('uses Original for new BTC dashboards while preserving explicitly saved own models', () => {
    expect(defaultChartIds('BTC')).toContain('view:btc_rainbow_original');
    expect(defaultChartIds('BTC')).not.toContain('view:asset_rainbow');
    expect(defaultChartIds('DOGE')).toContain('view:asset_rainbow');
    expect(defaultChartIds('DOGE')).not.toContain('view:btc_rainbow_original');
    expect(normalizeDashboardSettings('BTC', { charts: ['view:asset_rainbow'] }).charts).toEqual(['view:asset_rainbow']);
    for (const metric of ['view:btc_rainbow', 'view:asset_rainbow', 'view:btc_rainbow_original']) {
      const desk = normalizeDesk({ ...DEFAULT_DESK, workspaces: [{ name: metric, asset: 'BTC', metric, view: 'chart', priceSource: 'reference', log: false,
        analysisOptions: metric.endsWith('_original') ? { rainbow_model: ORIGINAL_RAINBOW_BASELINE.modelVersion } : {} }] });
      const url = new URL(workspaceUrl(desk.workspaces[0]), 'https://example.test');
      expect(url.searchParams.get('metric')).toBe(metric);
      expect(url.searchParams.get('log')).toBe('0');
      if (metric.endsWith('_original')) expect(url.searchParams.get('rainbow_model')).toBe(ORIGINAL_RAINBOW_BASELINE.modelVersion);
    }
  });

  it('roundtrips the original model and per-chart axis without opening a focused chart', () => {
    const metric = 'view:btc_rainbow_original';
    const dashboard = normalizeDashboardSettings('BTC', {
      charts: ['view:price', metric], ranges: { [metric]: { from: day('2020-01-01'), to: day('2025-01-01') } },
      axes: { [metric]: 'linear' }, models: { [metric]: ORIGINAL_RAINBOW_BASELINE.modelVersion }, scrollY: 1400,
    });
    const desk = normalizeDesk({ ...DEFAULT_DESK, workspaces: [{ name: 'BTC 사이클', asset: 'BTC', view: 'dashboard', priceSource: 'reference', dashboard, cards: [] }] });
    const restored = new URL(workspaceUrl(desk.workspaces[0]), 'https://example.test');
    expect(restored.searchParams.has('metric')).toBe(false);
    expect(restored.searchParams.has('log')).toBe(false);
    expect(dashboardSettingsFromParams('BTC', restored.searchParams)).toEqual(dashboard);
    expect(isDashboardSettings('BTC', dashboard)).toBe(true);
    expect(isDashboardSettings('BTC', { ...dashboard, models: { [metric]: 'untrusted' } })).toBe(false);
    expect(normalizeDashboardSettings('DOGE', dashboard).models).toBeUndefined();
  });

  it('never carries an Original model identity into the separate own-regression model', () => {
    const original = new URLSearchParams({ metric: 'view:btc_rainbow_original', rainbow_model: ORIGINAL_RAINBOW_BASELINE.modelVersion, price_source: 'reference' });
    const own = new URL(indicatorUrl('BTC', 'view:asset_rainbow', original), 'https://example.test');
    expect(own.searchParams.has('rainbow_model')).toBe(false);
    const ownSaved = new URLSearchParams({ metric: 'view:asset_rainbow', rainbow_model: 'asset-log-v1', rainbow_origin: '2010-07-18', price_source: 'reference' });
    const reopened = new URL(indicatorUrl('BTC', 'view:asset_rainbow', ownSaved), 'https://example.test');
    expect(reopened.searchParams.get('rainbow_model')).toBe('asset-log-v1');
    expect(reopened.searchParams.get('rainbow_origin')).toBe('2010-07-18');
    const switched = new URL(indicatorUrl('BTC', 'view:btc_rainbow_original', ownSaved), 'https://example.test');
    expect(switched.searchParams.has('rainbow_model')).toBe(false);
  });
});
