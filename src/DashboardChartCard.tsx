import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleHelp } from 'lucide-react';
import type { Asset, CandleResponse, Market, Period, Point, SeriesResponse } from '../shared/types';
import type { PriceBasis } from '../shared/analysis-workspace';
import type { DateWindow } from '../shared/date-navigation';
import type { ObservationSignal } from '../shared/signals';
import { indicatorDefinition, supportsReference } from '../shared/indicator-catalog';
import { supportsMarket } from '../shared/asset-registry';
import { basisName, basisUnit } from '../shared/analysis-workspace';
import { indicatorComparisonUrl } from '../shared/indicator-comparison';
import { axisPreference, supportsLogAxis, type AxisPreference } from '../shared/price-axis';
import { AnalysisChart } from './AnalysisChart';
import { useData } from './hooks';
import { useOriginalRainbowReference } from './use-original-rainbow';
import { money, numeric, priceDigits } from './lib';
import {
  dashboardPlot,
  dashboardAxis,
  dashboardPriceUrl,
  dashboardPrices,
  dashboardSeriesUrl,
  type DashboardPlot,
} from './dashboard-data';

const NO_SIGNALS: ObservationSignal[] = [];
const DashboardSeasonality = lazy(() =>
  import('./DashboardSeasonality').then((m) => ({ default: m.DashboardSeasonality })),
);
const NOOP = () => {};
export interface DashboardPriceInput {
  points: Point[];
  loading: boolean;
  error?: string;
  stale?: boolean;
  reload: () => void;
}

export function dashboardCardTitle(asset: Asset, metric: string): string {
  if (metric === 'view:relative') return `${asset === 'BTC' ? 'ETH' : 'BTC'} 대비 상대강도`;
  return indicatorDefinition(metric)?.title ?? metric;
}
export function dashboardValue(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (['USD', 'USDT', 'KRW'].includes(unit)) return money(value, unit);
  return numeric(value, ['BTC', 'ETH'].includes(unit) ? priceDigits(value) : 2);
}

/** The card owns only its lazy input and viewport. Shared daily prices belong to the dashboard. */
export function DashboardChartCard({
  asset,
  metric,
  basis,
  ohlcSource,
  period,
  priceInput,
  initialWindow,
  rangeRevision,
  onRange,
  onNavigate,
  onAll,
  onHelp,
  eager = false,
  height = 440,
  axis,
  onAxis,
  modelVersion,
  onModel,
}: {
  asset: Asset;
  metric: string;
  basis: PriceBasis;
  ohlcSource: Market;
  period: Period;
  priceInput: DashboardPriceInput;
  initialWindow?: DateWindow;
  rangeRevision: number;
  onRange: (metric: string, range: DateWindow) => void;
  onNavigate: () => void;
  onAll: () => void;
  onHelp: (metric: string, trigger: HTMLButtonElement) => void;
  eager?: boolean;
  height?: number;
  axis?: AxisPreference;
  onAxis: (metric: string, axis: AxisPreference) => void;
  modelVersion?: string;
  onModel: (metric: string, version: string) => void;
}) {
  const host = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState(initialWindow);
  useEffect(() => {
    setViewport(initialWindow);
  }, [initialWindow, rangeRevision]);
  const [active, setActive] = useState(eager);
  useEffect(() => {
    if (active || !host.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [active]);
  const title = dashboardCardTitle(asset, metric);
  const isSupertrend = metric === 'view:supertrend';
  const isRelative = metric === 'view:relative';
  const isHashRibbons = metric === 'view:hash_ribbons';
  const isOriginal = metric === 'view:btc_rainbow_original';
  const requiresUsd = isHashRibbons || isOriginal || metric === 'view:btc_rainbow';
  const sharedHashPrice = requiresUsd && basis === 'reference';
  const original = useOriginalRainbowReference(active && isOriginal, modelVersion);
  useEffect(() => {
    if (isOriginal && original.data && !modelVersion) onModel(metric, original.data.modelVersion);
  }, [isOriginal, original.data, modelVersion, metric, onModel]);
  const other = asset === 'BTC' ? 'ETH' : 'BTC';
  const comparable =
    basis === 'reference' ? supportsReference(other) : supportsMarket(other, basis);
  const seriesUrl = dashboardSeriesUrl(asset, metric);
  const series = useData<SeriesResponse>(active ? seriesUrl : null, true);
  const hashPrice = useData<SeriesResponse>(
    active && requiresUsd && !sharedHashPrice ? dashboardPriceUrl('BTC', 'reference') : null,
    true,
    3600000,
  );
  const hashPricePoints = useMemo(
    () => (sharedHashPrice ? priceInput.points : dashboardPrices(hashPrice.data, 'reference')),
    [sharedHashPrice, priceInput.points, hashPrice.data],
  );
  const weekly = useData<CandleResponse>(
    active && isSupertrend
      ? `/api/v1/candles?asset=${asset}&market=${ohlcSource}&interval=1w&limit=1000`
      : null,
    true,
    60000,
  );
  const comparison = useData<SeriesResponse | CandleResponse>(
    active && isRelative && comparable ? dashboardPriceUrl(other, basis) : null,
    true,
    3600000,
  );
  const benchmark = useMemo(
    () => dashboardPrices(comparison.data, basis),
    [comparison.data, basis],
  );
  const plot = useMemo<DashboardPlot>(
    () =>
      active
        ? dashboardPlot({
            asset,
            metric,
            basis: isSupertrend ? ohlcSource : requiresUsd ? 'reference' : basis,
            prices: requiresUsd ? hashPricePoints : priceInput.points,
            originalReference: original.data ?? null,
            series: series.data,
            candles: weekly.data,
            benchmark,
          })
        : {
            points: [],
            lines: [],
            unit: indicatorDefinition(metric)?.unit ?? basisUnit(basis),
            source: basisName(basis),
            log: false,
            step: 86400,
          },
    [
      active,
      asset,
      metric,
      basis,
      isSupertrend,
      ohlcSource,
      priceInput.points,
      requiresUsd,
      hashPricePoints,
      original.data,
      series.data,
      weekly.data,
      benchmark,
    ],
  );
  const needsPrices = [
    'view:price',
    'view:asset_rainbow',
    'view:ribbon',
    'view:bb',
    'view:seasonality',
    'view:relative',
  ].includes(metric);
  const error =
    (seriesUrl ? series.error : undefined) ||
    (isSupertrend ? weekly.error : undefined) ||
    (needsPrices ? priceInput.error : undefined) ||
    (isRelative ? comparison.error : undefined) ||
    (requiresUsd ? (sharedHashPrice ? priceInput.error : hashPrice.error) : undefined) ||
    original.error;
  const loading =
    (seriesUrl ? series.loading : false) ||
    (isSupertrend ? weekly.loading : false) ||
    (needsPrices ? priceInput.loading : false) ||
    (isRelative && comparable ? comparison.loading : false) ||
    (requiresUsd ? (sharedHashPrice ? priceInput.loading : hashPrice.loading) : false) ||
    original.loading;
  const stale =
    error ||
    (seriesUrl ? series.data?.meta.stale : undefined) ||
    (isSupertrend ? weekly.data?.meta.stale : undefined) ||
    (needsPrices && priceInput.stale) ||
    (isRelative && comparison.data?.meta.stale) ||
    (requiresUsd && (sharedHashPrice ? priceInput.stale : hashPrice.data?.meta.stale));
  const requestedAxis = axisPreference(metric, axis);
  const actualAxis = dashboardAxis(plot, requestedAxis);
  const canLog = dashboardAxis(plot, 'log') === 'log';
  const params = new URLSearchParams({
    asset,
    metric,
    price_source: isSupertrend ? ohlcSource : requiresUsd ? 'reference' : basis,
    market: ohlcSource,
    period,
    interval: isSupertrend ? '1w' : '1d',
    log: requestedAxis === 'log' ? '1' : '0',
  });
  if (isOriginal && (modelVersion || original.data))
    params.set('rainbow_model', modelVersion ?? original.data!.modelVersion);
  if (viewport) {
    params.set('chart_from', String(viewport.from));
    params.set('chart_to', String(viewport.to));
  }
  if (isRelative) {
    params.set('benchmark_asset', other);
    params.set('normalization', 'ratio');
  }
  const latest = plot.points.at(-1)?.value;
  const retry = () => {
    if (seriesUrl) series.reload();
    if (isSupertrend) weekly.reload();
    if (needsPrices) priceInput.reload();
    if (isRelative) comparison.reload();
    if (requiresUsd) {
      if (sharedHashPrice) priceInput.reload();
      else hashPrice.reload();
    }
    if (isOriginal) original.reload();
  };
  return (
    <section className="coin-dashboard-card" ref={host} aria-label={title} data-metric={metric}>
      <header className="coin-dashboard-card-heading">
        <div className="coin-dashboard-card-title">
          <h2>{title}</h2>
          <button
            className="coin-dashboard-icon"
            aria-label={title + ' 읽는 법'}
            onClick={(event) => onHelp(metric, event.currentTarget)}
          >
            <CircleHelp size={17} />
          </button>
        </div>
        <div className="coin-dashboard-card-reading">
          <strong>{active ? dashboardValue(latest, plot.unit) : '—'}</strong>
          <span>{plot.unit}</span>
          {plot.seasonality ? <span>올해</span> : null}
          {stale && active && plot.points.length > 0 ? (
            <small className="coin-dashboard-delay">갱신 지연</small>
          ) : null}
        </div>
        <div className="coin-dashboard-card-actions">
          {supportsLogAxis(metric) && (
            <button
              className="coin-dashboard-expand"
              aria-label={title + ' 축'}
              aria-pressed={actualAxis === 'log'}
              disabled={!canLog}
              title={
                !canLog && plot.points.length
                  ? '0 이하 값이 있어 일반 축으로 표시합니다.'
                  : '로그축에서는 같은 상승률이 같은 높이로 보입니다. 100→200과 200→400은 같은 높이입니다.'
              }
              onClick={() => onAxis(metric, actualAxis === 'log' ? 'linear' : 'log')}
            >
              {actualAxis === 'log' ? '로그' : '일반'}
            </button>
          )}
          {indicatorDefinition(metric)?.comparison && (
            <Link
              className="coin-dashboard-compare"
              to={indicatorComparisonUrl(asset, metric, params)}
              onClick={onNavigate}
            >
              같은 지표 비교
            </Link>
          )}
          <Link
            className="coin-dashboard-expand"
            to={`/coins/${asset}?${params}`}
            aria-label={title + ' 크게 보기'}
            onClick={onNavigate}
          >
            <span>크게 보기</span>
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </header>
      {!active ? (
        <div className="coin-dashboard-placeholder" style={{ height }} aria-hidden="true" />
      ) : isRelative && !comparable ? (
        <div className="coin-dashboard-empty">같은 통화로 비교할 가격이 없습니다.</div>
      ) : plot.seasonality ? (
        !plot.seasonality.summary.length && (loading || error) ? (
          <div className="coin-dashboard-empty" role="status">
            {error ? (
              <>
                <span>차트를 불러오지 못했습니다.</span>
                <button onClick={retry}>다시 시도</button>
              </>
            ) : (
              '차트 불러오는 중…'
            )}
          </div>
        ) : (
          <Suspense fallback={<div className="coin-dashboard-placeholder" style={{ height }} />}>
            <DashboardSeasonality result={plot.seasonality} />
          </Suspense>
        )
      ) : plot.points.length ? (
        <>
          <AnalysisChart
            asset={asset}
            unit={plot.unit}
            source={plot.source}
            points={plot.points}
            primary={plot.primary}
            candles={plot.candles}
            lines={plot.lines}
            bands={plot.bands}
            observations={plot.observations}
            period={period}
            log={requestedAxis === 'log'}
            step={plot.step}
            signals={NO_SIGNALS}
            onSignal={NOOP}
            onAll={onAll}
            rangeRevision={rangeRevision}
            initialWindow={initialWindow}
            onVisibleRange={(range) => {
              setViewport((current) =>
                current?.from === range.from && current?.to === range.to ? current : range,
              );
              onRange(metric, range);
            }}
            advancedTools={false}
            publicFocus
            height={height}
            allowPageScroll
          />
          {plot.state ? <p className="coin-dashboard-chart-note">{plot.state}</p> : null}
          {isOriginal && original.error ? (
            <p role="status" className="coin-dashboard-chart-note">
              {original.error} <button onClick={original.reload}>다시 시도</button>
            </p>
          ) : null}
        </>
      ) : (
        <div className="coin-dashboard-empty" role="status">
          {error ? (
            <>
              <span>차트를 불러오지 못했습니다.</span>
              <button onClick={retry}>다시 시도</button>
            </>
          ) : loading ? (
            '차트 불러오는 중…'
          ) : (
            '표시할 값이 없습니다.'
          )}
        </div>
      )}
    </section>
  );
}
