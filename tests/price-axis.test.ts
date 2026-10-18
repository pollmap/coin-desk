import { describe, expect, it } from 'vitest';
import {
  axisCoordinates,
  axisPreference,
  defaultAxis,
  effectiveAxis,
  positiveLogAutoscale,
} from '../shared/price-axis';
import {
  dashboardParams,
  dashboardSettingsFromParams,
  isDashboardSettings,
  normalizeDashboardSettings,
} from '../shared/dashboard';
import { hasFocusedAnalysisParams } from '../shared/default-analysis';
import { indicatorUrl } from '../shared/indicator-catalog';
import { dashboardAxis, dashboardPlot } from '../src/dashboard-data';
import { DEFAULT_DESK, importDesk, normalizeDesk, workspaceUrl } from '../shared/workspace';

describe('price-axis meaning and saved preferences', () => {
  it('defaults actual prices to log while ratios and nonprice measures remain linear', () => {
    for (const metric of [
      'view:price',
      'comparison:price',
      'view:supertrend',
      'view:ribbon',
      'view:bb',
      'view:asset_rainbow',
      'view:btc_rainbow',
      'view:btc_rainbow_original',
      'net:realized_price',
      'btc:sth_realized_price',
    ])
      expect(defaultAxis(metric), metric).toBe('log');
    for (const metric of ['net:mvrv', 'btc:lth_mvrv']) {
      expect(defaultAxis(metric)).toBe('linear');
      expect(axisPreference(metric, '1')).toBe('log');
    }
    for (const metric of [
      'rsi',
      'drawdown',
      'net:nupl',
      'btc:mvrv_z',
      'futures:funding',
      'view:seasonality',
      'net:realized_cap',
      'view:hash_ribbons',
    ]) {
      expect(defaultAxis(metric), metric).toBe('linear');
      expect(axisPreference(metric, '1'), metric).toBe('linear');
    }
  });
  it('explicit URL/saved preference wins over remembered preference and default', () => {
    expect(axisPreference('view:price', '0', 'log')).toBe('linear');
    expect(axisPreference('view:price', '1', 'linear')).toBe('log');
    expect(axisPreference('view:price', undefined, 'linear')).toBe('linear');
    expect(axisPreference('view:price', 'garbage', undefined)).toBe('log');
    for (const metric of ['view:price', 'view:supertrend']) {
      const p = new URL(
        indicatorUrl('DOGE', metric, new URLSearchParams('metric=net:mvrv&log=1')),
        'https://example.test',
      ).searchParams;
      expect(p.get('log')).toBe('1');
    }
  });
  it('keeps nonpositive observations, including overlays, rather than filtering them for logarithms', () => {
    for (const values of [[1, 0, 2], [1, -0.01, 2], [1, Infinity], []]) {
      expect(effectiveAxis('log', values)).toBe('linear');
      expect(axisCoordinates(values)).toEqual(values);
    }
    const plot = dashboardPlot({
      asset: 'DOGE',
      metric: 'view:price',
      basis: 'reference',
      prices: [
        { time: 1, value: 1 },
        { time: 2, value: 2 },
      ],
    });
    plot.lines = [
      {
        id: 'bb:lower',
        title: '하단',
        unit: 'USD',
        source: 'test',
        color: '#000',
        overlay: true,
        data: [{ time: 2, value: -1 }],
      },
    ];
    expect(dashboardAxis(plot, 'log')).toBe('linear');
    expect(plot.lines[0].data[0].value).toBe(-1);
  });
  it('preserves optional per-card axis choices in v2 without changing v1/v2 focused log=false', () => {
    const dashboard = normalizeDashboardSettings('BTC', {
      charts: ['view:price', 'net:mvrv'],
      ranges: {},
      scrollY: 12,
      axes: { 'view:price': 'linear', 'net:mvrv': 'log' },
    });
    expect(isDashboardSettings('BTC', dashboard)).toBe(true);
    expect(dashboardSettingsFromParams('BTC', dashboardParams(dashboard))).toEqual(dashboard);
    expect(hasFocusedAnalysisParams(dashboardParams(dashboard))).toBe(false);
    for (const version of [1, 2]) {
      const desk = normalizeDesk({
        ...DEFAULT_DESK,
        version,
        workspaces: [
          {
            name: '가격',
            asset: 'BTC',
            market: 'binance',
            log: false,
            metric: 'view:price',
            view: 'chart',
          },
        ],
      });
      const restored = importDesk(JSON.stringify(desk));
      expect(
        new URL(workspaceUrl(restored.workspaces[0]), 'https://example.test').searchParams.get(
          'log',
        ),
      ).toBe('0');
    }
    expect(
      isDashboardSettings('BTC', { ...dashboard, axes: { 'view:price': 'javascript:bad' } }),
    ).toBe(false);
  });
});

describe('positive-domain log autoscale', () => {
  it.each([
    [0.00001, 10],
    [1e-12, 1e-12],
    [0.05, 0.05],
    [1e-12, 1e12],
    [Number.MIN_VALUE, Number.MIN_VALUE],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ])('keeps the complete finite positive range %s..%s', (low, high) => {
    const actual = positiveLogAutoscale({
      priceRange: { minValue: low, maxValue: high },
      margins: { above: 18, below: 18 },
    })!;
    expect(actual.priceRange!.minValue).toBeGreaterThan(0);
    expect(actual.priceRange!.minValue).toBeLessThanOrEqual(low);
    expect(actual.priceRange!.maxValue).toBeGreaterThanOrEqual(high);
    expect(Number.isFinite(actual.priceRange!.maxValue)).toBe(true);
    expect(actual.priceRange!.maxValue).toBeGreaterThan(actual.priceRange!.minValue);
    expect(actual.margins).toEqual({ above: 0, below: 0 });
  });
  it('does not clamp genuine signed or missing data', () => {
    const input = { priceRange: { minValue: -3, maxValue: 2 } };
    expect(positiveLogAutoscale(input)).toBe(input);
    expect(positiveLogAutoscale(null)).toBeNull();
    expect(positiveLogAutoscale({ priceRange: null })).toEqual({ priceRange: null });
  });
  it('shows equal proportional price changes at equal distances in SVG previews', () => {
    const y = axisCoordinates([1, 10, 100]);
    expect(y[2] - y[1]).toBeCloseTo(y[1] - y[0], 12);
  });
});
