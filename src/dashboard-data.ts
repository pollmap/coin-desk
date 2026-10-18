import type { Asset, Candle, CandleResponse, Point, SeriesResponse } from '../shared/types';
import { basisName, basisUnit, type PriceBasis } from '../shared/analysis-workspace';
import { indicatorDefinition } from '../shared/indicator-catalog';
import { assetRainbowContext, assetRainbowDiagnostics } from '../shared/asset-rainbow';
import { hashRibbons, hashrateTrend } from '../shared/hash-ribbons';
import { networkUnit } from '../shared/network-catalog';
import { supertrend } from '../shared/supertrend';
import { relativeAnalysis } from '../shared/relative-analysis';
import { workspaceIndicators } from '../shared/workspace-indicators';
import { seasonality, type Seasonality } from '../shared/advanced-analysis';
import type { AnalysisLine, ChartObservation } from './AnalysisChart';
import type { BandRow } from './BandPrimitive';
import { defaultAxis, effectiveAxis, type AxisPreference } from '../shared/price-axis';
import { ORIGINAL_RAINBOW_BASELINE, type OriginalRainbowReference } from '../shared/btc-rainbow-original';
import { btcRainbow } from '../shared/btc-rainbow';
import { originalRainbowLines } from './original-rainbow-plot';

export const DASHBOARD_EMPTY: Point[] = [];
export function dashboardPriceUrl(asset: Asset, basis: PriceBasis): string {
  return basis === 'reference'
    ? `/api/v1/reference?asset=${asset}&limit=1000`
    : `/api/v1/candles?asset=${asset}&market=${basis}&interval=1d&limit=1000`;
}
export function dashboardSeriesUrl(asset: Asset, metric: string): string | null {
  if (metric === 'view:hash_ribbons' || metric === 'view:hashrate_trend')
    return `/api/v1/network?asset=${asset}&metric=hashrate&limit=1000`;
  if (metric.startsWith('net:'))
    return `/api/v1/network?asset=${asset}&metric=${metric.slice(4)}&limit=1000`;
  if (metric.startsWith('btc:') && asset === 'BTC')
    return `/api/v1/series?asset=BTC&metric=${metric.slice(4)}&limit=1000`;
  return null;
}

/** Keep the requested source and its unit; reference closes never become OHLC. */
export function dashboardPrices(
  response: SeriesResponse | CandleResponse | undefined,
  basis: PriceBasis,
  now = Date.now() / 1000,
): Point[] {
  if (!response) return DASHBOARD_EMPTY;
  if (basis === 'reference')
    return (response as SeriesResponse).data.filter(
      (point) => Number.isFinite(point.value) && point.value > 0 && point.time + 86400 <= now,
    );
  return (response as CandleResponse).data
    .filter((candle) => candle.closed && candle.closeTime <= now && candle.close > 0)
    .map((candle) => ({ time: candle.time, value: candle.close }));
}

export interface DashboardPlot {
  points: Point[];
  primary?: AnalysisLine;
  lines: AnalysisLine[];
  candles?: Candle[];
  bands?: BandRow[];
  unit: string;
  source: string;
  log: boolean;
  step: number;
  state?: string;
  observations?: ChartObservation[];
  seasonality?: Seasonality;
}

export function dashboardAxis(plot: DashboardPlot, requested: AxisPreference): AxisPreference {
  return effectiveAxis(requested, [
    ...plot.points.map((point) => point.value),
    ...(plot.candles ?? []).flatMap((candle) => [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
    ]),
    ...plot.lines
      .filter((line) => line.overlay)
      .flatMap((line) => line.data.map((point) => point.value)),
    ...(plot.bands ?? []).flatMap((row) => row.bands),
  ]);
}

export function dashboardPlot({
  asset,
  metric,
  basis,
  prices,
  series,
  candles,
  benchmark,
  originalReference = ORIGINAL_RAINBOW_BASELINE,
  now = Date.now() / 1000,
}: {
  asset: Asset;
  metric: string;
  basis: PriceBasis;
  prices: Point[];
  series?: SeriesResponse;
  candles?: CandleResponse;
  benchmark?: Point[];
  originalReference?: OriginalRainbowReference | null;
  now?: number;
}): DashboardPlot {
  const definition = indicatorDefinition(metric);
  const unit = basisUnit(basis),
    source = basisName(basis);
  const base: DashboardPlot = {
    points: prices,
    lines: [],
    unit,
    source,
    log: defaultAxis(metric) === 'log',
    step: 86400,
  };
  if (metric === 'view:price') return base;
  if (metric === 'view:btc_rainbow_original') {
    if (asset !== 'BTC' || basis !== 'reference') return { ...base, points: [], state: 'BTC USD 가격에서 사용할 수 있습니다.' };
    return { ...base, lines: originalReference ? originalRainbowLines(prices, originalReference, now) : [], unit: 'USD' };
  }
  if (metric === 'view:ribbon' || metric === 'view:bb') {
    const ids =
      metric === 'view:bb'
        ? ['bb:20:bar:2']
        : [7, 25, 50, 100].map((period) => `sma:${period}:bar`);
    return {
      ...base,
      lines: workspaceIndicators(prices, prices, ids, unit, 86400, metric === 'view:ribbon'),
    };
  }
  if (metric === 'view:seasonality') {
    const result = seasonality(prices, now);
    return { ...base, points: result.current, unit: '%', seasonality: result };
  }
  if (metric === 'view:supertrend') {
    const closed = (candles?.data ?? []).filter((c) => c.closed && c.closeTime <= now);
    const rows = supertrend(closed, '1w', { period: 10, multiplier: 3 }, now);
    return {
      ...base,
      points: closed.map((c) => ({ time: c.time, value: c.close })),
      candles: closed,
      step: 604800,
      state: rows.length
        ? rows.at(-1)!.direction === 'up'
          ? '상승 추세'
          : '하락 추세'
        : undefined,
      lines: [
        {
          id: 'supertrend',
          title: '슈퍼트렌드 10·3',
          unit,
          source,
          data: rows.map((r) => ({ time: r.time, value: r.value })),
          color: '#65d4bc',
          overlay: true,
          step: 604800,
          supertrend: { rows, interval: '1w' },
        },
      ],
    };
  }
  if (metric === 'view:asset_rainbow' || metric === 'view:btc_rainbow') {
    const context = assetRainbowContext(asset, basis, prices);
    const rows =
      metric === 'view:btc_rainbow' ? btcRainbow(prices, now) : context.origin === null ? [] : assetRainbowDiagnostics(prices, context.origin, now).rows;
    return {
      ...base,
      log: true,
      bands: rows,
      state: rows.length ? undefined : '회귀 밴드를 표시할 이력이 부족합니다.',
      lines: Array.from({ length: 10 }, (_, i) => ({
        id: `band:${i}`,
        title: `경계 ${i + 1}`,
        unit,
        source,
        data: rows.map((row) => ({ time: row.time, value: row.bands[i] })),
        color: 'rgba(125,145,180,0.35)',
        overlay: true,
        step: 86400,
      })),
    };
  }
  if (metric === 'view:hash_ribbons' || metric === 'view:hashrate_trend') {
    const hashUnit = networkUnit(asset, 'hashrate');
    const rows =
      metric === 'view:hash_ribbons'
        ? hashRibbons(series?.data ?? [], prices, now)
        : hashrateTrend(series?.data ?? [], now);
    const primary: AnalysisLine = {
      id: metric,
      title: '30일 평균',
      unit: hashUnit,
      source: definition?.source ?? 'Coin Metrics',
      color: '#65d4bc',
      data: rows.map((row) => ({ time: row.time, value: row.hash30 })),
      step: 86400,
    };
    return {
      ...base,
      points: primary.data,
      primary,
      unit: hashUnit,
      observations: rows.flatMap((row) =>
        row.events.map((event) => ({
          time: row.time,
          label:
            event === 'decrease'
              ? '해시레이트 감소 교차'
              : event === 'recovery'
                ? '해시레이트 회복 교차'
                : '회복 후 가격 조건 충족',
          direction: event === 'decrease' ? ('down' as const) : ('up' as const),
        })),
      ),
      source: primary.source,
      lines: [
        {
          ...primary,
          id: 'hash60',
          title: '60일 평균',
          color: '#b76d28',
          overlay: true,
          data: rows.map((row) => ({ time: row.time, value: row.hash60 })),
        },
      ],
    };
  }
  if (metric === 'view:relative') {
    const other = asset === 'BTC' ? 'ETH' : 'BTC';
    const data = relativeAnalysis(prices, benchmark ?? []).ratio;
    const primary: AnalysisLine = {
      id: metric,
      title: `${asset} / ${other}`,
      unit: other,
      source,
      data,
      color: '#65d4bc',
      step: 86400,
    };
    return { ...base, points: data, primary, unit: other };
  }
  const data = (series?.data ?? [])
    .filter((p) => Number.isFinite(p.value) && p.time <= now)
    .map((p) => (metric === 'btc:nupl' ? { ...p, value: p.value * 100 } : p));
  const primary: AnalysisLine = {
    id: metric,
    title: definition?.title ?? metric,
    unit: definition?.unit ?? '',
    source: definition?.source ?? '',
    data,
    color: '#65d4bc',
    step: 86400,
    thresholds: definition?.thresholds,
    formula: definition?.formula,
  };
  return {
    ...base,
    points: data,
    primary,
    unit: primary.unit,
    source: primary.source,
    log:
      effectiveAxis(
        defaultAxis(metric),
        data.map((point) => point.value),
      ) === 'log',
  };
}
