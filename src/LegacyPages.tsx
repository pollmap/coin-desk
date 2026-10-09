import { supportsReference } from '../shared/indicator-catalog';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Expand,
  Info,
  Minus,
  MousePointer2,
  TrendingUp,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ASSETS, METRICS } from '../shared/catalog';
import { validIndicators } from '../shared/indicators';
import { PERIOD_OPTIONS } from '../shared/ranges';
import type {
  Asset,
  CandleResponse,
  Interval,
  Metric,
  Overview,
  Period,
  SeriesResponse,
} from '../shared/types';
import { chartSettings, validCards } from '../shared/workspace';
import './analysis-ux.css';
import { AssetHeader } from './AssetHeader';
import { AssetLogo } from './AssetLogo';
import './data-status.css';
import { DeferredMount } from './DeferredMount';
import { useData } from './hooks';
import { IndicatorEditor } from './IndicatorEditor';
import { dateLabel, metricValue, money, numeric, save, saved, turnover } from './lib';
import { MarketPicker } from './MarketPicker';
import { MetricGuide } from './MetricGuide';
import './network.css';
import { PeriodPicker } from './PeriodPicker';
import { CardPicker, usePersonalDesk, WorkspaceBar } from './PersonalDesk';
import { useMarket } from './useMarket';
const ExchangeHistoryPanel = lazy(() =>
  import('./ExchangeHistoryPanel').then((m) => ({ default: m.ExchangeHistoryPanel })),
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
export function PricePage({ workspace = false }: { workspace?: boolean }) {
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
  const hasLongHistory = supportsReference(asset);
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
export function WorkspacePage() {
  const preferences = chartSettings(saved('preferences', {}));
  const { desk } = usePersonalDesk();
  return (
    <>
      <div className="page-heading">
        <h1>내 저장</h1>
      </div>
      <section className="workspace-page">
        <WorkspaceBar listOnly current={{ ...preferences, cards: desk.cards, view: 'chart' }} />
        <p className="muted">
          이 브라우저에 저장됩니다. 다른 기기로 옮길 때는 백업·복원을 이용하세요.
        </p>
      </section>
    </>
  );
}
export function SourceDialog({ onClose }: { onClose: () => void }) {
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
