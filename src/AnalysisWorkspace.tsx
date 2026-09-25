import { belongsToSection, focusMetric } from '../shared/analysis-sections';
import { workspaceIndicators } from '../shared/workspace-indicators';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  SlidersHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Maximize,
  X,
  ArrowLeftRight,
} from 'lucide-react';
import { ASSETS, METRICS } from '../shared/catalog';
import { networkUnit, type NetworkMetric } from '../shared/network-catalog';
import type {
  Asset,
  CandleResponse,
  Interval,
  Overview,
  Period,
  Point,
  SeriesResponse,
} from '../shared/types';
import {
  priceBasis,
  basisName,
  basisUnit,
  assetLink,
  contiguousCalculation,
  drawdowns,
  relativeStrength,
  monthlyReturns,
} from '../shared/analysis-workspace';
import { closeHistory } from '../shared/price-history';
import { isRangePeriod } from '../shared/ranges';
import { signalLabels, type ObservationSignal } from '../shared/signals';
import { AssetHeader } from './AssetHeader';
import { useData } from './hooks';
import { dateLabel, money, numeric, save, saved, periodStart } from './lib';
import { PeriodPicker } from './PeriodPicker';
import { ChartTools } from './ChartNavigator';
import { AnalysisChart, type AnalysisLine } from './AnalysisChart';
const HistoryPositionPanel = lazy(() =>
  import('./HistoryPositionPanel').then((m) => ({ default: m.HistoryPositionPanel })),
);
import { WorkspaceBar } from './PersonalDesk';
import './analysis-workspace.css';

interface Choice {
  id: string;
  title: string;
  unit: string;
  source: string;
  formula: string;
  url?: string;
  group: string;
  available?: boolean;
  latest?: number;
  spark?: Point[];
}
const COLORS = ['#80b8eb', '#cea5f5', '#dfb873', '#61cfb8', '#e693a9', '#aac572'];
const EMPTY_POINTS: Point[] = [];
const EMPTY_SIGNALS: ObservationSignal[] = [];
function useRemote(id: string | undefined, choices: Choice[]) {
  return useData<SeriesResponse>(choices.find((c) => c.id === id)?.url ?? null, true, 300000);
}

export function AnalysisWorkspace() {
  const positionExport = useRef(null);
  const route = useParams(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  const asset =
    ASSETS.find((a) => a.id === (route.asset || params.get('asset') || 'BTC'))?.id ?? 'BTC';
  const section = location.pathname.startsWith('/onchain')
    ? 'onchain'
    : location.pathname.startsWith('/futures')
      ? 'futures'
      : 'history';
  const focused = section !== 'history';
  const comparePrice = params.get('compare_price') === '1';
  const needsPrice = !focused || comparePrice;
  const basis = priceBasis(params),
    unit = basisUnit(basis);
  const period = (isRangePeriod(params.get('period')) ? params.get('period') : 'all') as Period;
  const log = params.get('log') !== '0';
  const interval = (
    basis === 'reference'
      ? '1d'
      : ['1h', '4h', '1d', '1w', '1M'].includes(params.get('interval') || '')
        ? params.get('interval')
        : '1d'
  ) as Interval;
  const visual = params.get('visual') === 'rainbow' ? 'rainbow' : 'price';
  const [picker, setPicker] = useState(false),
    [query, setQuery] = useState(''),
    [evidence, setEvidence] = useState(params.get('signal') !== null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [rangeRevision, setRangeRevision] = useState(0);
  const panelRef = useRef<HTMLElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    addButton = useRef<HTMLButtonElement>(null);
  function change(patch: Record<string, string | null>) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('asset', route.asset || prev.get('asset') || asset);
      next.set('price_source', basis);
      next.set('period', period);
      next.set('log', log ? '1' : '0');
      for (const [key, value] of Object.entries(patch))
        value === null ? next.delete(key) : next.set(key, value);
      return next;
    });
  }
  useEffect(() => {
    save('lastAsset', asset);
    setSelectedMetric(null);
  }, [asset, section]);
  useEffect(() => {
    if (picker) {
      dialog.current?.showModal();
      dialog.current?.querySelector('input')?.focus();
    } else if (dialog.current?.open) {
      dialog.current.close();
      addButton.current?.focus();
    }
  }, [picker]);
  const raw = useData<SeriesResponse | CandleResponse>(
    !needsPrice
      ? null
      : basis === 'reference'
        ? `/api/v1/reference?asset=${asset}&limit=1000`
        : `/api/v1/candles?asset=${asset}&market=${basis}&interval=${interval}&limit=1000`,
    true,
    basis === 'reference' ? 3600000 : 60000,
  );
  const daily = useData<CandleResponse>(
    !focused && basis !== 'reference' && interval !== '1d'
      ? `/api/v1/candles?asset=${asset}&market=${basis}&interval=1d&limit=1000`
      : null,
    true,
    60000,
  );
  const quote = useData<Overview>(
    !needsPrice || basis === 'reference' ? null : `/api/v1/overview?asset=${asset}&market=${basis}`,
    false,
    60000,
  );
  const catalog = useData<{
    data: (NetworkMetric & { observations: number; currentValue?: number; spark?: Point[] })[];
  }>(`/api/v1/network-catalog?asset=${asset}`);
  const btcCatalog = useData<{
    data: { id: string; observations: number; currentValue: number | null }[];
  }>(asset === 'BTC' ? '/api/v1/metrics?asset=BTC' : null);
  const ref = useData<SeriesResponse>(
    !focused && asset !== 'BTC' ? `/api/v1/reference?asset=${asset}&limit=1000` : null,
    true,
    3600000,
  );
  const benchmark = useData<SeriesResponse>(
    !focused && asset !== 'BTC' ? '/api/v1/reference?asset=BTC&limit=1000' : null,
    true,
    3600000,
  );
  const feed = useData<{ data: ObservationSignal[] }>(
    `/api/v1/signals?asset=${asset}`,
    false,
    60000,
  );
  const series = useMemo(
    () =>
      raw.data
        ? basis === 'reference'
          ? (raw.data as SeriesResponse)
          : closeHistory(raw.data as CandleResponse)
        : null,
    [raw.data, basis],
  );
  const points = useMemo(
    () =>
      basis === 'reference'
        ? (series?.data ?? EMPTY_POINTS)
        : ((raw.data as CandleResponse | undefined)?.data.map((p) => ({
            time: p.time,
            value: p.close,
          })) ?? EMPTY_POINTS),
    [series, raw.data, basis],
  );
  const dailyPoints = useMemo(
    () =>
      basis === 'reference' || interval === '1d'
        ? (series?.data ?? EMPTY_POINTS)
        : daily.data
          ? closeHistory(daily.data).data
          : EMPTY_POINTS,
    [basis, interval, series, daily.data],
  );
  const local = useMemo(
    () => ({
      rsi: contiguousCalculation(dailyPoints, 'rsi', 14),
      drawdown: drawdowns(dailyPoints),
      relative: relativeStrength(ref.data?.data ?? [], benchmark.data?.data ?? []),
      volume:
        basis !== 'reference'
          ? ((daily.data ?? (raw.data as CandleResponse | undefined))?.data
              .filter((p) => 'closed' in p && p.closed)
              .map((p) => ({ time: p.time, value: p.volume })) ?? [])
          : [],
    }),
    [dailyPoints, ref.data, benchmark.data, basis, daily.data, raw.data],
  );
  const choices = useMemo<Choice[]>(
    () => [
      {
        id: 'rsi',
        title: 'RSI 14',
        unit: 'RSI',
        source: basisName(basis),
        formula: '연속 확정 일봉 14일 · Wilder 평활',
        group: '가격·기술',
      },
      {
        id: 'drawdown',
        title: '고점 대비 낙폭',
        unit: '%',
        source: basisName(basis),
        formula: '당일 종가 / 그날까지 최고 종가 − 1',
        group: '가격·기술',
      },
      ...(asset !== 'BTC'
        ? [
            {
              id: 'relative',
              title: `${asset} / BTC 상대강도`,
              unit: `BTC/${asset}`,
              source: 'Coin Metrics USD 참조',
              formula: '같은 UTC 날짜의 코인 USD 가격 / BTC USD 가격',
              group: '가격·기술',
            },
          ]
        : []),
      ...(basis !== 'reference'
        ? [
            {
              id: 'volume',
              title: '거래량',
              unit: asset,
              source: basisName(basis),
              formula: '선택 거래소 일봉 거래량',
              group: '가격·기술',
            },
          ]
        : []),
      ...(catalog.data?.data ?? []).map((m) => ({
        id: 'net:' + m.id,
        title: m.title,
        unit: networkUnit(asset, m.id),
        source: 'Coin Metrics',
        formula: m.formula,
        group: '온체인',
        available: m.observations === undefined ? undefined : m.observations > 0,
        url: `/api/v1/network?asset=${asset}&metric=${m.id}&limit=1000`,
        latest: m.currentValue,
        spark: m.spark,
      })),
      ...(asset === 'BTC'
        ? METRICS.map((m) => ({
            id: 'btc:' + m.id,
            title: m.title,
            unit: m.unit,
            source: 'Bitview',
            formula: m.formula,
            group: 'BTC 온체인',
            available: btcCatalog.data
              ? !!btcCatalog.data.data.find((c) => c.id === m.id)?.observations
              : undefined,
            latest: btcCatalog.data?.data.find((c) => c.id === m.id)?.currentValue ?? undefined,
            url: `/api/v1/series?asset=BTC&metric=${m.id}&limit=1000`,
          }))
        : []),
      ...[
        {
          id: 'funding',
          title: '확정 펀딩률',
          unit: '%',
          formula: 'Bybit USDT 무기한 선물 · 실제 정산 비율',
        },
        {
          id: 'open_interest_daily',
          title: '미결제약정',
          unit: asset,
          formula: 'Bybit USDT 무기한 선물 · 일별 코인 수량',
        },
        {
          id: 'long_account_ratio_daily',
          title: '롱 계정 비중',
          unit: '%',
          formula: 'Bybit 롱 보유 계정 / 전체 포지션 보유 계정',
        },
      ].map((m) => ({
        ...m,
        id: 'futures:' + m.id,
        source: 'Bybit',
        group: '선물',
        url: `/api/v1/derivatives?asset=${asset}&metric=${m.id}&limit=1000`,
      })),
      ...(asset === 'ETH'
        ? ['tvl', 'stablecoins'].map((id) => ({
            id: 'chain:' + id,
            title: id === 'tvl' ? 'DeFi TVL' : '스테이블코인 공급',
            unit: 'USD',
            source: 'DefiLlama · Ethereum',
            formula:
              id === 'tvl'
                ? 'Ethereum 체인 DeFi 예치 가치. ETH 토큰 시가총액과 다릅니다.'
                : 'Ethereum 체인 스테이블코인별 USD 평가액 합계 · ETH 토큰 시가총액과 별개',
            group: 'ETH 체인',
            url: `/api/v1/chain-context?asset=ETH&metric=${id}`,
          }))
        : []),
    ],
    [asset, basis, catalog.data, btcCatalog.data],
  );
  const defaults =
    section === 'onchain'
      ? ['net:' + (params.get('metric') || 'mvrv'), 'net:active_addresses']
      : section === 'futures'
        ? ['futures:' + (params.get('metric') || 'funding'), 'futures:open_interest_daily']
        : ['rsi', 'drawdown'];
  const selected = (
    params.has('panels') ? params.get('panels')!.split(',').filter(Boolean) : defaults
  )
    .filter((id, i, a) => a.indexOf(id) === i && belongsToSection(id, section))
    .slice(0, 6);
  const a = useRemote(selected[0], choices),
    b = useRemote(selected[1], choices),
    c = useRemote(selected[2], choices),
    d = useRemote(selected[3], choices),
    e = useRemote(selected[4], choices),
    f = useRemote(selected[5], choices);
  const responses = [a, b, c, d, e, f];
  const selectedKey = selected.join(',');
  const indicators = (params.get('indicators') ?? 'sma200').split(',').filter(Boolean);
  const indicatorKey = indicators.join(',');
  const lines = useMemo<AnalysisLine[]>(() => {
    const mapped = selected.flatMap((id, i) => {
      const choice = choices.find((c) => c.id === id);
      if (!choice) return [];
      const result = responses[i];
      const data = id in local ? local[id as keyof typeof local] : (result.data?.data ?? []);
      return [
        {
          ...choice,
          data,
          color: COLORS[i % COLORS.length],
          warning:
            result.error ||
            result.data?.meta.warning ||
            (!data.length ? '아직 표시할 관측이 없습니다.' : undefined),
          step: id === 'futures:funding' ? 8 * 3600 : 86400,
        },
      ];
    });
    const overlays = workspaceIndicators(
      points,
      dailyPoints,
      indicators,
      unit,
      interval === '1h'
        ? 3600
        : interval === '4h'
          ? 14400
          : interval === '1w'
            ? 7 * 86400
            : interval === '1M'
              ? 32 * 86400
              : 86400,
    );
    return [...overlays, ...mapped];
  }, [
    selectedKey,
    choices,
    a.data,
    b.data,
    c.data,
    d.data,
    e.data,
    f.data,
    a.error,
    b.error,
    c.error,
    d.error,
    e.error,
    f.error,
    local,
    indicatorKey,
    dailyPoints,
    points,
    interval,
    unit,
    basis,
  ]);
  const visibleSignals = useMemo(
    () =>
      (feed.data?.data ?? EMPTY_SIGNALS)
        .filter((s) => s.source === basis && s.status !== 'withdrawn')
        .sort((a, b) => a.time - b.time),
    [feed.data, basis],
  );
  const signalId = params.get('signal');
  useEffect(() => {
    if (signalId) setEvidence(true);
  }, [signalId]);
  const chosenSignal = feed.data?.data.find((s) => s.id === params.get('signal'));
  const primaryLine = focused
    ? lines.find((l) => !l.overlay && belongsToSection(l.id, section))
    : undefined;
  const sectionChoices = choices.filter((c) => belongsToSection(c.id, section));
  const priceComparison = useMemo<AnalysisLine[]>(
    () =>
      focused && comparePrice && points.length
        ? [
            {
              id: 'comparison:price',
              title: `${asset} 가격`,
              unit,
              source: series?.meta.source ?? '',
              data: points,
              color: '#65d4bc',
              step:
                interval === '1h'
                  ? 3600
                  : interval === '4h'
                    ? 14400
                    : interval === '1w'
                      ? 7 * 86400
                      : interval === '1M'
                        ? 32 * 86400
                        : 86400,
            },
          ]
        : [],
    [focused, comparePrice, points, asset, unit, series, interval],
  );
  function choosePrimary(id: string) {
    change({ panels: focusMetric(id, selected, section).join(','), signal: null });
    setSelectedMetric(id);
  }
  const chosenLine = focused
    ? selectedMetric === 'signals'
      ? undefined
      : primaryLine
    : lines.find((l) => l.id === selectedMetric);
  const last = points.at(-1),
    current = basis === 'reference' ? last?.value : quote.data?.quote?.price;
  const heatmap = useMemo(() => monthlyReturns(dailyPoints), [dailyPoints]);
  const years = [...new Set(heatmap.map((r) => r.month.slice(0, 4)))].reverse();
  const focus = chosenSignal?.time;
  function showSignal(s: ObservationSignal) {
    const source = ['reference', 'upbit', 'binance'].includes(s.source) ? s.source : basis;
    const panel =
      s.rule === 'mvrv1' ? 'net:mvrv' : s.rule === 'funding0' ? 'futures:funding' : null;
    change({
      signal: s.id,
      price_source: source,
      market: source === 'reference' ? null : source,
      ...(panel
        ? { panels: [panel, ...selected.filter((id) => id !== panel)].slice(0, 6).join(',') }
        : {}),
    });
    setEvidence(true);
  }
  const error = raw.error || quote.error;
  return (
    <div className="analysis-workspace">
      <AssetHeader
        asset={asset}
        current={section}
        subtitle=""
        href={(next) =>
          assetLink(
            section === 'onchain'
              ? '/onchain/' + next
              : section === 'futures'
                ? '/futures/' + next
                : '/',
            next,
            new URLSearchParams({ ...Object.fromEntries(params), asset, price_source: basis }),
          )
        }
        trailing={
          (!focused || comparePrice) && (
            <div className="analysis-pricebar">
              <div>
                <strong>{money(current, unit)}</strong>
                <span>
                  {unit} ·{' '}
                  {basis === 'reference'
                    ? '일별 종가'
                    : quote.data?.meta.stale
                      ? '갱신 지연'
                      : '60초 확인'}
                </span>
              </div>
              <select
                aria-label="가격 기준"
                value={basis}
                onChange={(e) =>
                  change({
                    price_source: e.target.value,
                    market: e.target.value === 'reference' ? null : e.target.value,
                    period: 'all',
                    signal: null,
                  })
                }
              >
                {(['reference', 'upbit', 'binance'] as const).map((value) => (
                  <option key={value} value={value}>
                    {basisName(value)}
                  </option>
                ))}
              </select>
            </div>
          )
        }
      />
      <section ref={panelRef} className="panel integrated-analysis">
        <div className={'analysis-toolbar ' + (focused ? 'metric-toolbar' : '')}>
          {focused && (
            <div className="analysis-focus-heading">
              <label>
                {section === 'onchain' ? '온체인' : '선물'}
                <select
                  aria-label={section === 'onchain' ? '온체인 지표' : '선물 지표'}
                  value={primaryLine?.id ?? ''}
                  onChange={(e) => choosePrimary(e.target.value)}
                >
                  {!primaryLine && <option value="">지표 선택</option>}
                  {sectionChoices.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.available === false}>
                      {c.title} · {c.source}
                      {c.available === false ? ' · 데이터 대기' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button
                aria-pressed={comparePrice}
                onClick={() => change({ compare_price: comparePrice ? null : '1' })}
              >
                가격과 비교
              </button>
            </div>
          )}
          <PeriodPicker
            value={period}
            onChange={(p) => {
              change({ period: p, signal: null });
              setRangeRevision((n) => n + 1);
            }}
          />
          {!focused && (
            <>
              <select
                aria-label="봉 간격"
                value={interval}
                disabled={basis === 'reference'}
                onChange={(e) => change({ interval: e.target.value })}
              >
                {['1h', '4h', '1d', '1w', '1M'].map((v) => (
                  <option key={v} value={v}>
                    {{ '1h': '1시간', '4h': '4시간', '1d': '일봉', '1w': '주봉', '1M': '월봉' }[v]}
                  </option>
                ))}
              </select>
              <select
                aria-label="차트 시각화"
                value={visual}
                onChange={(e) =>
                  change({ visual: e.target.value === 'price' ? null : e.target.value })
                }
              >
                <option value="price">가격·지표</option>
                <option value="rainbow">가격 위치 밴드</option>
              </select>
            </>
          )}
          <button ref={addButton} onClick={() => setPicker(true)}>
            <SlidersHorizontal size={16} />
            {focused ? '지표 찾기' : '지표 추가'}
          </button>
          {!focused && (
            <>
              <button aria-pressed={log} onClick={() => change({ log: log ? '0' : '1' })}>
                로그축
              </button>
              <Link aria-label="코인 성과 비교" to={'/compare?asset=' + asset}>
                <ArrowLeftRight size={16} />
                비교
              </Link>
            </>
          )}
          <button
            aria-label="차트 전체화면"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await panelRef.current?.requestFullscreen();
              } catch {
                setEvidence(true);
              }
            }}
          >
            <Maximize size={17} />
          </button>
          <button
            aria-expanded={evidence}
            aria-controls="analysis-evidence"
            onClick={() => setEvidence((v) => !v)}
          >
            {evidence ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}근거
          </button>
        </div>
        <div className={'analysis-layout ' + (evidence ? 'with-evidence' : '')}>
          <div className="analysis-main">
            {error && (!focused || comparePrice) && (
              <div role="status" className="refresh-notice">
                {points.length ? '갱신 지연 · 마지막 정상 자료를 표시합니다.' : error}
                <button
                  onClick={() => {
                    raw.reload();
                    quote.reload();
                  }}
                >
                  다시 시도
                </button>
              </div>
            )}
            {focused ? (
              primaryLine?.data.length ? (
                <>
                  <AnalysisChart
                    asset={asset}
                    primary={primaryLine}
                    unit={primaryLine.unit}
                    source={primaryLine.source}
                    points={primaryLine.data}
                    lines={priceComparison}
                    period={period}
                    log={false}
                    step={primaryLine.step}
                    signals={EMPTY_SIGNALS}
                    focus={focus}
                    onSignal={showSignal}
                    onAll={() => {
                      change({ period: 'all', signal: null });
                      setRangeRevision((n) => n + 1);
                    }}
                    rangeRevision={rangeRevision}
                  />
                  <div className="source-line">
                    {primaryLine.title} · {primaryLine.unit} · {primaryLine.source}
                  </div>
                  {primaryLine.warning && (
                    <div className="refresh-notice" role="status">
                      {primaryLine.warning}
                    </div>
                  )}
                </>
              ) : (
                <div className="loading" role="status">
                  <strong>{primaryLine?.title ?? '지표 선택'}</strong>
                  <p>
                    {responses[selected.indexOf(primaryLine?.id ?? '')]?.loading
                      ? '지표 이력을 불러오고 있습니다…'
                      : (primaryLine?.warning ?? '위에서 분석할 지표를 선택해 주세요.')}
                  </p>
                  {primaryLine && (
                    <button onClick={() => responses[selected.indexOf(primaryLine.id)]?.reload()}>
                      다시 불러오기
                    </button>
                  )}
                </div>
              )
            ) : visual === 'rainbow' ? (
              <>
                <Suspense
                  fallback={
                    <div className="loading" role="status">
                      가격 위치 밴드를 불러오고 있습니다…
                    </div>
                  }
                >
                  <HistoryPositionPanel
                    key={rangeRevision}
                    fetchReference={false}
                    log={log}
                    period={period}
                    asset={asset}
                    supplied={series ? { ...series, data: dailyPoints } : undefined}
                    currency={unit}
                  />
                </Suspense>
                <details className="analysis-tools">
                  <summary>내보내기 · 공유</summary>
                  <ChartTools
                    chart={positionExport}
                    rows={dailyPoints.filter(
                      (p) => p.time >= periodStart(period, dailyPoints.at(-1)?.time ?? 0),
                    )}
                    label={asset}
                    unit={unit}
                    source={series?.meta.source ?? ''}
                    exportLabel="선택 기간 가격 CSV"
                    onReset={() => change({ period: 'all' })}
                  />
                </details>
              </>
            ) : points.length ? (
              <AnalysisChart
                asset={asset}
                unit={unit}
                source={series!.meta.source}
                points={points}
                candles={basis === 'reference' ? undefined : (raw.data as CandleResponse).data}
                lines={lines}
                period={period}
                log={log}
                step={
                  interval === '1h'
                    ? 3600
                    : interval === '4h'
                      ? 14400
                      : interval === '1w'
                        ? 7 * 86400
                        : interval === '1M'
                          ? 32 * 86400
                          : 86400
                }
                signals={visibleSignals}
                focus={focus}
                onSignal={showSignal}
                onAll={() => change({ period: 'all', signal: null })}
                rangeRevision={rangeRevision}
              />
            ) : (
              <div className="loading" role="status">
                {raw.loading
                  ? '가격 이력을 불러오고 있습니다…'
                  : '이 원천에서 확보한 가격이 없습니다.'}
              </div>
            )}
            {!focused && (
              <>
                <div className="analysis-selected">
                  {lines
                    .filter((l) => !l.overlay)
                    .map((l) => (
                      <div key={l.id}>
                        <button
                          onClick={() => {
                            setSelectedMetric(l.id);
                            setEvidence(true);
                          }}
                        >
                          {l.title} · 근거
                          {!l.data.length && <small>관측 대기</small>}
                        </button>
                        <button
                          aria-label={l.title + ' 제거'}
                          onClick={() =>
                            selected.includes(l.id)
                              ? change({ panels: selected.filter((id) => id !== l.id).join(',') })
                              : change({
                                  indicators: indicators
                                    .filter((id) => !l.id.startsWith(id + ':'))
                                    .join(','),
                                })
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                </div>
                <div className="source-line">
                  {series?.meta.source} · {unit} · {dateLabel(points[0]?.time)}부터{' '}
                  {series?.meta.stale && <span className="amber">갱신 지연</span>}
                </div>
              </>
            )}
          </div>
          {evidence && (
            <aside id="analysis-evidence" className="analysis-evidence">
              <h2>{chosenSignal ? '관찰 근거' : chosenLine?.title || '관찰 신호'}</h2>
              {chosenSignal ? (
                <>
                  <p>{chosenSignal.condition}</p>
                  <dl>
                    <dt>코인·원천</dt>
                    <dd>
                      {chosenSignal.asset} · {chosenSignal.source}
                    </dd>
                    <dt>기준 봉</dt>
                    <dd>
                      {dateLabel(chosenSignal.time)} · {chosenSignal.bar}
                    </dd>
                    <dt>이전 → 현재</dt>
                    <dd>
                      {numeric(chosenSignal.previous, 5)} → {numeric(chosenSignal.current, 5)}{' '}
                      {chosenSignal.unit}
                    </dd>
                    <dt>산식 버전</dt>
                    <dd>
                      {chosenSignal.version} · {chosenSignal.status}
                    </dd>
                  </dl>
                  <button onClick={() => change({ signal: null })}>전체 신호</button>
                </>
              ) : chosenLine ? (
                <>
                  <p>{chosenLine.formula}</p>
                  <p>
                    {chosenLine.source} · {chosenLine.unit}
                  </p>
                  {chosenLine.warning && <p role="status">{chosenLine.warning}</p>}
                  <button onClick={() => setSelectedMetric('signals')}>신호 보기</button>
                </>
              ) : (
                <>
                  <p className="muted">확정된 관측의 조건 변화</p>
                  {(feed.data?.data ?? []).slice(0, 12).map((s) => (
                    <button className="signal-row" key={s.id} onClick={() => showSignal(s)}>
                      <b>
                        {signalLabels[s.rule]} {s.direction === 'up' ? '↑' : '↓'}
                      </b>
                      <span>
                        {s.source} · {dateLabel(s.time)}
                      </span>
                      {s.revision! > 1 && <small>정정 {s.revision}</small>}
                    </button>
                  ))}
                  {!feed.data?.data.length && (
                    <p>{feed.error ? '신호 조회 지연' : '확인된 새 신호가 없습니다.'}</p>
                  )}
                </>
              )}
            </aside>
          )}
        </div>
      </section>
      {!focused && (
        <details id="monthly-returns" className="panel monthly-returns">
          <summary>월별 수익률 · {unit}</summary>
          <div className="analysis-table">
            <table>
              <caption>{basisName(basis)} · 전월 말 대비 종가 변화</caption>
              <thead>
                <tr>
                  <th>연도</th>
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i}>{i + 1}월</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y}>
                    <th>{y}</th>
                    {Array.from({ length: 12 }, (_, i) => {
                      const r = heatmap.find(
                        (r) => r.month === `${y}-${String(i + 1).padStart(2, '0')}`,
                      );
                      return (
                        <td
                          key={i}
                          className={r?.value == null ? '' : r.value >= 0 ? 'gain' : 'loss'}
                        >
                          {r?.value == null
                            ? '—'
                            : `${r.value >= 0 ? '+' : ''}${r.value.toFixed(1)}%${r.partial ? '*' : ''}`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>* 진행 중인 달 · 누락 날짜가 있는 달은 계산하지 않습니다.</small>
        </details>
      )}
      {section === 'history' && basis !== 'reference' && (
        <details className="analysis-save">
          <summary>드로잉·사용자 지표 설정</summary>
          <Link
            className="desk-button"
            to={
              '/technical/' +
              asset +
              '?' +
              new URLSearchParams({ ...Object.fromEntries(params), asset, market: basis })
            }
          >
            추세선·수평선·사용자 지표 도구 열기
          </Link>
        </details>
      )}
      <details className="analysis-save">
        <summary>작업공간 저장·불러오기</summary>
        <WorkspaceBar
          embedded
          current={{
            asset,
            market: basis === 'upbit' ? 'upbit' : 'binance',
            interval,
            period,
            log,
            indicators,
            view: 'dashboard',
            section: section === 'history' ? 'price' : section,
            signal: signalId ?? undefined,
            cards: [],
            priceSource: basis,
            comparePrice: focused && comparePrice,
            visual,
            panels: selected,
          }}
        />
      </details>
      <dialog
        ref={dialog}
        className="analysis-picker"
        aria-labelledby="indicator-picker-title"
        onCancel={() => setPicker(false)}
        onClose={() => setPicker(false)}
      >
        <div className="picker-heading">
          <h2 id="indicator-picker-title">
            {asset} 지표 {focused ? '선택' : '추가'}
          </h2>
          <button aria-label="지표 선택 닫기" onClick={() => setPicker(false)}>
            <X />
          </button>
        </div>
        <input
          aria-label="지표 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            section === 'onchain'
              ? 'MVRV, 활성 주소, 공급량…'
              : section === 'futures'
                ? '펀딩, 미결제약정, 롱 계정…'
                : 'RSI, 펀딩, 활성 주소…'
          }
        />
        {!query && !focused && (
          <details className="indicator-presets" open>
            <summary>지표 묶음으로 한 번에 바꾸기</summary>
            {[
              {
                title: '장기 추세',
                detail: '50·200일선 · RSI · 낙폭',
                indicators: 'sma:50:d,sma200',
                panels: ['rsi', 'drawdown'],
              },
              {
                title: '온체인 평가',
                detail: 'MVRV · 활성 주소',
                indicators: '',
                panels: ['net:mvrv', 'net:active_addresses'],
              },
              {
                title: '선물 수급',
                detail: '확정 펀딩률 · 미결제약정',
                indicators: '',
                panels: ['futures:funding', 'futures:open_interest_daily'],
              },
              ...(asset !== 'BTC'
                ? [
                    {
                      title: 'BTC와 비교',
                      detail: `${asset}/BTC · RSI`,
                      indicators: 'sma200',
                      panels: ['relative', 'rsi'],
                    },
                  ]
                : []),
            ].map((preset) => {
              const available = preset.panels.every((id) =>
                choices.some((c) => c.id === id && c.available !== false),
              );
              return (
                <button
                  key={preset.title}
                  disabled={!available}
                  onClick={() => {
                    change({
                      indicators: preset.indicators,
                      panels: preset.panels.join(','),
                      visual: null,
                      signal: null,
                      focus: null,
                      metric: null,
                    });
                    setSelectedMetric(null);
                    setPicker(false);
                  }}
                >
                  <b>{preset.title}</b>
                  <span>{preset.detail}</span>
                  {!available && <small>데이터 확보 대기</small>}
                </button>
              );
            })}
          </details>
        )}
        {!focused && (
          <div className="overlay-options">
            {[
              ['sma:50:d', '50일선'],
              ['sma200', '200일선'],
              ['sma200w', '200주선'],
              ['ema:20:bar', 'EMA 20'],
              ['bb', '볼린저 밴드'],
              ['macd', 'MACD'],
            ].map(([id, label]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={indicators.includes(id)}
                  onChange={() =>
                    change({
                      indicators: indicators.includes(id)
                        ? indicators.filter((v) => v !== id).join(',')
                        : [...indicators, id].join(','),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        )}
        <div className="indicator-list">
          {sectionChoices
            .filter((c) => (c.title + c.id + c.group).toLowerCase().includes(query.toLowerCase()))
            .map((choice) => {
              const line = lines.find((l) => l.id === choice.id);
              const preview = line?.data.length
                ? line.data
                : choice.id in local
                  ? local[choice.id as keyof typeof local]
                  : choice.spark;
              const isSelected = focused
                ? primaryLine?.id === choice.id
                : selected.includes(choice.id);
              const disabled =
                choice.available === false ||
                (!focused && !selected.includes(choice.id) && selected.length >= 6);
              return (
                <button
                  key={choice.id}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (focused) choosePrimary(choice.id);
                    else
                      change({
                        panels: selected.includes(choice.id)
                          ? selected.filter((id) => id !== choice.id).join(',')
                          : [...selected, choice.id].join(','),
                      });
                    setPicker(false);
                  }}
                >
                  <span>
                    <b>{choice.title}</b>
                    <small>
                      {choice.group} · {choice.unit} · {choice.source}
                    </small>
                  </span>
                  <span>
                    {preview?.length ? <MiniTrend points={preview} /> : null}
                    {choice.available === false
                      ? '데이터 확보 대기'
                      : numeric(
                          preview?.at(-1)?.value ?? choice.latest,
                          Math.abs(preview?.at(-1)?.value ?? choice.latest ?? 0) < 0.1 ? 6 : 2,
                        )}{' '}
                    {isSelected ? '✓' : focused ? '→' : '＋'}
                  </span>
                </button>
              );
            })}
        </div>
        {!focused && <small>선택한 지표는 최대 6개까지 같은 시간축으로 표시됩니다.</small>}
      </dialog>
    </div>
  );
}

function MiniTrend({ points }: { points: Point[] }) {
  const values = points.slice(-30),
    min = Math.min(...values.map((p) => p.value)),
    max = Math.max(...values.map((p) => p.value));
  const path = values
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${(i / Math.max(1, values.length - 1)) * 64},${22 - ((p.value - min) / (max - min || 1)) * 20}`,
    )
    .join(' ');
  return (
    <svg width="64" height="24" viewBox="0 0 64 24" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
