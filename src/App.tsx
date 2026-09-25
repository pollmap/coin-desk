import { useMarket } from './useMarket';
import { MarketPicker } from './MarketPicker';
import { DeskNavigation, DeskTopbar } from './DeskNavigation';
import { AssetLogo } from './AssetLogo';
import { AssetSections } from './AssetSections';
import { AssetHeader } from './AssetHeader';
import { PeriodPicker } from './PeriodPicker';
import { MetricInfoTabs } from './MetricInfoTabs';
import { ThresholdMeter } from './ThresholdMeter';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowUpLeft,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Expand,
  ExternalLink,
  Info,
  LayoutDashboard,
  Link2,
  Menu,
  MousePointer2,
  Minus,
  Activity,
  TrendingUp,
  X,
} from 'lucide-react';
import { ASSETS, METRICS } from '../shared/catalog';
import { validIndicators } from '../shared/indicators';
import { WorkspaceBar, CardPicker, usePersonalDesk } from './PersonalDesk';
const ExchangeHistoryPanel = lazy(() =>
  import('./ExchangeHistoryPanel').then((m) => ({ default: m.ExchangeHistoryPanel })),
);
const HistoryPage = lazy(() => import('./HistoryPage').then((m) => ({ default: m.HistoryPage })));
const ResearchPage = lazy(() =>
  import('./ResearchPage').then((m) => ({ default: m.ResearchPage })),
);
const WatchlistPage = lazy(() =>
  import('./WatchlistPage').then((m) => ({ default: m.WatchlistPage })),
);
const ComparePage = lazy(() => import('./ComparePage').then((m) => ({ default: m.ComparePage })));
const MetricsExplorer = lazy(() =>
  import('./MetricsExplorer').then((m) => ({ default: m.MetricsExplorer })),
);
import { chartSettings, validCards } from '../shared/workspace';
import { IndicatorEditor } from './IndicatorEditor';
const DominancePanel = lazy(() =>
  import('./DominancePanel').then((m) => ({ default: m.DominancePanel })),
);
const DominancePage = lazy(() =>
  import('./DominancePanel').then((m) => ({ default: m.DominancePage })),
);
const DataStatusPage = lazy(() =>
  import('./DataStatusPage').then((m) => ({ default: m.DataStatusPage })),
);
const AutomationSummary = lazy(() =>
  import('./DataStatusPage').then((m) => ({ default: m.AutomationSummary })),
);
const LongHistoryPanel = lazy(() =>
  import('./LongHistoryPanel').then((m) => ({ default: m.LongHistoryPanel })),
);
const HistoryPositionPanel = lazy(() =>
  import('./HistoryPositionPanel').then((m) => ({ default: m.HistoryPositionPanel })),
);
const RelativeAnalysisPanel = lazy(() =>
  import('./RelativeAnalysisPanel').then((m) => ({ default: m.RelativeAnalysisPanel })),
);
const MempoolPanel = lazy(() =>
  import('./MempoolPanel').then((m) => ({ default: m.MempoolPanel })),
);
const FuturesPage = lazy(() => import('./FuturesPage').then((m) => ({ default: m.FuturesPage })));
const NetworkPage = lazy(() => import('./NetworkPage').then((m) => ({ default: m.NetworkPage })));
const BrandPage = lazy(() => import('./BrandPage').then((m) => ({ default: m.BrandPage })));
import { MetricGuide } from './MetricGuide';
import { DeferredMount } from './DeferredMount';
import { PERIOD_OPTIONS } from '../shared/ranges';
import './analysis-ux.css';
import './data-status.css';
import './network.css';
import type {
  Asset,
  CandleResponse,
  Interval,
  Market,
  Metric,
  Overview,
  Period,
  SeriesResponse,
} from '../shared/types';
import { useData } from './hooks';
import { dateLabel, metricValue, money, numeric, save, saved, turnover } from './lib';
const PriceChart = lazy(() => import('./PriceChart').then((m) => ({ default: m.PriceChart })));
const MetricChart = lazy(() => import('./MetricChart').then((m) => ({ default: m.MetricChart })));
const periods = PERIOD_OPTIONS;
const intervals: { id: Interval; label: string }[] = [
  { id: '1h', label: '1시간' },
  { id: '4h', label: '4시간' },
  { id: '1d', label: '일' },
  { id: '1w', label: '주' },
  { id: '1M', label: '월' },
];
function Loading({ message = '실제 데이터를 불러오고 있습니다…' }: { message?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-line" />
      {message}
    </div>
  );
}
function ErrorNotice({ message, retry }: { message?: string; retry: () => void }) {
  return message ? (
    <div className="error-notice" role="alert">
      {message}
      <button onClick={retry}>다시 시도</button>
    </div>
  ) : null;
}
function Periods({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return <PeriodPicker value={value} onChange={onChange} />;
}

function usePreferences() {
  const [params, setParams] = useSearchParams();
  const initial = useMemo(() => {
    const previous = chartSettings(saved('preferences', {}));
    return saved('history-default-version', 0) >= 4
      ? previous
      : { ...previous, period: 'all' as Period };
  }, []);
  const { market } = useMarket();
  const int = params.get('interval') || initial.interval;
  const interval = intervals.some((i) => i.id === int) ? (int as Interval) : '1d';
  const p = params.get('period') || 'all';
  const period = periods.some((x) => x.id === p) ? (p as Period) : 'all';
  const raw = params.has('indicators')
    ? (params.get('indicators') || '').split(',')
    : initial.indicators;
  const indicators = useMemo(() => validIndicators(raw), [JSON.stringify(raw)]);
  const log = params.has('log') ? params.get('log') === '1' : initial.log;
  useEffect(() => {
    save('preferences', { market, interval, period, indicators, log });
    save('history-default-version', 4);
  }, [market, interval, period, indicators, log]);
  function change(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('market', market);
        next.set('interval', interval);
        next.set('period', period);
        next.set('indicators', indicators.join(','));
        next.set('log', log ? '1' : '0');
        next.set(key, value);
        if (key === 'view' && value === 'history') next.set('period', 'all');
        return next;
      },
      { replace: true },
    );
  }
  return { market, interval, period, indicators, log, change };
}
function MetricCard({
  metric,
  period,
  onPeriodChange,
}: {
  metric: Metric;
  period: Period;
  onPeriodChange: (p: Period) => void;
}) {
  const { data, error, reload } = useData<SeriesResponse>(
    '/api/v1/series?metric=' + metric.id + '&limit=1000',
    true,
  );
  const latest = data?.data.at(-1);
  const previous = data?.data.at(-2);
  const diff = latest && previous ? latest.value - previous.value : null;
  return (
    <article className="panel metric-card">
      <div className="panel-title">
        <Link to={'/metrics/' + metric.id}>
          <span className="metric-dot" style={{ background: metric.color }} />
          {metric.title}
          <ArrowUpRight size={15} />
        </Link>
        <span className="micro-label">BTC · 1D</span>
      </div>
      <div className="metric-number">
        <strong style={{ color: metric.color }}>{metricValue(latest?.value, metric.unit)}</strong>
        <span className="muted">{latest ? dateLabel(latest.time) : '—'}</span>
        <span className="metric-delta">
          {diff === null
            ? '—'
            : (diff >= 0 ? '+' : '') +
              (metric.unit === 'USD'
                ? money(diff, 'USD')
                : numeric(diff * (metric.unit === '비율' ? 100 : 1), 3) +
                  (metric.unit === '비율' ? '%p' : metric.unit === '배' ? '×' : ' Z'))}
          <small>
            {' '}
            {latest && previous && latest.time - previous.time === 86400
              ? '전일 대비'
              : '이전 관측 대비'}
          </small>
        </span>
      </div>
      <ErrorNotice message={error} retry={reload} />
      {data ? (
        <Suspense fallback={<Loading />}>
          <MetricChart
            series={data}
            metric={metric}
            period={period}
            onPeriodChange={onPeriodChange}
          />
        </Suspense>
      ) : error ? (
        <div className="empty-state">지표를 불러오지 못했습니다.</div>
      ) : (
        <Loading />
      )}
      <div className="card-caption">
        <span>
          {dateLabel(data?.data[0]?.time)}부터 · {data?.data.length.toLocaleString() || '—'}개 일별
          관측
        </span>
        {data?.meta.stale ? <span className="amber">갱신 지연</span> : null}
      </div>
      <MetricGuide id={metric.id} showThresholds={false} />
    </article>
  );
}
function PricePage({ workspace = false }: { workspace?: boolean }) {
  const route = useParams();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const [params] = useSearchParams();
  const asset = (
    route.asset ||
    params.get('asset') ||
    chartSettings({ asset: saved('lastAsset', 'BTC') }).asset
  ).toUpperCase() as Asset;
  useEffect(() => {
    if (routeLocation.hash === '#derivatives' && ['BTC', 'DOGE', 'ETH'].includes(asset))
      navigate('/futures/' + asset, { replace: true });
  }, [asset, routeLocation.hash, navigate]);
  const coin = ASSETS.find((a) => a.id === asset);
  const { market, interval, period, indicators, log, change } = usePreferences();
  const hasLongHistory = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'].includes(asset);
  const historical = !workspace;
  const supportsPosition = ['BTC', 'DOGE', 'ETH'].includes(asset);
  const priceView = supportsPosition && params.get('visual') === 'rainbow' ? 'rainbow' : 'price';
  function changeVisual(value: string) {
    const next = new URLSearchParams(params);
    next.set('visual', value);
    navigate({ pathname: routeLocation.pathname, search: next.toString() });
  }
  const shownPeriod: Period = historical && !params.has('period') ? 'all' : period;
  const { desk, update: updateDesk } = usePersonalDesk();
  const cards = params.has('cards')
    ? validCards((params.get('cards') || '').split(','))
    : desk.cards;
  const [deskError, setDeskError] = useState('');
  const [archivePeriod, setArchivePeriod] = useState<Period>('all');
  useEffect(() => {
    if (coin) save('lastAsset', asset);
  }, [asset, coin]);
  const [tool, setTool] = useState<'cursor' | 'horizontal' | 'trend'>('cursor');
  const [reset, setReset] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const fullscreen = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', escape);
    const fullscreenChanged = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener('fullscreenchange', fullscreenChanged);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
    };
  }, []);
  const quote = useData<Overview>(
    '/api/v1/overview?asset=' + asset + '&market=' + market,
    false,
    60000,
  );
  const candles = useData<CandleResponse>(
    historical
      ? null
      : '/api/v1/candles?asset=' +
          asset +
          '&market=' +
          market +
          '&interval=' +
          interval +
          '&limit=1000',
    true,
  );
  const daily = useData<CandleResponse>(
    historical || interval === '1d'
      ? null
      : '/api/v1/candles?asset=' + asset + '&market=' + market + '&interval=1d&limit=1000',
    true,
  );
  const done = useCallback(() => setTool('cursor'), []);
  useEffect(() => {
    const handler = () => setReset((v) => v + 1);
    window.addEventListener('btc-drawings-reset', handler);
    return () => window.removeEventListener('btc-drawings-reset', handler);
  }, []);
  if (!coin)
    return (
      <div className="empty-state">
        지원하지 않는 자산입니다. <Link to="/">BTC 대시보드</Link>
      </div>
    );
  const q = quote.data?.quote;
  const change24h = q?.change24h ?? null;
  const currency = market === 'upbit' ? 'KRW' : 'USDT';
  const dailyRows = interval === '1d' ? candles.data?.data : daily.data?.data;
  async function share() {
    try {
      const link = new URL(location.href);
      link.search = new URLSearchParams({
        asset,
        market,
        interval,
        period,
        indicators: indicators.join(','),
        log: log ? '1' : '0',
        cards: cards.join(','),
        view: historical ? 'history' : 'exchange',
      }).toString();
      setShareUrl(link.href);
      await navigator.clipboard.writeText(link.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  async function expand() {
    if (expanded) {
      setExpanded(false);
      if (document.fullscreenElement) await document.exitFullscreen();
      return;
    }
    setExpanded(true);
    try {
      if (!document.fullscreenElement) await fullscreen.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // Embedded browsers may reject native fullscreen; the CSS view stays expanded.
    }
  }
  return (
    <>
      <AssetHeader
        asset={asset}
        current={historical ? 'history' : 'chart'}
        subtitle={historical ? '가격 흐름부터 분석까지' : '가격·거래량·기술지표'}
        href={(next) =>
          (workspace ? '/chart/' + next : '/') +
          '?' +
          new URLSearchParams({
            asset: next,
            market,
            interval,
            period: 'all',
            indicators: indicators.join(','),
            log: log ? '1' : '0',
            cards: cards.join(','),
            view: historical ? 'history' : 'exchange',
            visual: priceView,
          })
        }
      />
      {shareUrl ? (
        <div className="share-box">
          <label htmlFor="share-link">
            {copied ? '링크를 복사했습니다.' : '이 주소를 선택해 복사할 수 있습니다.'}
          </label>
          <input
            id="share-link"
            aria-label="공유할 화면 주소"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button onClick={() => setShareUrl('')}>닫기</button>
        </div>
      ) : null}
      <MarketPicker
        market={market}
        label={historical && priceView === 'rainbow' ? '시세 기준' : '가격 기준'}
        onChange={(value) => change('market', value)}
      />
      {
        <section className="quote-strip" aria-label="시장 요약">
          <div className="quote-primary">
            <AssetLogo asset={asset} size={30} />
            <div>
              <div className="quote-symbol">
                {asset}
                <span>{currency}</span>
              </div>
              <strong>{money(q?.price, currency)}</strong>
            </div>
            <span
              title={
                q?.changeBasis === 'rolling24h-minute'
                  ? '24시간 변동 · 전일 같은 시각의 1분봉 근사'
                  : '최근 24시간 변동'
              }
              className={
                'change ' + (change24h === null ? 'muted' : change24h >= 0 ? 'up' : 'down')
              }
            >
              {change24h !== null ? (change24h >= 0 ? '+' : '') + numeric(change24h) + '%' : '—'}
              {q?.changeUnavailableReason ? (
                <small>24H 계산 불가</small>
              ) : q?.changeBasis === 'rolling24h-minute' ? (
                <small>24H≈</small>
              ) : null}
              {change24h !== null ? (
                change24h >= 0 ? (
                  <ArrowUpRight size={15} />
                ) : (
                  <ArrowDownRight size={15} />
                )
              ) : null}
            </span>
          </div>
          <div className="quote-stat">
            <span>24H 거래대금</span>
            <b>{turnover(q?.volume24h, currency)}</b>
          </div>
          <div className="quote-stat">
            <span>
              고가 / 저가{' '}
              <small>
                {q?.rangeBasis === 'utc-day' || market === 'upbit' ? 'UTC 당일' : '24H'}
              </small>
            </span>
            <b>{money(q?.high24h, currency)}</b>
            <small>{money(q?.low24h, currency)}</small>
          </div>
          <div className="quote-stat">
            <span>
              RSI <small>일봉 · 14</small>
            </span>
            <b>{numeric(quote.data?.technical.rsi)}</b>
            <small>확정 봉 기준</small>
          </div>
          <div className="quote-stat">
            <span>
              {asset === 'BTC' ? 'MVRV' : '200일 이동평균'}{' '}
              <small>{asset === 'BTC' ? 'BTC' : '확정 종가'}</small>
            </span>
            <b>
              {asset === 'BTC'
                ? metricValue(quote.data?.metrics.mvrv, '배')
                : money(quote.data?.technical.sma200, currency)}
            </b>
            <small>
              {asset === 'BTC' ? dateLabel(quote.data?.metricsAsOf) : currency + ' · 일봉 200개'}
            </small>
          </div>
        </section>
      }
      <ErrorNotice message={quote.error || quote.data?.meta.warning} retry={quote.reload} />
      {historical && supportsPosition && (
        <div className="price-view-switch" role="group" aria-label="가격 시각화 선택">
          <button aria-pressed={priceView === 'price'} onClick={() => changeVisual('price')}>
            거래소 가격
          </button>
          <button aria-pressed={priceView === 'rainbow'} onClick={() => changeVisual('rainbow')}>
            <span className="rainbow-swatch" aria-hidden="true" />
            레인보우 · 낙폭
          </button>
        </div>
      )}
      {historical && priceView === 'rainbow' ? (
        <Suspense fallback={<Loading />}>
          <HistoryPositionPanel key={asset} asset={asset} />
        </Suspense>
      ) : null}
      {historical && priceView === 'price' ? (
        <Suspense fallback={<Loading message="초기 가격부터 전체 흐름을 준비하고 있습니다…" />}>
          <ExchangeHistoryPanel
            market={market}
            asset={asset}
            period={shownPeriod}
            log={log}
            onPeriodChange={(p) => change('period', p)}
            onLogChange={() => change('log', log ? '0' : '1')}
          />
        </Suspense>
      ) : null}
      {historical && hasLongHistory && priceView === 'price' ? (
        <details
          className="panel reference-archive"
          id="reference-history"
          open={params.get('reference') === '1' || routeLocation.hash === '#btc-cycle' || undefined}
        >
          <summary>
            거래소 상장 이전 · {asset} 최초 USD 이력{' '}
            <small>Coin Metrics · 환산하지 않은 별도 참조가격</small>
          </summary>
          <DeferredMount>
            <Suspense fallback={<Loading />}>
              <LongHistoryPanel
                asset={asset}
                period={archivePeriod}
                log={log}
                onPeriodChange={setArchivePeriod}
                onLogChange={() => change('log', log ? '0' : '1')}
              />
            </Suspense>
          </DeferredMount>
        </details>
      ) : null}
      {q?.changeUnavailableReason ? (
        <p className="watch-note" role="status">
          24시간 등락률: {q.changeUnavailableReason} 현재가·거래대금의 기준 시각은 아래에서
          확인하세요.
        </p>
      ) : null}
      {!historical && (
        <details className="quote-timestamp">
          <summary>시세 정보</summary>시세 {dateLabel(q?.time, true)} · 60초마다 조회
        </details>
      )}
      {!historical && (
        <section className={'panel price-panel' + (expanded ? ' expanded' : '')} ref={fullscreen}>
          <div className="price-panel-heading">
            <div>
              <span className="metric-dot orange" />
              <h2>{coin.name} 가격</h2>
              <span className="market-tag">
                {market === 'binance' ? 'BINANCE' : 'UPBIT'} · {currency}
              </span>
            </div>
          </div>
          <div className="chart-toolbar">
            <div className="segments intervals">
              {intervals.map((i) => (
                <button
                  key={i.id}
                  aria-pressed={interval === i.id}
                  className={interval === i.id ? 'selected' : ''}
                  onClick={() => change('interval', i.id)}
                >
                  {i.label}
                </button>
              ))}
            </div>
            <span className="toolbar-divider" />
            <div className="drawing-tools">
              <button
                className={'icon-button ' + (tool === 'cursor' ? 'active' : '')}
                aria-label="차트 이동"
                onClick={() => setTool('cursor')}
              >
                <MousePointer2 size={16} />
              </button>
              <button
                className={'icon-button ' + (tool === 'horizontal' ? 'active' : '')}
                aria-label="수평선 그리기"
                onClick={() => setTool('horizontal')}
              >
                <Minus size={17} />
              </button>
              <button
                className={'icon-button ' + (tool === 'trend' ? 'active' : '')}
                aria-label="추세선 그리기"
                onClick={() => setTool('trend')}
              >
                <TrendingUp size={17} />
              </button>
            </div>
            <div className="toolbar-spacer" />
            <Periods value={period} onChange={(p) => change('period', p)} />
            <button
              className={'axis-control ' + (log ? 'active' : '')}
              aria-pressed={log}
              onClick={() => change('log', log ? '0' : '1')}
            >
              가격축 · {log ? '로그' : '일반'}
            </button>
            <button
              className="icon-button expand"
              aria-label="차트 전체화면"
              aria-pressed={expanded}
              onClick={() => void expand()}
            >
              <Expand size={16} />
            </button>
          </div>
          <IndicatorEditor value={indicators} onChange={(v) => change('indicators', v.join(','))} />
          <ErrorNotice
            message={candles.error || daily.error}
            retry={() => {
              candles.reload();
              daily.reload();
            }}
          />
          {candles.data?.data.length ? (
            <Suspense fallback={<Loading />}>
              <PriceChart
                key={reset}
                candles={candles.data.data}
                daily={dailyRows}
                interval={interval}
                period={period}
                onPeriodChange={(p) => change('period', p)}
                indicators={indicators}
                log={log}
                scope={asset + '.' + market + '.' + interval}
                unit={currency}
                large={workspace || expanded}
                tool={tool}
                onToolDone={done}
              />
            </Suspense>
          ) : candles.loading ? (
            <Loading message="거래소 가격 이력을 불러오고 있습니다…" />
          ) : (
            <div className="empty-state">수집된 가격 이력이 없습니다.</div>
          )}
          <div className="source-line">
            <span>
              출처 {market === 'binance' ? 'Binance' : 'Upbit'} ·{' '}
              {candles.data?.meta.historyStart
                ? dateLabel(candles.data.meta.historyStart) + '부터'
                : ''}
              {candles.data?.meta.gapCount
                ? ' · 원천 데이터 공백 ' + candles.data.meta.gapCount + '곳'
                : ''}
            </span>
            <span className={candles.data?.meta.stale ? 'amber' : ''}>
              {candles.data?.meta.stale ? '수집 지연 · ' : ''}
              {dateLabel(candles.data?.meta.fetchedAt, true)}
            </span>
          </div>
        </section>
      )}
      <details className="workspace-fold">
        <summary>작업공간 저장 · 불러오기</summary>
        <WorkspaceBar
          current={{
            asset,
            market,
            interval,
            period,
            indicators,
            log,
            cards,
            view: workspace ? 'chart' : 'dashboard',
          }}
        />
        <button className="desk-button" onClick={share}>
          {copied ? '복사됨' : '현재 화면 링크 복사'}
        </button>
      </details>
      {asset === 'BTC' && !workspace ? (
        <DeferredMount>
          <Suspense fallback={<Loading message="BTC 네트워크 현황을 준비하고 있습니다…" />}>
            <MempoolPanel />
          </Suspense>
        </DeferredMount>
      ) : null}
      {historical && (asset === 'DOGE' || asset === 'ETH') ? (
        <DeferredMount>
          <Suspense fallback={<Loading message="BTC 대비 상대 분석을 준비하고 있습니다…" />}>
            <RelativeAnalysisPanel asset={asset} />
          </Suspense>
        </DeferredMount>
      ) : null}
      {asset === 'BTC' ? (
        <details className="panel analysis-details btc-extra-metrics">
          <summary>BTC 온체인 카드 · 내 구성</summary>
          <div className="section-heading">
            <div>
              <h2>비트코인 온체인 지표</h2>
              <span>가격 이면의 비트코인 네트워크</span>
            </div>
            <Link to="/metrics/mvrv">
              지표 자세히 보기 <ChevronRight size={15} />
            </Link>
          </div>
          <div className="onchain-note">
            <Info size={14} />
            <span>
              회색 비교선은 Bitview <b>추정 USD 가격</b>입니다. 장기 USD 참조가격·거래소 가격과
              원천이 다릅니다.
            </span>
          </div>
          <CardPicker
            value={cards}
            onChange={(next) => {
              change('cards', next.join(','));
              try {
                updateDesk((d) => ({ ...d, cards: next }));
                setDeskError('');
              } catch (e) {
                setDeskError(String(e instanceof Error ? e.message : e));
              }
            }}
          />
          {deskError ? (
            <p role="alert" className="error-notice">
              {deskError}
            </p>
          ) : null}
          {!cards.length ? (
            <div className="empty-state">
              표시할 온체인 지표를 선택하거나 <Link to="/explore">지표 찾아보기</Link>에서 담아
              보세요.
            </div>
          ) : null}
          <div className="metrics-grid">
            {cards
              .map((id) => METRICS.find((m) => m.id === id)!)
              .filter(Boolean)
              .map((m) => (
                <DeferredMount key={m.id}>
                  <MetricCard
                    metric={m}
                    period={period}
                    onPeriodChange={(p) => change('period', p)}
                  />
                </DeferredMount>
              ))}
          </div>
          <div className="more-metrics">
            {METRICS.filter((m) => !cards.includes(m.id)).map((m) => (
              <Link key={m.id} to={'/metrics/' + m.id}>
                <span className="metric-dot" style={{ background: m.color }} />
                {m.title}
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
function MetricPage() {
  const { metric: id } = useParams();
  const metric = METRICS.find((m) => m.id === id);
  const [params, setParams] = useSearchParams();
  const p = params.get('period') || saved<string>('metric.period.' + id, 'all');
  const period = periods.some((x) => x.id === p) ? (p as Period) : 'all';
  const result = useData<SeriesResponse>(
    metric ? '/api/v1/series?metric=' + metric.id + '&limit=1000' : null,
    true,
  );
  if (!metric)
    return (
      <div className="empty-state">
        지원하지 않는 지표입니다. <Link to="/">대시보드</Link>
      </div>
    );
  const latest = result.data?.data.at(-1);
  return (
    <>
      <AssetHeader
        asset="BTC"
        current="onchain"
        subtitle={'온체인 · ' + metric.title + ' · Bitview 일별 관측'}
        assets={['BTC']}
        href={() => '/metrics/' + metric.id}
      />
      <details className="metric-switcher">
        <summary>지표 변경 · {metric.title}</summary>
        <div className="metric-tabs">
          {METRICS.map((m) => (
            <NavLink key={m.id} to={'/metrics/' + m.id}>
              {m.title}
            </NavLink>
          ))}
        </div>
      </details>
      <section className="panel detail-panel">
        <div className="metric-detail-top">
          <div>
            <strong style={{ color: metric.color }}>
              {metricValue(latest?.value, metric.unit)}
            </strong>
            <span>{dateLabel(latest?.time)} 기준</span>
          </div>
          <Periods
            value={period}
            onChange={(v) => {
              save('metric.period.' + id, v);
              setParams({ period: v }, { replace: true });
            }}
          />
        </div>
        <ThresholdMeter id={metric.id} value={latest?.value} unit={metric.unit} />
        <div className="chart-legend">
          <span>
            <i style={{ background: metric.color }} />
            {metric.title} · 왼쪽 축
          </span>
          <span>
            <i style={{ background: '#8190a8' }} />
            Bitview 추정 USD 가격 · {metric.unit === 'USD' ? '같은 왼쪽 USD 축' : '오른쪽 로그축'}
          </span>
        </div>
        <ErrorNotice message={result.error || result.data?.meta.warning} retry={result.reload} />
        {result.data ? (
          <Suspense fallback={<Loading />}>
            <MetricChart
              series={result.data}
              metric={metric}
              period={period}
              large
              onPeriodChange={(v) => {
                save('metric.period.' + id, v);
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('period', v);
                    return next;
                  },
                  { replace: true },
                );
              }}
            />
          </Suspense>
        ) : result.error ? (
          <div className="empty-state">지표 조회에 실패했습니다. 위의 다시 시도를 눌러 주세요.</div>
        ) : (
          <Loading />
        )}
        <div className="source-line">
          <span>Bitview / Bitcoin Research Kit</span>
          <span className={result.data?.meta.stale ? 'amber' : ''}>
            {result.data?.meta.stale ? '갱신 지연 · ' : ''}
            {dateLabel(result.data?.meta.fetchedAt, true)}
          </span>
        </div>
      </section>
      <MetricInfoTabs key={metric.id} metric={metric} series={result.data} />
      <div className="onchain-note">
        <Info size={15} />
        <span>
          온체인 값은 거래소 가격·집단 정의·정밀도에 따라 다른 사이트와 차이가 날 수 있습니다. 초기
          가격은 Bitview의 과거 자료, 이후 가격은 온체인 추정값을 사용합니다.
        </span>
      </div>
    </>
  );
}
function WorkspacePage() {
  const preferences = chartSettings(saved('preferences', {}));
  const asset = saved<Asset>('lastAsset', 'BTC');
  const { desk } = usePersonalDesk();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MY WORKSPACE</div>
          <h1>내 작업공간</h1>
          <p>저장한 차트 설정을 불러오고 다른 브라우저로 옮겨 보세요.</p>
        </div>
      </div>
      <section className="panel workspace-page">
        <WorkspaceBar
          current={{
            ...preferences,
            asset: ASSETS.some((a) => a.id === asset) ? asset : 'BTC',
            cards: desk.cards,
            view: 'chart',
          }}
        />
        <Link className="desk-button" to={'/chart/' + asset}>
          차트 작업공간 열기 ↗
        </Link>
        <p className="muted">
          설정은 이 브라우저에만 저장됩니다. 공유 링크에는 화면 설정만 포함되며 개인 메모는 전송하지
          않습니다.
        </p>
      </section>
    </>
  );
}
function SourceDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const focus = () => dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    focus();
    return () => trigger?.focus();
  }, []);
  function trap(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = [...dialog.current!.querySelectorAll<HTMLElement>('button,a[href]')];
    const first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        onKeyDown={trap}
        className="source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-title">
          <h2 id="source-title">데이터 연결 상태</h2>
          <button className="icon-button" autoFocus onClick={onClose} aria-label="닫기">
            <X size={19} />
          </button>
        </div>
        <p>원천의 기준 시각과 수집 시각을 구분합니다. 온체인 가격은 추정 USD 가격입니다.</p>
        <Suspense fallback={<Loading />}>
          <AutomationSummary />
        </Suspense>
        <Link className="desk-button" to="/status" onClick={onClose}>
          전체 수집 상태·제공 기간 확인 ↗
        </Link>
        <div className="dialog-links">
          <a href="https://bitview.space" target="_blank" rel="noreferrer">
            Bitview
          </a>
          <a href="https://github.com/binance/binance-public-data" target="_blank" rel="noreferrer">
            Binance
          </a>
          <a href="https://docs.upbit.com/kr" target="_blank" rel="noreferrer">
            Upbit
          </a>
        </div>
      </section>
    </div>
  );
}
export default function App() {
  const location = useLocation();
  const [online, setOnline] = useState(navigator.onLine);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const connectivity = () => setOnline(navigator.onLine);
    const storage = () => setStorageError(true);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    window.addEventListener('coin-desk-storage-error', storage);
    return () => {
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      window.removeEventListener('coin-desk-storage-error', storage);
    };
  }, []);
  const [collapsed, setCollapsed] = useState(() => saved('sidebar-collapsed', false));
  const [sources, setSources] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const resized = () => {
      setNarrow(media.matches);
      if (!media.matches) setMobile(false);
    };
    media.addEventListener('change', resized);
    return () => media.removeEventListener('change', resized);
  }, []);
  useEffect(() => {
    if (!narrow || !mobile) return;
    const sidebar = sidebarRef.current!;
    const focusable = () =>
      [
        ...sidebar.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,summary'),
      ].filter((element) => element.getClientRects().length > 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    sidebar.addEventListener('keydown', trap);
    return () => {
      sidebar.removeEventListener('keydown', trap);
      document.body.style.overflow = previousOverflow;
      menuRef.current?.focus();
    };
  }, [narrow, mobile]);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSources(false);
        setMobile(false);
      }
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    setMobile(false);
  }, [location.pathname, location.search]);
  const pageKey =
    location.pathname + ':' + (new URLSearchParams(location.search).get('asset') || '');
  const previousPage = useRef(pageKey);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (previousPage.current !== pageKey && !location.hash) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.getElementById('main-content')?.focus({ preventScroll: true });
      }
      previousPage.current = pageKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [pageKey, location.hash]);
  return (
    <div className={'app ' + (collapsed ? 'nav-collapsed' : '')}>
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      <aside
        ref={sidebarRef}
        id="site-sidebar"
        inert={narrow && !mobile}
        className={'sidebar ' + (mobile ? 'open' : '')}
      >
        {narrow && mobile ? (
          <button
            className="sidebar-close"
            onClick={() => setMobile(false)}
            aria-label="탐색 메뉴 닫기"
          >
            <X size={20} />
          </button>
        ) : null}
        <Link to="/" className="brand" onClick={() => setMobile(false)}>
          <img
            className="brand-symbol brand-wordmark-dark"
            src="/brand/coin-desk-shiba-smile.png"
            alt=""
            width="32"
            height="32"
          />
          <img
            className="brand-symbol brand-wordmark-light"
            src="/brand/coin-desk-shiba-smile.png"
            alt=""
            width="32"
            height="32"
          />
          <b>
            Coin<span>Desk</span>
          </b>
        </Link>
        <DeskNavigation onNavigate={() => setMobile(false)} />
      </aside>
      {mobile ? <div className="mobile-shade" onClick={() => setMobile(false)} /> : null}
      <div className="main-shell" inert={narrow && mobile}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            ref={menuRef}
            aria-label={mobile ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={mobile}
            aria-controls="site-sidebar"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
          <DeskTopbar
            collapsed={collapsed}
            onCollapse={() =>
              setCollapsed((v) => {
                save('sidebar-collapsed', !v);
                return !v;
              })
            }
          />
          <button
            className="source-button"
            onClick={() => setSources(true)}
            aria-label="데이터 출처"
          >
            <Database size={15} />
            <span>출처</span>
          </button>
        </header>
        {!online ? (
          <div className="connection-banner" role="status">
            인터넷 연결이 끊겼습니다. 보관된 값은 최신 시세가 아닐 수 있습니다.
          </div>
        ) : null}
        {storageError ? (
          <div className="connection-banner" role="status">
            브라우저에 설정을 저장하지 못했습니다. 작업공간의 백업 기능으로 보관해 주세요.
            <button onClick={() => setStorageError(false)}>닫기</button>
          </div>
        ) : null}
        <main id="main-content" tabIndex={-1}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<PricePage />} />
              <Route path="/chart/:asset" element={<PricePage workspace />} />
              <Route path="/metrics/:metric" element={<MetricPage />} />
              <Route path="/coins" element={<WatchlistPage />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/explore" element={<MetricsExplorer />} />
              <Route path="/dominance" element={<DominancePage />} />
              <Route path="/status" element={<DataStatusPage />} />
              <Route path="/onchain/:asset" element={<NetworkPage />} />
              <Route path="/futures/:asset" element={<FuturesPage />} />
              <Route path="/research" element={<ResearchPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/brand" element={<BrandPage />} />
              <Route
                path="*"
                element={
                  <div className="empty-state">
                    페이지를 찾지 못했습니다. <Link to="/">대시보드로 이동</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer>
          <span>
            Coin Desk <i />
            공개 데이터로 살펴보는 코인 시장
          </span>
          <span>
            <Clock3 size={12} />
            시각 표시 KST · 일별 기준 UTC
          </span>
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.
          </a>
          <Link to="/brand">Coin Desk 브랜드</Link>
        </footer>
      </div>
      {sources ? <SourceDialog onClose={() => setSources(false)} /> : null}
    </div>
  );
}
