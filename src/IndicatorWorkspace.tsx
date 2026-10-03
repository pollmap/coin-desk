import { ASSET_REFERENCES } from '../shared/asset-references';
import { relativePair } from '../shared/relative-pair';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import {
  defaultIndicator,
  INDICATORS_CATALOG,
  indicatorDefinition,
  indicatorSources,
  indicatorUrl,
  resolveIndicator,
  supportsReference,
  validPriceBasis,
  type IndicatorAvailability,
} from '../shared/indicator-catalog';
import {
  basisName,
  basisUnit,
  contiguousCalculation,
  drawdowns,
  relativeStrength,
  type PriceBasis,
} from '../shared/analysis-workspace';
import { aggregateCloses, powerLaw, rollingVwap, vwapReclaims } from '../shared/advanced-analysis';
import { historyBands, bandPosition } from '../shared/history-bands';
import { btcRainbow, RAINBOW_VERSION } from '../shared/btc-rainbow';
import { workspaceIndicators } from '../shared/workspace-indicators';
import { readDateWindow, type DateWindow } from '../shared/date-navigation';
import { closeHistory } from '../shared/price-history';
import { guideArticle, guideForMetric, guideHref } from '../shared/learning-catalog';
import { annotationKey, type Annotation, type DrawingKind } from '../shared/annotations';
import { detectPatterns, validPatterns, trendFilter } from '../shared/candle-patterns';
import type { Asset, CandleResponse, Interval, Point, SeriesResponse } from '../shared/types';
import { useData } from './hooks';
import { AssetHeader } from './AssetHeader';
import { AnalysisChart, type AnalysisLine } from './AnalysisChart';
import { PeriodPicker } from './PeriodPicker';
import { WorkspaceBar } from './PersonalDesk';
import { readAnnotations } from './ChartDrawings';
import { RibbonControls } from './RibbonControls';
import { PatternPicker, PatternObservations } from './PatternControls';
import { IndicatorNavigation } from './IndicatorNavigation';
import { dateLabel, save, saved, money } from './lib';
import { SpotQuote } from './SpotQuote';
import { IndicatorShortcuts } from './IndicatorShortcuts';
import './analysis-workspace.css';
import './analysis-library.css';
import './indicator-workspace.css';
const AnalysisLab = lazy(() => import('./AnalysisLab').then((m) => ({ default: m.AnalysisLab })));
const IndicatorMethod = lazy(() => import('./IndicatorMethod'));
const RelatedLibrary = lazy(() =>
  import('./ResearchLibrary').then((m) => ({ default: m.RelatedLibrary })),
);
const EMPTY: Point[] = [];
const SIGNALS: never[] = [];
const urlFor = (asset: Asset, id: string): string | null =>
  id.startsWith('net:')
    ? `/api/v1/network?asset=${asset}&metric=${id.slice(4)}&limit=1000`
    : id.startsWith('btc:')
      ? `/api/v1/series?asset=BTC&metric=${id.slice(4)}&limit=1000`
      : id.startsWith('futures:')
        ? `/api/v1/derivatives?asset=${asset}&metric=${id.slice(8)}&limit=1000`
        : id.startsWith('chain:')
          ? `/api/v1/chain-context?asset=ETH&metric=${id.slice(6)}`
          : null;

export function IndicatorWorkspace() {
  const [params, setParams] = useSearchParams(),
    route = useParams(),
    location = useLocation();
  const routeAsset =
    ASSETS.find((a) => a.id === (route.asset || params.get('asset') || 'BTC'))?.id ?? 'BTC';
  const navigate = useNavigate();
  const isRelative =
    params.get('metric') === 'view:relative' ||
    (!params.has('metric') && params.get('visual') === 'relative');
  const pair = relativePair(routeAsset, params);
  const asset = isRelative ? pair.asset : routeAsset;
  const [legacyNotice, setLegacyNotice] = useState(false);
  useEffect(() => {
    if (!isRelative || !pair.migrated) return;
    const next = new URLSearchParams(params);
    next.set('asset', pair.asset);
    next.set('benchmark_asset', pair.benchmark);
    next.delete('correlation_asset');
    setLegacyNotice(true);
    navigate(`/coins/${pair.asset}?${next}`, { replace: true });
  }, [isRelative, pair.migrated, pair.asset, pair.benchmark, navigate, params]);
  const quoteMarket =
    params.get('market') === 'binance' || params.get('price_source') === 'binance'
      ? 'binance'
      : 'upbit';
  useEffect(() => {
    save(
      'recent-coins',
      [asset, ...saved<Asset[]>('recent-coins', []).filter((a) => a !== asset)].slice(0, 8),
    );
  }, [asset]);
  useEffect(() => {
    save('recent-analysis', { href: location.pathname + location.search, asset });
  }, [location.pathname, location.search, asset]);
  const active = resolveIndicator(asset, location.pathname, params),
    d = active.definition,
    id = active.id;
  const rawBasis = params.get('price_source') || params.get('market');
  const basis = validPriceBasis(asset, rawBasis) as PriceBasis,
    unit = basisUnit(basis);
  const invalidBasis =
    (rawBasis === 'reference' && !supportsReference(asset)) ||
    (['view:btc_rainbow', 'view:powerlaw'].includes(id) && basis !== 'reference') ||
    (['volume', 'view:vwap'].includes(id) && basis === 'reference');
  const supported = active.supported && !invalidBasis;
  const period = active.period,
    compare = params.get('compare_price') === '1',
    window = readDateWindow(params);
  const interval = (
    ['1d', '1w', '1M', ...(basis === 'reference' ? [] : ['1h', '4h'])].includes(
      params.get('interval') || '',
    )
      ? params.get('interval')
      : '1d'
  ) as Interval;
  const view = d?.view ?? 'price',
    local = ['rsi', 'drawdown', 'relative', 'volume'].includes(id);
  const auxiliary = [...new Set((params.get('panels') ?? '').split(','))]
    .filter(
      (v) =>
        v !== id &&
        indicatorDefinition(v)?.renderer === 'series' &&
        indicatorDefinition(v)?.assets.includes(asset) &&
        !(v === 'volume' && basis === 'reference'),
    )
    .slice(0, 2);
  const localIds = ['rsi', 'drawdown', 'relative', 'volume'];
  const needsPrice =
    supported &&
    (local || auxiliary.some((v) => localIds.includes(v)) || d?.renderer !== 'series' || compare);
  const lab = d?.renderer === 'lab',
    bands = d?.renderer === 'bands';
  const [more, setMore] = useState(params.has('draw_tool')),
    [picker, setPicker] = useState(false),
    [related, setRelated] = useState(params.get('related') === '1');
  const [readingDate, setReadingDate] = useState<number | null>(null);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const sources = indicatorSources(asset, id);
  const [revision, setRevision] = useState(0),
    [annotations, setAnnotations] = useState<Annotation[]>([]);
  const area = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    pickButton = useRef<HTMLButtonElement>(null),
    visible = useRef<DateWindow | null>(window);
  const drawingKey = annotationKey(
    asset,
    basis,
    local ? '1d' : interval,
    d?.renderer === 'series' ? id : 'price',
  );
  useEffect(() => {
    save('lastAsset', asset);
    setAnnotations(readAnnotations(drawingKey));
  }, [asset, drawingKey]);
  useEffect(() => {
    if (picker) {
      dialog.current?.showModal();
      dialog.current?.querySelector('input')?.focus();
    } else if (dialog.current?.open) {
      dialog.current.close();
      pickButton.current?.focus();
    }
  }, [picker]);
  function change(patch: Record<string, string | null>) {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('asset', asset);
      p.set('metric', id);
      p.set('period', period);
      p.set('price_source', basis);
      if (
        ['compare_price', 'indicators', 'panels', 'metric'].some((k) => k in patch) &&
        visible.current
      ) {
        p.set('chart_from', String(visible.current.from));
        p.set('chart_to', String(visible.current.to));
      }
      if (['period', 'price_source', 'interval'].some((k) => k in patch)) {
        p.delete('chart_from');
        p.delete('chart_to');
      }
      for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
      return p;
    });
  }
  const remote = useData<SeriesResponse>(supported ? urlFor(asset, id) : null, true, 300000);
  const auxiliaryA = useData<SeriesResponse>(
    supported && auxiliary[0] ? urlFor(asset, auxiliary[0]) : null,
    true,
    300000,
  );
  const auxiliaryB = useData<SeriesResponse>(
    supported && auxiliary[1] ? urlFor(asset, auxiliary[1]) : null,
    true,
    300000,
  );
  // Only the selected indicator and an explicitly enabled price comparison request data.
  const raw = useData<SeriesResponse | CandleResponse>(
    needsPrice
      ? basis === 'reference'
        ? `/api/v1/reference?asset=${asset}&limit=1000`
        : `/api/v1/candles?asset=${asset}&market=${basis}&interval=${local || bands || lab || view === 'vwap' ? '1d' : interval}&limit=1000`
      : null,
    true,
    basis === 'reference' ? 3600000 : 60000,
  );
  const extraDaily = useData<CandleResponse>(
    needsPrice &&
      !local &&
      !bands &&
      !lab &&
      view !== 'vwap' &&
      basis !== 'reference' &&
      interval !== '1d'
      ? `/api/v1/candles?asset=${asset}&market=${basis}&interval=1d&limit=1000`
      : null,
    true,
    60000,
  );
  const daily = useMemo(
    () =>
      raw.data
        ? basis === 'reference'
          ? (raw.data as SeriesResponse)
          : closeHistory(extraDaily.data ?? (raw.data as CandleResponse))
        : null,
    [raw.data, extraDaily.data, basis],
  );
  const price = useMemo(
    () =>
      raw.data
        ? basis === 'reference'
          ? aggregateCloses((raw.data as SeriesResponse).data, interval)
          : (raw.data as CandleResponse).data
              .filter((p) => p.closed)
              .map((p) => ({ time: p.time, value: p.close }))
        : EMPTY,
    [raw.data, basis, interval],
  );
  const dailyPoints = daily?.data ?? EMPTY;
  const benchmark = useData<SeriesResponse | CandleResponse>(
    supported && (id === 'relative' || auxiliary.includes('relative'))
      ? basis === 'reference'
        ? '/api/v1/reference?asset=BTC&limit=1000'
        : `/api/v1/candles?asset=BTC&market=${basis}&interval=1d&limit=1000`
      : null,
    true,
    300000,
  );
  const localData = useMemo(
    () =>
      id === 'rsi'
        ? contiguousCalculation(dailyPoints, 'rsi', 14)
        : id === 'drawdown'
          ? drawdowns(dailyPoints)
          : id === 'relative'
            ? relativeStrength(
                dailyPoints,
                benchmark.data
                  ? basis === 'reference'
                    ? (benchmark.data as SeriesResponse).data
                    : closeHistory(benchmark.data as CandleResponse).data
                  : [],
              )
            : id === 'volume'
              ? (((extraDaily.data ?? raw.data) as CandleResponse | undefined)?.data
                  .filter((c) => c.closed)
                  .map((c) => ({ time: c.time, value: c.volume })) ?? EMPTY)
              : EMPTY,
    [id, dailyPoints, benchmark.data, raw.data, extraDaily.data, basis],
  );
  const bandRows = useMemo(
    () =>
      bands
        ? id === 'view:btc_rainbow'
          ? btcRainbow(dailyPoints)
          : historyBands(dailyPoints)
        : [],
    [bands, id, dailyPoints],
  );
  const primaryData = useMemo(
    () =>
      local
        ? localData
        : id === 'btc:nupl'
          ? (remote.data?.data ?? EMPTY).map((p) => ({ ...p, value: p.value * 100 }))
          : (remote.data?.data ?? EMPTY),
    [local, localData, id, remote.data],
  );
  const step =
    id === 'futures:funding'
      ? 28800
      : /futures:(open_interest|long_account_ratio)$/.test(id)
        ? 3600
        : 86400;
  const primary = useMemo<AnalysisLine | undefined>(
    () =>
      d?.renderer === 'series'
        ? {
            id,
            title: d.title,
            unit: d.unit.replace('자산 단위', asset).replace('자산', asset),
            source: local ? basisName(basis) : d.source,
            formula: d.formula,
            color: '#6ea8e7',
            data: primaryData,
            thresholds: d.thresholds,
            step,
          }
        : undefined,
    [d, id, asset, basis, local, primaryData, step],
  );
  const indicators = (
    params.get('indicators') ??
    (view === 'ribbon'
      ? 'sma:7:bar,sma:25:bar,sma:50:bar,sma:100:bar'
      : id === 'view:bb'
        ? 'bb:20:bar:2'
        : '')
  )
    .split(',')
    .filter(Boolean);
  const indicatorKey = indicators.join(',');
  const auxiliaryLines = useMemo<AnalysisLine[]>(
    () =>
      auxiliary.map((metric, i) => {
        const definition = indicatorDefinition(metric)!;
        const response = i ? auxiliaryB : auxiliaryA;
        const points =
          metric === 'rsi'
            ? contiguousCalculation(dailyPoints, 'rsi', 14)
            : metric === 'drawdown'
              ? drawdowns(dailyPoints)
              : metric === 'relative'
                ? relativeStrength(
                    dailyPoints,
                    benchmark.data
                      ? basis === 'reference'
                        ? (benchmark.data as SeriesResponse).data
                        : closeHistory(benchmark.data as CandleResponse).data
                      : [],
                  )
                : metric === 'volume'
                  ? (((extraDaily.data ?? raw.data) as CandleResponse | undefined)?.data
                      ?.filter((c) => c.closed)
                      .map((c) => ({ time: c.time, value: c.volume })) ?? EMPTY)
                  : metric === 'btc:nupl'
                    ? (response.data?.data ?? EMPTY).map((p) => ({ ...p, value: p.value * 100 }))
                    : (response.data?.data ?? EMPTY);
        return {
          id: metric,
          title: definition.title,
          unit: definition.unit.replace('자산 단위', asset).replace('자산', asset),
          source: localIds.includes(metric) ? basisName(basis) : definition.source,
          data: points,
          color: i ? '#d9ad63' : '#b19be6',
          thresholds: definition.thresholds,
          step:
            metric === 'futures:funding'
              ? 28800
              : /futures:(open_interest|long_account_ratio)$/.test(metric)
                ? 3600
                : 86400,
          warning: response.error || (response.data?.meta.stale ? '갱신 지연' : undefined),
        };
      }),
    [
      auxiliary.join(','),
      auxiliaryA.data,
      auxiliaryA.error,
      auxiliaryB.data,
      auxiliaryB.error,
      dailyPoints,
      benchmark.data,
      raw.data,
      extraDaily.data,
      basis,
      asset,
    ],
  );
  const vwap = useMemo(
    () =>
      view === 'vwap' && basis !== 'reference'
        ? rollingVwap((raw.data as CandleResponse | undefined)?.data ?? [])
        : EMPTY,
    [view, basis, raw.data],
  );
  const overlay = useMemo<AnalysisLine[]>(
    () =>
      d?.renderer === 'series'
        ? compare
          ? [
              {
                id: 'comparison:price',
                title: asset + ' 가격',
                unit,
                source: basisName(basis),
                data: price,
                color: '#55bca7',
                step: 86400,
              },
            ]
          : []
        : bands
          ? (bandRows[0]?.bands.map((_, i) => ({
              id: 'band:' + i,
              title: '경계 ' + (i + 1),
              unit,
              source: d?.source ?? '',
              data: bandRows.map((p) => ({ time: p.time, value: p.bands[i] })),
              color: 'rgba(125,145,180,0.35)',
              overlay: true,
              step: 86400,
            })) ?? [])
          : [
              ...workspaceIndicators(
                price,
                dailyPoints,
                indicators,
                unit,
                interval === '1h'
                  ? 3600
                  : interval === '4h'
                    ? 14400
                    : interval === '1w'
                      ? 604800
                      : interval === '1M'
                        ? 2764800
                        : 86400,
                view === 'ribbon',
              ),
              ...(view === 'vwap'
                ? [
                    {
                      id: 'vwap365',
                      title: '365일 HLC3 VWAP',
                      unit,
                      source: basisName(basis),
                      data: vwap,
                      color: '#dda857',
                      overlay: true,
                    },
                  ]
                : view === 'powerlaw'
                  ? [
                      {
                        id: 'powerlaw',
                        title: '고정식 파워로 · 참고',
                        unit,
                        source: 'Dacoinminster 고정식',
                        data: powerLaw(dailyPoints),
                        color: '#dda857',
                        overlay: true,
                      },
                    ]
                  : []),
            ],
    [
      d,
      compare,
      price,
      dailyPoints,
      asset,
      unit,
      basis,
      bands,
      bandRows,
      indicatorKey,
      interval,
      view,
      vwap,
    ],
  );
  const patternIds = validPatterns((params.get('patterns') ?? '').split(',')),
    patternKey = patternIds.join(','),
    trend = trendFilter(params.get('pattern_trend'));
  const chartLines = useMemo(() => [...overlay, ...auxiliaryLines], [overlay, auxiliaryLines]);
  const hits = useMemo(
    () =>
      d?.renderer === 'price' && basis !== 'reference' && patternIds.length
        ? detectPatterns(
            (raw.data as CandleResponse | undefined)?.data ?? [],
            patternIds,
            trend,
            interval,
          )
        : [],
    [d, basis, raw.data, patternKey, trend, interval],
  );
  const reclaims = useMemo(
    () => (view === 'vwap' ? vwapReclaims(dailyPoints, vwap) : []),
    [view, dailyPoints, vwap],
  );
  const markers = useMemo(
    () =>
      [...hits, ...reclaims.map((p) => ({ time: p.time, label: '재돌파 확인' }))].sort(
        (a, b) => a.time - b.time,
      ),
    [hits, reclaims],
  );
  const article = guideForMetric(id) ?? guideArticle(d?.guide ?? '');
  const context = new URLSearchParams(params);
  context.set('asset', asset);
  context.set('price_source', basis);
  context.set('period', period);
  context.set('metric', id);
  const error = remote.error || raw.error || benchmark.error || extraDaily.error;
  const response = d?.renderer === 'series' && !local ? remote : raw;
  const waitingForCollection = response.errorCode === 'NO_DATA';
  const loading =
    !!supported && !error && (response.loading || (id === 'relative' && benchmark.loading));
  const chartPoints =
    d?.renderer === 'series'
      ? primaryData
      : bands
        ? bandRows.map((p) => ({ time: p.time, value: p.price }))
        : price;
  const isStale = !!(
    response.data?.meta.stale || response.data?.meta.sourceStatus === 'backfilling'
  );
  const availability: IndicatorAvailability = !supported
    ? 'unsupported'
    : loading && !chartPoints.length
      ? 'loading'
      : waitingForCollection && !chartPoints.length
        ? 'pending'
        : error && !chartPoints.length
          ? 'error'
          : bands && !bandRows.length && dailyPoints.length
            ? 'insufficient-history'
            : !chartPoints.length
              ? 'pending'
              : isStale || error
                ? 'delayed'
                : chartPoints.length
                  ? 'ready'
                  : 'pending';
  const lastBand =
    readingDate === null ? bandRows.at(-1) : bandRows.find((p) => p.time === readingDate);
  return (
    <div className="indicator-workspace" data-indicator={id} data-availability={availability}>
      <AssetHeader
        compact
        asset={asset}
        current=""
        subtitle=""
        trailing={<SpotQuote asset={asset} market={quoteMarket} />}
        href={(next) => indicatorUrl(next, id, context, true)}
      />

      {legacyNotice && (
        <p role="status" className="indicator-notice">
          이전 링크의 비교 대상에 맞춰 {asset}·{pair.benchmark}를 열었습니다.{' '}
          <button onClick={() => setLegacyNotice(false)}>닫기</button>
        </p>
      )}
      <IndicatorShortcuts asset={asset} selected={id} params={context} />
      <div className="indicator-body">
        <section className="panel indicator-panel" ref={area}>
          <div className="indicator-heading">
            <div>
              <h1>{d?.title ?? '지원하지 않는 지표'}</h1>
              {d?.id.endsWith(':mvrv') && (
                <span className="indicator-meaning">{d.shortMeaning}</span>
              )}
              <span>
                {asset} · {local || d?.renderer !== 'series' ? basisName(basis) : d.source} ·{' '}
                {isRelative
                  ? `${asset} · ${pair.benchmark}`
                  : d?.renderer === 'series'
                    ? primary?.unit
                    : unit}
                {availability === 'delayed' && ' · 갱신 지연'}
              </span>
            </div>
            {sources.length > 1 && (
              <label className="indicator-source">
                원천{' '}
                <select
                  aria-label="지표 원천"
                  value={id}
                  onChange={(e) => change({ metric: e.target.value })}
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.source} · {s.unit.replace('자산 단위', asset)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="indicator-mobile-picker"
              ref={pickButton}
              onClick={() => setPicker(true)}
            >
              지표 변경
            </button>
          </div>
          <div className="indicator-toolbar">
            <PeriodPicker
              value={period}
              onChange={(p) => {
                change({ period: p });
                setRevision((r) => r + 1);
              }}
            />
            <label className="price-toggle">
              <input
                type="checkbox"
                checked={compare}
                disabled={d?.renderer !== 'series'}
                onChange={(e) => change({ compare_price: e.target.checked ? '1' : null })}
              />
              가격 비교
            </label>
            <button onClick={() => area.current?.requestFullscreen?.().catch(() => {})}>
              전체화면
            </button>
            <button aria-expanded={more} onClick={() => setMore(!more)}>
              더보기
            </button>
          </div>
          {params.get('transition') && (
            <p role="status" className="indicator-notice">
              {asset}는 {indicatorDefinition(params.get('transition')!)?.title ?? '이 지표'} 원천이
              없어 {d?.title}로 전환했습니다.
            </p>
          )}
          {!supported ? (
            <div className="indicator-empty" role="status">
              <strong>
                {invalidBasis
                  ? '이 지표와 가격 원천의 조합을 지원하지 않습니다.'
                  : `${asset}의 ${d?.title ?? id} 원천을 확보하지 못했습니다.`}
              </strong>
              <p>확보되지 않은 데이터를 다른 코인의 값으로 대체하지 않습니다.</p>
              <Link
                to={indicatorUrl(asset, active.supported ? id : defaultIndicator(asset), context)}
              >
                지원되는 원천·분석으로 열기
              </Link>
            </div>
          ) : (
            <>
              {lab && dailyPoints.length ? (
                <Suspense fallback={<p role="status">분석 도구를 여는 중…</p>}>
                  <AnalysisLab
                    view={view}
                    asset={asset}
                    basis={basis}
                    points={dailyPoints}
                    params={context}
                    change={change}
                    period={period}
                    initialWindow={window}
                  />
                </Suspense>
              ) : chartPoints.length ? (
                <>
                  <AnalysisChart
                    asset={asset}
                    unit={primary?.unit ?? unit}
                    source={primary?.source ?? daily?.meta.source ?? basisName(basis)}
                    points={chartPoints}
                    primary={primary}
                    lines={chartLines}
                    bands={bands ? bandRows : undefined}
                    period={period}
                    log={d?.renderer === 'series' ? false : params.get('log') !== '0'}
                    step={
                      primary?.step ??
                      (bands
                        ? 86400
                        : interval === '1h'
                          ? 3600
                          : interval === '4h'
                            ? 14400
                            : interval === '1w'
                              ? 604800
                              : interval === '1M'
                                ? 2764800
                                : 86400)
                    }
                    candles={
                      !primary && !bands && basis !== 'reference'
                        ? (raw.data as CandleResponse).data.filter((c) => c.closed)
                        : undefined
                    }
                    signals={SIGNALS}
                    onSignal={() => {}}
                    onAll={() => {
                      change({ period: 'all', chart_from: null, chart_to: null });
                      setRevision((r) => r + 1);
                    }}
                    rangeRevision={revision}
                    initialWindow={window}
                    onVisibleRange={(range) => {
                      visible.current = range;
                    }}
                    onReadingDate={bands ? setReadingDate : undefined}
                    drawingKey={
                      more || annotations.length || params.has('draw_tool') ? drawingKey : undefined
                    }
                    onAnnotations={setAnnotations}
                    observations={markers}
                    focus={hits.find((p) => p.id === params.get('pattern_focus'))?.time}
                    onObservation={(focus) =>
                      change({ pattern_focus: focus, chart_from: null, chart_to: null })
                    }
                    initialTool={
                      ['horizontal', 'trend', 'channel', 'measure'].includes(
                        params.get('draw_tool') ?? '',
                      )
                        ? (params.get('draw_tool') as DrawingKind)
                        : undefined
                    }
                  />
                  {bands && lastBand && (
                    <div className="band-context">
                      <strong>
                        {bandPosition(lastBand.z)} · 위치{' '}
                        {lastBand.z === null ? '계산 불가' : lastBand.z.toFixed(2) + 'σ'}
                      </strong>
                      <span>
                        {id === 'view:btc_rainbow'
                          ? '이전 관측의 로그회귀'
                          : '이전 연속 730일의 가격 분포'}{' '}
                        · 실제 가격은 밴드 밖에서도 표시됩니다.
                      </span>
                      {'a' in lastBand && (
                        <span>
                          회귀 a={lastBand.a.toFixed(6)}, b={lastBand.b.toFixed(6)} ·{' '}
                          {lastBand.observations}개 · {dateLabel(lastBand.first)}–
                          {dateLabel(lastBand.last)} · {RAINBOW_VERSION}
                        </span>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="indicator-empty" role="status">
                  <strong>
                    {loading
                      ? '지표 이력을 불러오고 있습니다…'
                      : availability === 'pending'
                        ? '아직 수집된 관측이 없습니다.'
                        : error
                          ? '이력을 불러오지 못했습니다.'
                          : bands
                            ? '밴드 계산에 필요한 이력이 부족합니다.'
                            : '확보된 관측이 없습니다.'}
                  </strong>
                  {!loading && (
                    <p>
                      {error ||
                        (bands
                          ? `표시일 이전 ${id === 'view:btc_rainbow' ? '유효한' : '연속'} 일별 가격 730개와 표시일 가격이 필요합니다. 현재 ${dailyPoints.length}개${dailyPoints.length ? ` · ${dateLabel(dailyPoints[0].time)}–${dateLabel(dailyPoints.at(-1)!.time)}` : ''}. 결측을 보간하지 않습니다.`
                          : '수집 대기 상태입니다. 다른 코인의 자료를 표시하지 않습니다.')}
                    </p>
                  )}
                  {error && (
                    <button
                      onClick={() => {
                        remote.reload();
                        raw.reload();
                        benchmark.reload();
                      }}
                    >
                      다시 시도
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {availability === 'delayed' && (
            <p className="indicator-notice" role="status">
              갱신 지연 · 마지막 정상 관측을 표시합니다. {error || response.data?.meta.warning}
            </p>
          )}
          <div className="indicator-provenance">
            {response.data?.meta.historyStart && (
              <span>확보 시작 {dateLabel(response.data.meta.historyStart)}</span>
            )}
            <span>
              확정 관측 ·{' '}
              {primary?.step === 3600
                ? '시간별'
                : id === 'futures:funding'
                  ? '정산 시점별'
                  : '일별'}
            </span>
            {response.data?.meta.dataAsOf && (
              <span>원천 기준 {dateLabel(response.data.meta.dataAsOf)}</span>
            )}
            {chartPoints.at(-1) && chartPoints.at(-1)!.time !== response.data?.meta.dataAsOf && (
              <span>차트 최근 관측 {dateLabel(chartPoints.at(-1)!.time)}</span>
            )}
          </div>
          {more && (
            <div className="indicator-more">
              {!lab &&
                [0, 1].map((i) => (
                  <label key={i}>
                    보조 지표 {i + 1}
                    <select
                      aria-label={'보조 지표 ' + (i + 1)}
                      value={auxiliary[i] ?? ''}
                      onChange={(e) => {
                        const next = [...auxiliary];
                        next[i] = e.target.value;
                        change({ panels: [id, ...next.filter(Boolean)].join(',') });
                      }}
                    >
                      <option value="">없음</option>
                      {INDICATORS_CATALOG.filter(
                        (v) =>
                          v.renderer === 'series' &&
                          v.assets.includes(asset) &&
                          v.id !== id &&
                          !auxiliary.filter((_, j) => i !== j).includes(v.id) &&
                          !(v.id === 'volume' && basis === 'reference'),
                      ).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title} · {v.source}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              <label>
                가격 기준
                <select
                  aria-label="가격 기준"
                  value={basis}
                  onChange={(e) =>
                    change({
                      price_source: e.target.value,
                      market: e.target.value === 'reference' ? null : e.target.value,
                    })
                  }
                >
                  {(['reference', 'upbit', 'binance'] as const)
                    .filter((b) => b !== 'reference' || supportsReference(asset))
                    .map((b) => (
                      <option key={b} value={b}>
                        {basisName(b)}
                      </option>
                    ))}
                </select>
              </label>
              {!primary && !bands && (
                <label>
                  봉 간격
                  <select
                    aria-label="봉 간격"
                    value={interval}
                    onChange={(e) => change({ interval: e.target.value })}
                  >
                    {(basis === 'reference'
                      ? ['1d', '1w', '1M']
                      : ['1h', '4h', '1d', '1w', '1M']
                    ).map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </label>
              )}
              {!primary && (
                <button
                  aria-pressed={params.get('log') !== '0'}
                  onClick={() => change({ log: params.get('log') === '0' ? '1' : '0' })}
                >
                  로그 축
                </button>
              )}
              {view === 'ribbon' && (
                <RibbonControls
                  indicators={indicators}
                  onChange={(ids) => change({ indicators: ids.join(',') })}
                />
              )}
              {d?.renderer === 'price' && basis !== 'reference' && (
                <PatternPicker
                  selected={patternIds}
                  onChange={change}
                  trend={trend}
                  asset={asset}
                  basis={basis}
                  params={context}
                />
              )}
              <button aria-expanded={related} onClick={() => setRelated(!related)}>
                관련 자료
              </button>
              <Link to={`/technical/${asset}?${context}`}>고급 기술 설정</Link>
            </div>
          )}
          {patternIds.length > 0 && (
            <PatternObservations
              hits={hits}
              selection={params.get('pattern_focus')}
              onSelect={(focus) => change({ pattern_focus: focus })}
              params={context}
              asset={asset}
              basis={basis}
              loading={loading}
            />
          )}
          <details
            className="indicator-explanation"
            onToggle={(e) => setExplanationOpen(e.currentTarget.open)}
          >
            <summary>읽는 법 · 계산식 · 데이터 범위</summary>
            <div>
              <h2>무엇을 보는가</h2>
              <p>{d?.shortMeaning ?? article?.summary ?? d?.title}</p>
              <h2>기준선을 읽는 법</h2>
              <p>
                {d?.baselineMeaning ??
                  article?.read ??
                  (id === 'view:btc_rainbow'
                    ? '아래·중앙·위 구간은 과거 회귀 대비 위치입니다. 매수·매도 구간을 뜻하지 않습니다.'
                    : '확정된 관측의 추세와 단위를 함께 확인하세요.')}
              </p>
              <h2>공식과 예시</h2>
              {explanationOpen && article ? (
                <Suspense fallback={<p role="status">계산 예시를 불러오는 중…</p>}>
                  <IndicatorMethod article={article} />
                </Suspense>
              ) : (
                <p>{d?.formula}</p>
              )}
              <h2>원천과 한계</h2>
              <p>
                {d?.observationCadence} · {d?.measurementScope}
              </p>
              <p>
                {article?.caution ??
                  '결측은 보간하지 않고 미래 데이터를 사용하지 않습니다. 관측 이력이 짧으면 계산 결과가 없습니다.'}
              </p>
              {article && <Link to={guideHref(article.id, context)}>상세 설명 읽기</Link>}
              <h2>프로젝트·공급 참고</h2>
              <ul>
                {ASSET_REFERENCES[asset].map((link) => (
                  <li key={link.url}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.provider} · {link.purpose} ↗
                    </a>
                  </li>
                ))}
              </ul>
              <p>
                프로젝트 측 원문입니다. 독립적인 위험 평가나 언락 일정의 실시간 확인은 아닙니다.
              </p>
            </div>
          </details>
          {article && (
            <Link
              className="indicator-help"
              to={guideHref(article.id, context)}
              aria-label="현재 분석 설명"
            >
              {d?.title} 상세 설명 ↗
            </Link>
          )}
          <WorkspaceBar
            current={{
              asset,
              market: basis === 'upbit' ? 'upbit' : 'binance',
              interval,
              period,
              indicators,
              log: params.get('log') !== '0',
              view: 'dashboard',
              cards: [],
              metric: id,
              panels: auxiliary,
              normalization: ['index', 'percent', 'ratio'].includes(
                params.get('normalization') ?? '',
              )
                ? (params.get('normalization') as 'index' | 'percent' | 'ratio')
                : undefined,
              comparisonWindows: Object.fromEntries(
                ['a_from', 'a_to', 'b_from', 'b_to'].map((k) => [
                  k,
                  params.get('window_' + k) ?? '',
                ]),
              ),
              analysisOptions: Object.fromEntries(
                [...params].filter(([k]) =>
                  [
                    'patterns',
                    'pattern_trend',
                    'seasonality_method',
                    'seasonality_years',
                    'correlation',
                    'correlation_asset',
                    'benchmark_asset',
                    'comparison_layout',
                  ].includes(k),
                ),
              ),
              priceSource: basis,
              comparePrice: compare,
              ...(window ? { dateWindow: window } : {}),
              annotations,
            }}
            resolveCurrent={(c) => ({
              ...c,
              ...(visible.current ? { dateWindow: visible.current } : {}),
              annotations: readAnnotations(drawingKey),
            })}
          />
          {related && (
            <div className="analysis-evidence">
              <Suspense fallback={<p role="status">관련 자료를 여는 중…</p>}>
                <RelatedLibrary asset={asset} />
              </Suspense>
            </div>
          )}
        </section>
        <aside className="indicator-context">
          <h2>{d?.title} 읽는 법</h2>
          <p>{d?.shortMeaning ?? article?.summary ?? d?.title}</p>
          <h3>기준값</h3>
          <p>{d?.baselineMeaning ?? article?.read ?? '단위와 확정 관측일을 함께 확인하세요.'}</p>
          <h3>계산 기준</h3>
          <p>{d?.formula}</p>
          {article && <Link to={guideHref(article.id, context)}>공식과 예시 자세히 보기</Link>}
          <small>{d?.source}</small>
        </aside>
      </div>
      <dialog
        ref={dialog}
        className="indicator-picker"
        onCancel={() => setPicker(false)}
        aria-label="지표 선택"
      >
        <button onClick={() => setPicker(false)}>닫기</button>
        {picker && <IndicatorNavigation key={asset + id} onNavigate={() => setPicker(false)} />}
      </dialog>
    </div>
  );
}
