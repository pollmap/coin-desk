import { ChevronDown, Bookmark, BookOpen } from 'lucide-react';
import { DeskDialog } from './DeskDialog';
import { relativePair } from '../shared/relative-pair';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import { availableMarket, supportsMarket } from '../shared/asset-registry';
import {
  INDICATORS_CATALOG,
  indicatorDefinition,
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
import { btcRainbow } from '../shared/btc-rainbow';
import {
  assetRainbowDiagnostics,
  assetRainbowContext,
  ASSET_RAINBOW_VERSION,
} from '../shared/asset-rainbow';
import { hashRibbons, hashrateTrend } from '../shared/hash-ribbons';
import { networkUnit } from '../shared/network-catalog';
import {
  indicatorTransitions,
  supertrendTransitions,
  signalMatchesAnalysis,
} from '../shared/indicator-transitions';
import type { ObservationSignal } from '../shared/signals';
import { IndicatorConcept } from './IndicatorConcept';
import { workspaceIndicators } from '../shared/workspace-indicators';
import { readDateWindow, type DateWindow } from '../shared/date-navigation';
import { closeHistory } from '../shared/price-history';
import { guideArticle, guideForMetric, guideHref } from '../shared/learning-catalog';
import { annotationKey, type Annotation, type DrawingKind } from '../shared/annotations';
import { detectPatterns, validPatterns, trendFilter } from '../shared/candle-patterns';
import type { Asset, CandleResponse, Interval, Point, SeriesResponse } from '../shared/types';
import { useData } from './hooks';
import { AssetHeader } from './AssetHeader';
import { AnalysisChart, type AnalysisLine, type ChartObservation } from './AnalysisChart';
import { indicatorComparisonUrl } from '../shared/indicator-comparison';
import { PeriodPicker } from './PeriodPicker';
import { WorkspaceBar } from './PersonalDesk';
import { readAnnotations } from './ChartDrawings';
import { RibbonControls } from './RibbonControls';
import { PatternPicker } from './PatternControls';
import { IndicatorNavigation } from './IndicatorNavigation';
import { save, saved, money } from './lib';
import { SpotQuote } from './SpotQuote';
import {
  eligibleChartPrice,
  supportsLiveChartPrice,
  type LiveChartPrice,
} from '../shared/live-chart-price';
import { IndicatorShortcuts } from './IndicatorShortcuts';
import { RelativeControls } from './RelativeControls';
import { supertrend, supertrendSettings } from '../shared/supertrend';
import { SupertrendControls } from './SupertrendControls';
import './analysis-workspace.css';
import './analysis-library.css';
import './indicator-workspace.css';
const AnalysisLab = lazy(() => import('./AnalysisLab').then((m) => ({ default: m.AnalysisLab })));
const IndicatorMethod = lazy(() => import('./IndicatorMethod'));
const RelatedLibrary = lazy(() =>
  import('./ResearchLibrary').then((m) => ({ default: m.RelatedLibrary })),
);
const EMPTY: Point[] = [];
const EMPTY_SIGNALS: ObservationSignal[] = [];
const urlFor = (asset: Asset, id: string): string | null =>
  ['view:hash_ribbons', 'view:hashrate_trend'].includes(id)
    ? `/api/v1/network?asset=${asset}&metric=hashrate&limit=1000`
    : id.startsWith('net:')
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
  useEffect(() => {
    if (!isRelative || !pair.migrated) return;
    const next = new URLSearchParams(params);
    next.set('asset', pair.asset);
    next.set('benchmark_asset', pair.benchmark);
    next.delete('correlation_asset');
    navigate(`/coins/${pair.asset}?${next}`, { replace: true });
  }, [isRelative, pair.migrated, pair.asset, pair.benchmark, navigate, params]);
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
  const basis = validPriceBasis(
      asset,
      rawBasis ??
        (id === 'view:price'
          ? availableMarket(asset, 'upbit')
          : id === 'view:supertrend'
            ? 'binance'
            : null),
    ) as PriceBasis,
    unit = basisUnit(basis);
  const invalidBasis =
    ((rawBasis === 'upbit' || rawBasis === 'binance') && !supportsMarket(asset, rawBasis)) ||
    (rawBasis === 'reference' && !supportsReference(asset)) ||
    (['view:btc_rainbow', 'view:powerlaw'].includes(id) && basis !== 'reference') ||
    (['volume', 'view:vwap', 'view:supertrend'].includes(id) && basis === 'reference');
  const supported = active.supported && !invalidBasis;
  const period = active.period,
    compare = params.get('compare_price') === '1',
    window = readDateWindow(params);
  const interval = (
    ['1d', '1w', '1M', ...(basis === 'reference' ? [] : ['1h', '4h'])].includes(
      params.get('interval') || '',
    )
      ? params.get('interval')
      : id === 'view:supertrend'
        ? '1w'
        : '1d'
  ) as Interval;
  const view = d?.view ?? 'price',
    local = ['rsi', 'drawdown', 'relative', 'volume'].includes(id);
  const isSupertrend = id === 'view:supertrend';
  const isAssetRainbow = id === 'view:asset_rainbow';
  const isHash = ['view:hash_ribbons', 'view:hashrate_trend'].includes(id);
  const fixedModel = useMemo(() => assetRainbowContext(asset, basis, []), [asset, basis]);
  const invalidModel =
    isAssetRainbow &&
    ((params.has('rainbow_origin') && params.get('rainbow_origin') !== String(fixedModel.origin)) ||
      (params.has('rainbow_anchor') && params.get('rainbow_anchor') !== fixedModel.anchorVersion) ||
      (params.has('rainbow_model') && params.get('rainbow_model') !== ASSET_RAINBOW_VERSION) ||
      (params.has('rainbow_source') && params.get('rainbow_source') !== basis) ||
      (params.has('rainbow_unit') && params.get('rainbow_unit') !== unit));
  const log =
    isSupertrend || id === 'view:price' ? params.get('log') === '1' : params.get('log') !== '0';
  const livePriceEnabled = supportsLiveChartPrice(id, basis);
  const quoteMarket = availableMarket(
    asset,
    (livePriceEnabled ? basis : (params.get('market') ?? params.get('price_source'))) === 'binance'
      ? 'binance'
      : 'upbit',
  );
  const [livePrice, setLivePrice] = useState<LiveChartPrice | null>(null);
  const receiveQuote = useCallback(
    (quote: LiveChartPrice | null) => {
      setLivePrice((previous) => {
        if (
          !quote ||
          !livePriceEnabled ||
          quote.market !== basis ||
          !eligibleChartPrice(quote, asset, unit)
        )
          return null;
        if (
          previous?.asset === quote.asset &&
          previous.market === quote.market &&
          previous.time > quote.time
        )
          return previous;
        if (
          previous?.asset === quote.asset &&
          previous.market === quote.market &&
          previous.time === quote.time &&
          previous.price === quote.price &&
          previous.stale === quote.stale
        )
          return previous;
        return quote;
      });
    },
    [asset, basis, livePriceEnabled, unit],
  );
  const stSettings = supertrendSettings(params);
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
  const [saving, setSaving] = useState(false);
  const knowledgeRequested = params.get('knowledge') === '1';
  useEffect(() => {
    if (!knowledgeRequested) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('knowledge');
        return next;
      },
      { replace: true },
    );
  }, [asset, knowledgeRequested, setParams]);
  const saveButton = useRef<HTMLButtonElement>(null);
  const pinnedDate = useRef<number | null>(null);
  const readingChange = useCallback((time: number | null, pinned = false) => {
    pinnedDate.current = pinned ? time : null;
  }, []);
  const initialReadingDate = /^\d{9,10}$/.test(params.get('reading_date') ?? '')
    ? Number(params.get('reading_date'))
    : undefined;
  const [explanationOpen, setExplanationOpen] = useState(false);
  const explanationButton = useRef<HTMLButtonElement>(null);
  const previousAnalysis = useRef(`${asset}:${id}:${basis}`);
  useEffect(() => {
    const next = `${asset}:${id}:${basis}`;
    if (previousAnalysis.current === next) return;
    const analysisChanged =
      previousAnalysis.current.split(':').slice(0, -1).join(':') !== `${asset}:${id}`;
    previousAnalysis.current = next;
    setPicker(false);
    setSaving(false);
    setExplanationOpen(false);
    if (analysisChanged) setMore(params.has('draw_tool'));
    setRelated(false);
  }, [asset, id, basis, params]);
  function openDialog(kind: 'picker' | 'save' | 'explanation') {
    setPicker(kind === 'picker');
    setSaving(kind === 'save');
    setExplanationOpen(kind === 'explanation');
  }
  const [revision, setRevision] = useState(0),
    [annotations, setAnnotations] = useState<Annotation[]>([]);
  const area = useRef<HTMLDivElement>(null),
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
  function change(patch: Record<string, string | null>) {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('asset', asset);
      p.set('metric', id);
      p.set('period', period);
      p.set('price_source', basis);
      if (
        ['compare_price', 'indicators', 'panels', 'metric', 'reading_date'].some(
          (k) => k in patch,
        ) &&
        visible.current
      ) {
        p.set('chart_from', String(visible.current.from));
        p.set('chart_to', String(visible.current.to));
      }
      if (['period', 'price_source', 'interval'].some((k) => k in patch)) {
        p.delete('chart_from');
        p.delete('chart_to');
        p.delete('reading_date');
      }
      for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
      if ('price_source' in patch)
        for (const k of [
          'rainbow_origin',
          'rainbow_anchor',
          'rainbow_model',
          'rainbow_revision',
          'rainbow_source',
          'rainbow_unit',
        ])
          p.delete(k);
      return p;
    });
  }
  const remote = useData<SeriesResponse>(supported ? urlFor(asset, id) : null, true, 300000);
  const hashPrice = useData<SeriesResponse>(
    supported && id === 'view:hash_ribbons' ? `/api/v1/reference?asset=BTC&limit=1000` : null,
    true,
    3600000,
  );
  const showTransitions =
    (params.has('signal_overlay') ? params.get('signal_overlay') === '1' : isHash) ||
    params.has('signal');
  const legacySignalId = params.get('signal');
  const validSignalId =
    !!legacySignalId &&
    /^[A-Za-z0-9:_.-]{1,400}$/.test(legacySignalId) &&
    legacySignalId.startsWith(asset + ':');
  const signalFeed = useData<{ data: ObservationSignal[] }>(
    supported && showTransitions && (!isHash || validSignalId)
      ? `/api/v1/signals?asset=${asset}&${validSignalId ? new URLSearchParams({ id: legacySignalId! }) : 'limit=200'}`
      : null,
    false,
    300000,
  );
  const selectedSignal = validSignalId
    ? signalFeed.data?.data.find((s) => s.id === legacySignalId && s.asset === asset)
    : undefined;
  const signalCompatible = !!selectedSignal && signalMatchesAnalysis(selectedSignal, id, basis);
  const restoredSignal = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSignal || selectedSignal.status === 'withdrawn') return;
    if (!signalCompatible) return;
    const token = `${asset}:${id}:${selectedSignal.id}`;
    if (restoredSignal.current === token) return;
    restoredSignal.current = token;
    if (params.has('reading_date')) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('reading_date', String(selectedSignal.time));
        return next;
      },
      { replace: true },
    );
  }, [selectedSignal, signalCompatible, asset, id, basis, params, setParams]);
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
    needsPrice && !invalidModel
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
      (!isSupertrend ||
        auxiliary.some((v) => localIds.includes(v)) ||
        /:(d|w)(,|$)/.test(params.get('indicators') ?? '')) &&
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
              .filter((p) => p.closed && p.closeTime <= Date.now() / 1000)
              .map((p) => ({ time: p.time, value: p.close }))
        : EMPTY,
    [raw.data, basis, interval],
  );
  const dailyPoints = daily?.data ?? EMPTY;
  const rainbowModel = useMemo(
    () => (isAssetRainbow ? assetRainbowContext(asset, basis, dailyPoints) : null),
    [isAssetRainbow, asset, basis, dailyPoints],
  );
  const rainbowFit = useMemo(
    () =>
      isAssetRainbow &&
      !invalidModel &&
      rainbowModel?.origin !== null &&
      rainbowModel?.origin !== undefined
        ? assetRainbowDiagnostics(dailyPoints, rainbowModel.origin)
        : null,
    [isAssetRainbow, invalidModel, rainbowModel, dailyPoints],
  );
  useEffect(() => {
    if (
      !rainbowModel ||
      rainbowModel.origin === null ||
      invalidModel ||
      raw.loading ||
      !dailyPoints.length ||
      params.has('rainbow_model')
    )
      return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('rainbow_origin', String(rainbowModel.origin));
        next.set('rainbow_anchor', rainbowModel.anchorVersion);
        next.set('rainbow_model', rainbowModel.modelVersion);
        next.set('rainbow_source', rainbowModel.basis);
        next.set('rainbow_unit', rainbowModel.unit);
        next.set('rainbow_revision', rainbowModel.dataRevision);
        return next;
      },
      { replace: true },
    );
  }, [rainbowModel, invalidModel, raw.loading, dailyPoints.length, params, setParams]);
  const hashRows = useMemo(
    () =>
      isHash
        ? id === 'view:hash_ribbons'
          ? hashRibbons(remote.data?.data ?? EMPTY, hashPrice.data?.data ?? EMPTY)
          : hashrateTrend(remote.data?.data ?? EMPTY)
        : [],
    [isHash, id, remote.data, hashPrice.data],
  );
  const stRows = useMemo(
    () =>
      isSupertrend && basis !== 'reference'
        ? supertrend((raw.data as CandleResponse | undefined)?.data ?? [], interval, stSettings)
        : [],
    [isSupertrend, basis, raw.data, interval, stSettings.period, stSettings.multiplier],
  );
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
          : isAssetRainbow
            ? (rainbowFit?.rows ?? [])
            : historyBands(dailyPoints)
        : [],
    [bands, id, dailyPoints, isAssetRainbow, rainbowFit],
  );
  const primaryData = useMemo(
    () =>
      isHash
        ? hashRows.map((row) => ({ time: row.time, value: row.hash30 }))
        : local
          ? localData
          : id === 'btc:nupl'
            ? (remote.data?.data ?? EMPTY).map((p) => ({ ...p, value: p.value * 100 }))
            : (remote.data?.data ?? EMPTY),
    [local, localData, id, remote.data, isHash, hashRows],
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
            unit:
              isHash || id === 'net:hashrate'
                ? networkUnit(asset, 'hashrate')
                : d.unit.replace('자산 단위', asset).replace('자산', asset),
            source: local ? basisName(basis) : d.source,
            formula: d.formula,
            color: '#6ea8e7',
            data: primaryData,
            thresholds: d.thresholds,
            step,
          }
        : undefined,
    [d, id, asset, basis, local, primaryData, step, isHash],
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
          unit:
            metric === 'net:hashrate'
              ? networkUnit(asset, 'hashrate')
              : definition.unit.replace('자산 단위', asset).replace('자산', asset),
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
        ? [
            ...(isHash
              ? [
                  {
                    id: 'hash60',
                    title: '60일 평균',
                    unit: networkUnit(asset, 'hashrate'),
                    source: 'Coin Metrics',
                    data: hashRows.map((row) => ({ time: row.time, value: row.hash60 })),
                    color: '#bb8844',
                    overlay: true,
                    step: 86400,
                  },
                ]
              : []),
            ...(compare
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
              : []),
          ]
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
              ...(isSupertrend
                ? [
                    {
                      id: 'supertrend',
                      title: `슈퍼트렌드 ${stSettings.period}·${stSettings.multiplier}`,
                      unit,
                      source: basisName(basis),
                      color: '#0f666b',
                      overlay: true,
                      data: stRows.map((p) => ({ time: p.time, value: p.value })),
                      supertrend: { rows: stRows, interval },
                      step:
                        interval === '1w'
                          ? 604800
                          : interval === '1h'
                            ? 3600
                            : interval === '4h'
                              ? 14400
                              : interval === '1M'
                                ? 32 * 86400
                                : 86400,
                    },
                  ]
                : []),
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
      isSupertrend,
      stRows,
      stSettings.period,
      stSettings.multiplier,
      isHash,
      hashRows,
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
  const markers = useMemo<ChartObservation[]>(() => {
    const source = id.startsWith('btc:')
      ? 'bitview'
      : id.startsWith('net:') || isHash
        ? 'coinmetrics'
        : id.startsWith('futures:')
          ? 'bybit'
          : basis;
    const derived = showTransitions
      ? isSupertrend
        ? supertrendTransitions(asset, basis, stRows, interval)
        : isHash
          ? hashRows.flatMap((row) =>
              row.events.map((event) => ({
                id: `${asset}:hash:${event}:${row.time}`,
                time: row.time,
                label:
                  event === 'decrease'
                    ? '해시레이트 감소 교차'
                    : event === 'recovery'
                      ? '해시레이트 회복 교차'
                      : '회복 후 가격 조건 충족',
                direction:
                  event === 'decrease'
                    ? ('down' as const)
                    : event === 'recovery'
                      ? ('up' as const)
                      : ('neutral' as const),
              })),
            )
          : indicatorTransitions(
              asset,
              id,
              source,
              id === 'view:price' || id === 'rsi' ? dailyPoints : primaryData,
              Date.now() / 1000,
            )
      : [];
    const withdrawn = new Set(
      (signalFeed.data?.data ?? []).filter((s) => s.status === 'withdrawn').map((s) => s.id),
    );
    return [
      ...hits,
      ...reclaims.map((p) => ({ time: p.time, label: '재돌파 확인' })),
      ...derived.filter((event) => !withdrawn.has(event.id)),
    ].sort((a, b) => a.time - b.time);
  }, [
    hits,
    reclaims,
    showTransitions,
    isSupertrend,
    isHash,
    id,
    asset,
    basis,
    stRows,
    interval,
    hashRows,
    dailyPoints,
    primaryData,
    signalFeed.data,
  ]);
  const article = guideForMetric(id) ?? guideArticle(d?.guide ?? '');
  const context = new URLSearchParams(params);
  context.set('asset', asset);
  context.set('price_source', basis);
  context.set('period', period);
  context.set('metric', id);
  context.set('interval', interval);
  context.set('log', log ? '1' : '0');
  const error = remote.error || raw.error || benchmark.error || extraDaily.error;
  const response = d?.renderer === 'series' && !local ? remote : raw;
  const waitingForCollection = response.errorCode === 'NO_DATA';
  const loading =
    !!supported && !error && (response.loading || (id === 'relative' && benchmark.loading));
  const chartPoints = d?.renderer === 'series' ? primaryData : bands ? dailyPoints : price;
  const isStale = !!(
    response.data?.meta.stale || response.data?.meta.sourceStatus === 'backfilling'
  );
  const availability: IndicatorAvailability =
    !supported || invalidModel
      ? 'unsupported'
      : loading && !chartPoints.length
        ? 'loading'
        : waitingForCollection && !chartPoints.length
          ? 'pending'
          : error && !chartPoints.length
            ? 'error'
            : (bands && !bandRows.length && dailyPoints.length) ||
                (isSupertrend && !stRows.length && price.length) ||
                (isHash && !hashRows.length && remote.data?.data.length)
              ? 'insufficient-history'
              : !chartPoints.length
                ? 'pending'
                : isStale || error
                  ? 'delayed'
                  : chartPoints.length
                    ? 'ready'
                    : 'pending';
  const lastBand = bandRows.at(-1);
  const lastSupertrend = stRows.at(-1);
  const chartStyle = params.get('chart_style');
  const chartCandles = useMemo(
    () =>
      !primary && !bands && basis !== 'reference' && !(id === 'view:price' && chartStyle === 'line')
        ? (raw.data as CandleResponse | undefined)?.data.filter(
            (c) => c.closed && c.closeTime <= Date.now() / 1000,
          )
        : undefined,
    [primary, bands, basis, id, chartStyle, raw.data],
  );
  return (
    <div className="indicator-workspace" data-indicator={id} data-availability={availability}>
      <AssetHeader
        compact
        asset={asset}
        current=""
        subtitle=""
        trailing={
          id === 'view:price' && basis === 'reference' ? (
            <div className="detail-quote">
              <strong>{money(price.at(-1)?.value, 'USD')}</strong>
              <span>USD 종가</span>
            </div>
          ) : (
            <SpotQuote
              asset={asset}
              market={quoteMarket}
              syncPriceSource={livePriceEnabled}
              onQuote={livePriceEnabled ? receiveQuote : undefined}
            />
          )
        }
        href={(next) => indicatorUrl(next, id, context, true)}
      />

      <IndicatorShortcuts asset={asset} selected={id} params={context} />
      <div className="indicator-body">
        <section className="panel indicator-panel" ref={area}>
          <div className="indicator-heading">
            <div>
              <h1>
                <button
                  className="indicator-title-button"
                  aria-label={(d?.title ?? '지원하지 않는 지표') + ' 지표 변경'}
                  ref={pickButton}
                  aria-haspopup="dialog"
                  aria-expanded={picker}
                  onClick={() => openDialog('picker')}
                >
                  <span className="indicator-title-full">{d?.title ?? '지원하지 않는 지표'}</span>
                  <span className="indicator-title-short">
                    {id === 'view:price'
                      ? '가격'
                      : isAssetRainbow
                        ? '레인보우'
                        : id === 'view:hash_ribbons'
                          ? '해시 리본'
                          : id === 'view:hashrate_trend'
                            ? '해시레이트'
                            : (d?.title ?? '지표')}
                  </span>
                  <ChevronDown size={18} aria-hidden="true" />
                </button>
              </h1>
            </div>
            <div className="indicator-heading-actions">
              {id === 'view:price' && basis !== 'reference' && (
                <select
                  className="price-style-control"
                  aria-label="가격 차트 표시"
                  value={params.get('chart_style') === 'line' ? 'line' : 'candles'}
                  onChange={(e) => change({ chart_style: e.target.value })}
                >
                  <option value="candles">캔들</option>
                  <option value="line">종가선</option>
                </select>
              )}
              {d?.comparison && (
                <Link
                  className="indicator-compare"
                  aria-label={`같은 지표 비교 · ${asset === 'BTC' ? 'ETH' : 'BTC'} 비교`}
                  to={indicatorComparisonUrl(asset, id, context)}
                >
                  {asset === 'BTC' ? 'ETH 비교' : 'BTC 비교'}
                </Link>
              )}
              {id === 'view:price' && basis !== 'reference' && (
                <Link
                  className="indicator-compare"
                  aria-label={`가격 성과 비교 · ${asset === 'BTC' ? 'ETH' : 'BTC'} 비교`}
                  to={
                    '/compare?' +
                    new URLSearchParams({
                      mode: 'performance',
                      assets: `${asset},${asset === 'BTC' ? 'ETH' : 'BTC'}`,
                      market: basis,
                      period,
                    })
                  }
                >
                  {asset === 'BTC' ? 'ETH 비교' : 'BTC 비교'}
                </Link>
              )}
              {!d?.comparison && id !== 'view:price' && !isRelative && (
                <Link
                  className="indicator-compare"
                  aria-label={`상대강도 비교 · ${asset === 'BTC' ? 'ETH' : 'BTC'} 비교`}
                  to={`/coins/${asset}?${new URLSearchParams({ asset, metric: 'view:relative', benchmark_asset: asset === 'BTC' ? 'ETH' : 'BTC', price_source: basis, period, normalization: 'index' })}`}
                >
                  {asset === 'BTC' ? 'ETH 비교' : 'BTC 비교'}
                </Link>
              )}
              <button
                className="indicator-save"
                aria-label="분석 저장"
                ref={saveButton}
                aria-haspopup="dialog"
                onClick={() => openDialog('save')}
              >
                <Bookmark size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="indicator-toolbar">
            <PeriodPicker
              value={period}
              onChange={(p) => {
                change({ period: p });
                setRevision((r) => r + 1);
              }}
            />
            {isRelative && <RelativeControls asset={asset} params={context} change={change} />}
            <button
              aria-expanded={more}
              aria-controls="indicator-more"
              onClick={() => setMore(!more)}
            >
              더보기
            </button>
          </div>
          {more && (
            <div className="indicator-more" id="indicator-more">
              {[
                'view:price',
                'view:supertrend',
                'rsi',
                'futures:funding',
                'net:mvrv',
                'btc:mvrv',
                'view:hash_ribbons',
                'view:hashrate_trend',
              ].includes(id) && (
                <button
                  aria-pressed={showTransitions}
                  onClick={() =>
                    change({ signal_overlay: showTransitions ? '0' : '1', signal: null })
                  }
                >
                  전환 표시
                </button>
              )}
              <label className="price-toggle">
                <input
                  type="checkbox"
                  aria-label="가격 비교 추가"
                  checked={compare}
                  disabled={d?.renderer !== 'series'}
                  onChange={(e) => change({ compare_price: e.target.checked ? '1' : null })}
                />
                가격 비교
              </label>
              <button onClick={() => area.current?.requestFullscreen?.().catch(() => {})}>
                전체화면
              </button>
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
                          {v.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              <label>
                거래소·통화
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
                <button aria-pressed={log} onClick={() => change({ log: log ? '0' : '1' })}>
                  로그 축
                </button>
              )}
              {view === 'ribbon' && (
                <RibbonControls
                  indicators={indicators}
                  onChange={(ids) => change({ indicators: ids.join(',') })}
                />
              )}
              {isSupertrend && (
                <SupertrendControls
                  key={`${asset}:${stSettings.period}:${stSettings.multiplier}`}
                  settings={stSettings}
                  onChange={change}
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
            </div>
          )}
          {!supported || invalidModel ? (
            <div className="indicator-empty" role="status">
              <strong>
                {invalidModel
                  ? '저장한 분석 설정을 적용할 수 없습니다.'
                  : invalidBasis
                    ? '이 가격 기준에서는 사용할 수 없는 지표입니다.'
                    : `${asset}에서는 이 지표를 사용할 수 없습니다.`}
              </strong>
              {!invalidModel && (
                <Link to={indicatorUrl(asset, active.supported ? id : 'view:price', context)}>
                  사용 가능한 분석 열기
                </Link>
              )}
              {invalidModel && (
                <button
                  onClick={() =>
                    change({
                      rainbow_origin: null,
                      rainbow_anchor: null,
                      rainbow_model: null,
                      rainbow_revision: null,
                      rainbow_source: null,
                      rainbow_unit: null,
                    })
                  }
                >
                  현재 모델로 열기
                </button>
              )}
            </div>
          ) : (
            <>
              {lab && dailyPoints.length ? (
                <Suspense fallback={<p role="status">분석 도구를 여는 중…</p>}>
                  <AnalysisLab
                    controlsInToolbar={isRelative}
                    onVisibleRange={(range) => {
                      visible.current = range;
                    }}
                    onReadingDate={readingChange}
                    onDateSelect={(time, range) =>
                      change({
                        reading_date: time === null ? null : String(time),
                        signal: null,
                        pattern_focus: null,
                        ...(range
                          ? { chart_from: String(range.from), chart_to: String(range.to) }
                          : {}),
                      })
                    }
                    initialReadingDate={initialReadingDate}
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
                    log={d?.renderer === 'series' ? false : log}
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
                    candles={chartCandles}
                    signals={EMPTY_SIGNALS}
                    summaryLabel={
                      isHash
                        ? '최근 확정 30일 평균'
                        : id === 'view:price'
                          ? '최근 확정 종가'
                          : undefined
                    }
                    livePrice={livePriceEnabled && livePrice?.market === basis ? livePrice : null}
                    onSignal={() => {}}
                    publicFocus
                    advancedTools={false}
                    onAll={() => {
                      change({
                        period: 'all',
                        chart_from: null,
                        chart_to: null,
                        reading_date: null,
                        signal: null,
                        pattern_focus: null,
                      });
                      setRevision((r) => r + 1);
                    }}
                    rangeRevision={revision}
                    initialWindow={window}
                    onVisibleRange={(range) => {
                      visible.current = range;
                    }}
                    onReadingDate={readingChange}
                    onDateSelect={(time, range) =>
                      change({
                        reading_date: time === null ? null : String(time),
                        signal: null,
                        pattern_focus: null,
                        ...(range
                          ? { chart_from: String(range.from), chart_to: String(range.to) }
                          : {}),
                      })
                    }
                    initialReadingDate={initialReadingDate}
                    drawingKey={
                      more || annotations.length || params.has('draw_tool') ? drawingKey : undefined
                    }
                    onAnnotations={setAnnotations}
                    observations={markers}
                    focus={
                      markers.find((p) => 'id' in p && p.id === params.get('pattern_focus'))?.time
                    }
                    onObservation={(focus) => {
                      const event = markers.find((marker) => marker.id === focus);
                      change({
                        pattern_focus: focus,
                        reading_date: event ? String(event.time) : null,
                        ...(hits.some((hit) => hit.id === focus)
                          ? { chart_from: null, chart_to: null }
                          : {}),
                      });
                    }}
                    initialTool={
                      ['horizontal', 'trend', 'channel', 'measure'].includes(
                        params.get('draw_tool') ?? '',
                      )
                        ? (params.get('draw_tool') as DrawingKind)
                        : undefined
                    }
                  />
                  {isSupertrend && (
                    <p
                      className="supertrend-context"
                      role="status"
                      data-direction={lastSupertrend?.direction ?? 'pending'}
                    >
                      {lastSupertrend
                        ? lastSupertrend.direction === 'up'
                          ? '상승 추세'
                          : '하락 추세'
                        : '아직 추세를 표시할 수 없습니다.'}
                      {!lastSupertrend && interval === '1w' && (
                        <>
                          {' '}
                          <button onClick={() => change({ interval: '1d' })}>일봉으로 보기</button>
                        </>
                      )}
                    </p>
                  )}
                  {bands && lastBand && (
                    <div className="band-context">
                      <strong>{bandPosition(lastBand.z)}</strong>
                    </div>
                  )}
                  {bands && !lastBand && !loading && (
                    <p className="band-context" role="status">
                      아직 밴드를 표시할 수 없습니다.
                    </p>
                  )}
                  {isHash &&
                    id === 'view:hash_ribbons' &&
                    (hashPrice.error || !hashPrice.data?.data.length) && (
                      <p className="indicator-notice" role="status">
                        {hashPrice.loading
                          ? '가격 조건을 확인하는 중입니다.'
                          : '가격 조건을 표시할 수 없습니다.'}
                      </p>
                    )}
                </>
              ) : (
                <div className="indicator-empty" role="status">
                  <p role={availability === 'error' ? 'alert' : 'status'}>
                    {loading
                      ? '차트를 불러오는 중…'
                      : availability === 'error'
                        ? '차트를 불러오지 못했습니다.'
                        : '아직 이 지표를 표시할 수 없습니다.'}
                  </p>
                  {availability === 'error' && (
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
                  {!loading && availability !== 'error' && (
                    <Link to={indicatorUrl(asset, 'view:price', context)}>가격 차트 보기</Link>
                  )}
                </div>
              )}
            </>
          )}
          {availability === 'delayed' && (
            <p className="indicator-notice" role="status">
              값을 확인하는 데 시간이 걸리고 있습니다.
            </p>
          )}
          <div className="indicator-info-actions">
            <button
              className="indicator-reading-button"
              ref={explanationButton}
              aria-label="지표 설명 · 읽는 법"
              aria-haspopup="dialog"
              aria-expanded={explanationOpen}
              onClick={() => openDialog('explanation')}
            >
              <BookOpen size={16} aria-hidden="true" /> 읽는 법{' '}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          <DeskDialog
            open={explanationOpen}
            onOpenChange={setExplanationOpen}
            title="지표 설명"
            returnFocus={explanationButton}
            sheet
            reading
          >
            <div className="indicator-explanation">
              <p>{d?.shortMeaning ?? article?.summary ?? d?.title}</p>
              <IndicatorConcept metric={id} />
              <h2>기준선을 읽는 법</h2>
              <p>
                {d?.baselineMeaning ??
                  article?.read ??
                  (id === 'view:btc_rainbow'
                    ? '아래·중앙·위 구간은 과거 회귀 대비 위치입니다. 매수·매도 구간을 뜻하지 않습니다.'
                    : '확정된 관측의 추세와 단위를 함께 확인하세요.')}
              </p>
              <h2>숫자 예시</h2>
              <Suspense fallback={<p role="status">계산 예시를 불러오는 중…</p>}>
                {explanationOpen && article ? (
                  <IndicatorMethod article={article} part="example" />
                ) : (
                  <p>{d?.formula}</p>
                )}
                <details>
                  <summary>계산식·기호</summary>
                  {explanationOpen && article ? (
                    <IndicatorMethod article={article} part="method" />
                  ) : (
                    <p>{d?.formula}</p>
                  )}
                </details>
                <details>
                  <summary>주의할 점</summary>
                  <p>
                    {article?.caution ??
                      '결측은 보간하지 않고 미래 데이터를 사용하지 않습니다. 관측 이력이 짧으면 계산 결과가 없습니다.'}
                  </p>
                  {article && (
                    <Link aria-label="현재 분석 설명" to={guideHref(article.id, context)}>
                      상세 설명 읽기
                    </Link>
                  )}
                </details>
              </Suspense>
            </div>
          </DeskDialog>
          <DeskDialog
            open={saving}
            onOpenChange={setSaving}
            title="분석 저장"
            returnFocus={saveButton}
          >
            <WorkspaceBar
              embedded
              onOpenWorkspace={() => setSaving(false)}
              current={{
                asset,
                market: quoteMarket,
                interval,
                period,
                indicators,
                log,
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
                      'chart_style',
                      'st_period',
                      'st_multiplier',
                      'signal_overlay',
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
                analysisOptions: {
                  ...c.analysisOptions,
                  ...(rainbowModel && rainbowModel.origin !== null
                    ? {
                        rainbow_origin: String(rainbowModel.origin),
                        rainbow_anchor: rainbowModel.anchorVersion,
                        rainbow_model: rainbowModel.modelVersion,
                        rainbow_revision: rainbowModel.dataRevision,
                        rainbow_source: rainbowModel.basis,
                        rainbow_unit: rainbowModel.unit,
                      }
                    : {}),
                  ...(initialReadingDate !== undefined
                    ? { reading_date: String(initialReadingDate) }
                    : pinnedDate.current !== null
                      ? { reading_date: String(pinnedDate.current) }
                      : {}),
                },
                ...(visible.current ? { dateWindow: visible.current } : {}),
                annotations: readAnnotations(drawingKey),
              })}
            />
          </DeskDialog>
          {related && (
            <div className="analysis-evidence">
              <Suspense fallback={<p role="status">관련 자료를 여는 중…</p>}>
                <RelatedLibrary asset={asset} />
              </Suspense>
            </div>
          )}
        </section>
      </div>
      <DeskDialog
        open={picker}
        onOpenChange={setPicker}
        title="지표 선택"
        returnFocus={pickButton}
        sheet
      >
        {picker && <IndicatorNavigation onNavigate={() => setPicker(false)} />}
      </DeskDialog>
    </div>
  );
}
