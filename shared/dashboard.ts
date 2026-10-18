import { indicatorDefinition } from './indicator-catalog';
import { availableMarket } from './asset-registry';
import type { DateWindow } from './date-navigation';
import type { Asset, Market } from './types';
import { readAxis, type AxisPreference } from './price-axis';

/** Optional version-2 workspace state. Existing single-chart workspaces stay unchanged. */
export interface DashboardSettings {
  charts: string[];
  ranges: Record<string, DateWindow>;
  scrollY: number;
  ohlcSource?: Market;
  axes?: Record<string, AxisPreference>;
  models?: Record<string, string>;
}

const CHART_ORDER = [
  'view:price',
  'view:supertrend',
  'net:mvrv',
  'view:btc_rainbow_original',
  'view:asset_rainbow',
  'net:realized_price',
  'btc:mvrv_z',
  'net:nupl',
  'btc:sopr_24h',
  'btc:sth_mvrv',
  'btc:lth_mvrv',
  'view:hash_ribbons',
  'view:hashrate_trend',
  'net:active_addresses',
  'view:relative',
] as const;

export function defaultChartIds(asset: Asset): string[] {
  return CHART_ORDER.filter(
    (id) =>
      indicatorDefinition(id)?.assets.includes(asset) &&
      !(asset === 'BTC' && id === 'view:asset_rainbow') &&
      !(asset === 'BTC' && id === 'view:hashrate_trend'),
  );
}

/** Optional charts remain available without expanding the initial reading flow. */
export function availableDashboardChartIds(asset: Asset): string[] {
  return [
    ...defaultChartIds(asset),
    ...[
      'view:ribbon',
      'view:bb',
      'view:seasonality',
      'net:transactions',
      'view:asset_rainbow',
      'view:btc_rainbow',
    ].filter(
      (id) =>
        !defaultChartIds(asset).includes(id) && indicatorDefinition(id)?.assets.includes(asset),
    ),
  ];
}

export function validateDashboardChartIds(asset: Asset, value: unknown): string[] {
  if (!Array.isArray(value)) return defaultChartIds(asset);
  const supported = new Set(availableDashboardChartIds(asset));
  const charts = [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && supported.has(id))),
  ];
  return charts.length ? charts : defaultChartIds(asset);
}

export function normalizeDashboardSettings(asset: Asset, value: unknown): DashboardSettings {
  const v =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const charts = validateDashboardChartIds(asset, v.charts);
  const rawRanges =
    v.ranges && typeof v.ranges === 'object' && !Array.isArray(v.ranges)
      ? (v.ranges as Record<string, unknown>)
      : {};
  const ranges: Record<string, DateWindow> = {};
  const axes: Record<string, AxisPreference> = {};
  const models: Record<string, string> = {};
  if (v.models && typeof v.models === 'object' && !Array.isArray(v.models)) {
    const model = (v.models as Record<string, unknown>)['view:btc_rainbow_original'];
    if (
      charts.includes('view:btc_rainbow_original') &&
      typeof model === 'string' &&
      /^bc-original-[a-f0-9]{12}-[a-f0-9]{12}$/.test(model)
    )
      models['view:btc_rainbow_original'] = model;
  }
  if (v.axes && typeof v.axes === 'object' && !Array.isArray(v.axes)) {
    for (const id of charts) {
      const axis = readAxis((v.axes as Record<string, unknown>)[id]);
      if (axis) axes[id] = axis;
    }
  }
  for (const id of charts) {
    const range = rawRanges[id];
    if (!range || typeof range !== 'object' || Array.isArray(range)) continue;
    const { from, to } = range as Record<string, unknown>;
    if (
      Number.isSafeInteger(from) &&
      Number.isSafeInteger(to) &&
      Number(from) > 0 &&
      Number(to) > Number(from) &&
      Number(to) <= 253402300799
    )
      ranges[id] = { from: Number(from), to: Number(to) };
  }
  return {
    charts,
    ranges,
    ...(Object.keys(axes).length ? { axes } : {}),
    ...(Object.keys(models).length ? { models } : {}),
    scrollY:
      typeof v.scrollY === 'number' && Number.isFinite(v.scrollY)
        ? Math.min(1000000, Math.max(0, Math.round(v.scrollY)))
        : 0,
    ...(v.ohlcSource === 'upbit' || v.ohlcSource === 'binance'
      ? { ohlcSource: availableMarket(asset, v.ohlcSource) }
      : {}),
  };
}

export function isDashboardSettings(asset: Asset, value: unknown): value is DashboardSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    !Array.isArray(v.charts) ||
    !v.charts.length ||
    v.charts.length !== new Set(v.charts).size ||
    v.charts.some(
      (id) => typeof id !== 'string' || !availableDashboardChartIds(asset).includes(id),
    ) ||
    !Number.isSafeInteger(v.scrollY) ||
    Number(v.scrollY) < 0 ||
    Number(v.scrollY) > 1000000 ||
    !v.ranges ||
    typeof v.ranges !== 'object' ||
    Array.isArray(v.ranges)
  )
    return false;
  const normalized = normalizeDashboardSettings(asset, value);
  const ranges = v.ranges as Record<string, unknown>;
  if (Object.keys(ranges).length !== Object.keys(normalized.ranges).length) return false;
  if (
    v.axes !== undefined &&
    (!v.axes ||
      typeof v.axes !== 'object' ||
      Array.isArray(v.axes) ||
      Object.entries(v.axes).some(([key, value]) => normalized.axes?.[key] !== value))
  )
    return false;
  if (
    v.models !== undefined &&
    (!v.models ||
      typeof v.models !== 'object' ||
      Array.isArray(v.models) ||
      Object.entries(v.models).some(([key, value]) => normalized.models?.[key] !== value))
  )
    return false;
  return v.ohlcSource === undefined || v.ohlcSource === normalized.ohlcSource;
}

/** Only explicit saved links carry scroll/ranges; ordinary navigation has no restore side effects. */
export function dashboardSettingsFromParams(
  asset: Asset,
  params: URLSearchParams,
): DashboardSettings {
  let ranges: unknown;
  let axes: unknown;
  let models: unknown;
  const rawModels = params.get('dashboard_models');
  if (rawModels && rawModels.length <= 1024) {
    try {
      models = JSON.parse(rawModels);
    } catch {
      /* Ignore malformed optional model settings. */
    }
  }
  const rawAxes = params.get('dashboard_axes');
  if (rawAxes && rawAxes.length <= 8192) {
    try {
      axes = JSON.parse(rawAxes);
    } catch {
      /* Ignore malformed optional preferences. */
    }
  }
  const raw = params.get('dashboard_ranges');
  if (raw && raw.length <= 8192) {
    try {
      ranges = JSON.parse(raw);
    } catch {
      /* Ignore invalid optional restore data. */
    }
  }
  return normalizeDashboardSettings(asset, {
    charts: params.has('dashboard_cards') ? params.get('dashboard_cards')!.split(',') : undefined,
    ranges,
    axes,
    models,
    scrollY: Number(params.get('dashboard_scroll') ?? 0),
    ohlcSource: params.get('dashboard_ohlc'),
  });
}

export function dashboardParams(settings: DashboardSettings): URLSearchParams {
  const p = new URLSearchParams({ dashboard_cards: settings.charts.join(',') });
  if (Object.keys(settings.ranges).length)
    p.set('dashboard_ranges', JSON.stringify(settings.ranges));
  if (settings.scrollY > 0) p.set('dashboard_scroll', String(settings.scrollY));
  if (settings.ohlcSource) p.set('dashboard_ohlc', settings.ohlcSource);
  if (settings.axes && Object.keys(settings.axes).length)
    p.set('dashboard_axes', JSON.stringify(settings.axes));
  if (settings.models && Object.keys(settings.models).length)
    p.set('dashboard_models', JSON.stringify(settings.models));
  return p;
}
