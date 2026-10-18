import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bookmark, ChevronDown, Search, SlidersHorizontal, Star } from 'lucide-react';
import {
  ASSET_REGISTRY,
  assetDefinition,
  availableMarket,
  supportsMarket,
} from '../shared/asset-registry';
import { defaultDashboardUrl } from '../shared/default-analysis';
import { exactCoin, matchesCoin } from '../shared/coin-search';
import {
  availableDashboardChartIds,
  dashboardSettingsFromParams,
  normalizeDashboardSettings,
  type DashboardSettings,
} from '../shared/dashboard';
import {
  indicatorDefinition,
  supportsReference,
  validPriceBasis,
} from '../shared/indicator-catalog';
import { isRangePeriod } from '../shared/ranges';
import { type PriceBasis } from '../shared/analysis-workspace';
import type { DateWindow } from '../shared/date-navigation';
import type { Asset, CandleResponse, Market, Period, SeriesResponse } from '../shared/types';
import type { Workspace } from '../shared/workspace';
import { useData } from './hooks';
import { AssetLogo } from './AssetLogo';
import { DeskDialog } from './DeskDialog';
import { PeriodPicker } from './PeriodPicker';
import { WorkspaceBar } from './PersonalDesk';
import { IndicatorConcept } from './IndicatorConcept';
import { DashboardChartCard, dashboardCardTitle } from './DashboardChartCard';
import { SpotQuote } from './SpotQuote';
import { useFavorites } from './useFavorites';
import { dashboardPriceUrl, dashboardPrices } from './dashboard-data';
import './coin-dashboard.css';

type Panel = 'coins' | 'save' | 'charts' | null;
const SESSION_PREFIX = 'coin-desk.dashboard.v1:';
function viewportChartHeight() {
  if (typeof window === 'undefined' || window.innerWidth >= 768) return 440;
  // Reserve the first-card heading and bottom navigation; document scrolling does not change this.
  return Math.max(240, Math.min(300, window.innerHeight - 336));
}
function readSession(key: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

export function CoinDashboard() {
  const route = useParams();
  const [params] = useSearchParams();
  const asset = assetDefinition(route.asset ?? params.get('asset') ?? 'BTC')?.id ?? 'BTC';
  const basis = validPriceBasis(
    asset,
    params.get('price_source') ?? (supportsReference(asset) ? 'reference' : 'binance'),
  );
  // A changed asset/source has independent history and viewport; period changes keep mounted charts.
  const restore = [
    params.get('dashboard_cards'),
    params.get('dashboard_ranges'),
    params.get('dashboard_scroll'),
    params.get('dashboard_ohlc'),
  ].join('|');
  return <DashboardBody key={`${asset}:${basis}:${restore}`} asset={asset} basis={basis} />;
}

function DashboardBody({ asset, basis }: { asset: Asset; basis: PriceBasis }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationIdentity = location.key + '|' + location.search;
  const currentNavigation = useRef(navigationIdentity);
  currentNavigation.current = navigationIdentity;
  const sessionKey = SESSION_PREFIX + asset + ':' + basis;
  const [initial] = useState(() => {
    const explicit = [
      'dashboard_cards',
      'dashboard_ranges',
      'dashboard_scroll',
      'dashboard_ohlc',
    ].some((key) => params.has(key));
    const stored = readSession(sessionKey) as {
      period?: unknown;
      navigationIdentity?: unknown;
    } | null;
    // Back/refresh of this history entry restores the latest viewport, even if it began as a saved URL.
    const returningToEntry = stored?.navigationIdentity === navigationIdentity;
    const settings =
      explicit && !returningToEntry
        ? dashboardSettingsFromParams(asset, params)
        : normalizeDashboardSettings(asset, stored);
    // A directly specified period has priority over a previously zoomed local view.
    if (
      (!explicit || returningToEntry) &&
      params.has('period') &&
      stored?.period !== params.get('period')
    )
      settings.ranges = {};
    return settings;
  });
  const [charts, setCharts] = useState(initial.charts);
  const [rangeRevision, setRangeRevision] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [help, setHelp] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const dashboardHost = useRef<HTMLDivElement | null>(null);
  const ranges = useRef<Record<string, DateWindow>>({ ...initial.ranges });
  const initialRanges = useRef(initial.ranges);
  const readingPosition = useRef(initial.scrollY);
  const session = readSession(sessionKey) as { period?: unknown } | null;
  const period: Period = isRangePeriod(params.get('period'))
    ? (params.get('period') as Period)
    : isRangePeriod(session?.period)
      ? (session!.period as Period)
      : 'all';
  const market = availableMarket(asset, params.get('market') === 'upbit' ? 'upbit' : 'binance');
  const ohlcSource =
    initial.ohlcSource ?? (basis === 'reference' ? availableMarket(asset, 'binance') : basis);
  const [query, setQuery] = useState('');
  const { favorites, toggle } = useFavorites();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  const [chartHeight, setChartHeight] = useState(viewportChartHeight);
  useEffect(() => {
    let width = window.innerWidth;
    const resize = () => {
      // Mobile browser chrome can resize the height while scrolling. Only a layout-width change
      // (including orientation changes) starts a new chart height for this reading session.
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      setChartHeight(viewportChartHeight());
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const coin = assetDefinition(asset)!;
  const price = useData<SeriesResponse | CandleResponse>(
    dashboardPriceUrl(asset, basis),
    true,
    basis === 'reference' ? 3600000 : 60000,
  );
  const points = useMemo(() => dashboardPrices(price.data, basis), [price.data, basis]);
  const priceInput = useMemo(
    () => ({
      points,
      loading: price.loading,
      error: price.error,
      stale: price.data?.meta.stale,
      reload: price.reload,
    }),
    [points, price.loading, price.error, price.data, price.reload],
  );
  const state = useRef({ charts, period });
  state.current = { charts, period };
  const snapshot = useCallback(
    (): DashboardSettings => ({
      charts: state.current.charts,
      ranges: { ...ranges.current },
      scrollY: readingPosition.current,
      ohlcSource,
    }),
    [ohlcSource],
  );
  const persist = useCallback(() => {
    try {
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({
          ...snapshot(),
          period: state.current.period,
          navigationIdentity: currentNavigation.current,
        }),
      );
    } catch {
      /* Reading charts must remain usable when session storage is unavailable. */
    }
  }, [sessionKey, snapshot]);
  const rememberView = useCallback(() => {
    readingPosition.current = Math.max(0, window.scrollY);
    persist();
  }, [persist]);
  useLayoutEffect(() => {
    const recordScroll = () => {
      readingPosition.current = Math.max(0, window.scrollY);
    };
    window.addEventListener('scroll', recordScroll, { passive: true });
    window.addEventListener('pagehide', rememberView);
    return () => {
      // Detach before the shorter focused page can clamp the document's scroll position.
      window.removeEventListener('scroll', recordScroll);
      persist();
      window.removeEventListener('pagehide', rememberView);
    };
  }, [persist, rememberView]);
  useLayoutEffect(() => {
    // Lazy cards can add a legend after mounting. Wait for enough document height before settling.
    const target = initial.scrollY;
    let frame = 0;
    let stopped = false;
    const observer = new ResizeObserver(() => schedule());
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
        window.removeEventListener(event, stop);
    };
    const restore = () => {
      if (stopped) return;
      const available = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: Math.min(target, available), behavior: 'instant' });
      if (available >= target) stop();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    };
    if (dashboardHost.current) observer.observe(dashboardHost.current);
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      window.addEventListener(event, stop, { passive: true });
    schedule();
    return stop;
  }, [initial.scrollY]);
  const updateRange = useCallback((id: string, range: DateWindow) => {
    ranges.current[id] = range;
  }, []);
  const changePeriod = useCallback(
    (next: Period) => {
      ranges.current = {};
      initialRanges.current = {};
      setRangeRevision((value) => value + 1);
      setParams(
        (previous) => {
          const p = new URLSearchParams(previous);
          p.set('period', next);
          p.delete('dashboard_ranges');
          p.delete('dashboard_scroll');
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const openPanel = (next: Panel, button: HTMLButtonElement) => {
    trigger.current = button;
    setHelp(null);
    setPanel(next);
  };
  const changeCoin = (next: Asset) => {
    rememberView();
    setPanel(null);
    setQuery('');
    navigate(defaultDashboardUrl(next, market));
  };
  const changeBasis = (next: PriceBasis) => {
    rememberView();
    setParams((previous) => {
      const p = new URLSearchParams(previous);
      p.set('price_source', next);
      for (const key of ['dashboard_ranges', 'dashboard_scroll']) p.delete(key);
      return p;
    });
  };
  const coins = ASSET_REGISTRY.filter(
    (item) => matchesCoin(item.id, query) && (!favoritesOnly || favorites.includes(item.id)),
  ).sort((a, b) => Number(exactCoin(b.id, query)) - Number(exactCoin(a.id, query)));
  const picker = (mobile: boolean) => (
    <div className={'coin-dashboard-picker' + (mobile ? ' is-mobile' : '')}>
      <label className="coin-dashboard-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label="코인 검색"
          placeholder="코인 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229 &&
              coins.length
            ) {
              event.preventDefault();
              changeCoin(coins[0].id);
            }
          }}
        />
      </label>
      <div className="coin-dashboard-coin-tabs" aria-label="코인 목록">
        <button aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>
          전체
        </button>
        <button aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)}>
          관심
        </button>
      </div>
      {favoriteError && <p role="alert">{favoriteError}</p>}
      <nav aria-label="코인 선택" className="coin-dashboard-coin-list">
        {coins.map((item) => (
          <div className="coin-dashboard-coin-row" key={item.id}>
            <button
              aria-current={item.id === asset ? 'page' : undefined}
              onClick={() => changeCoin(item.id)}
            >
              <AssetLogo asset={item.id} size={25} />
              <span>
                {item.name}
                <small>{item.id}</small>
              </span>
            </button>
            <button
              className="coin-dashboard-favorite"
              aria-label={item.name + ' 관심 코인'}
              aria-pressed={favorites.includes(item.id)}
              onClick={() => {
                try {
                  toggle(item.id);
                  setFavoriteError('');
                } catch {
                  setFavoriteError('관심목록을 저장하지 못했습니다.');
                }
              }}
            >
              <Star size={15} fill={favorites.includes(item.id) ? 'currentColor' : 'none'} />
            </button>
          </div>
        ))}
        {!coins.length && (
          <p>{favoritesOnly && !query ? '관심 코인이 없습니다.' : '검색한 코인이 없습니다.'}</p>
        )}
      </nav>
    </div>
  );
  const current: Omit<Workspace, 'name'> = {
    asset,
    market,
    interval: '1d',
    period,
    indicators: [],
    log: false,
    view: 'dashboard',
    cards: [],
    priceSource: basis,
    dashboard: { charts, ranges: {}, scrollY: 0, ohlcSource },
  };
  const definition = help ? indicatorDefinition(help) : null;
  return (
    <div className="coin-dashboard" data-asset={asset} ref={dashboardHost}>
      <aside className="coin-dashboard-rail">{picker(false)}</aside>
      <div className="coin-dashboard-main">
        <header className="coin-dashboard-heading">
          <div className="coin-dashboard-identity">
            <AssetLogo asset={asset} size={32} />
            <h1>
              {coin.name}
              <small>{asset}</small>
            </h1>
            <button
              className="coin-dashboard-mobile-coins coin-dashboard-icon"
              aria-label="코인 선택"
              onClick={(event) => openPanel('coins', event.currentTarget)}
            >
              <ChevronDown size={18} />
            </button>
          </div>
          <div className="coin-dashboard-price">
            <SpotQuote asset={asset} market={market} />
          </div>
        </header>
        <div className="coin-dashboard-toolbar">
          <PeriodPicker value={period} onChange={changePeriod} />
          <div className="coin-dashboard-actions">
            <label className="coin-dashboard-currency">
              <span className="sr-only">차트 가격 통화</span>
              <select
                aria-label="차트 가격 통화"
                value={basis}
                onChange={(event) => changeBasis(event.target.value as PriceBasis)}
              >
                {supportsReference(asset) && <option value="reference">USD</option>}
                {supportsMarket(asset, 'binance') && <option value="binance">USDT</option>}
                {supportsMarket(asset, 'upbit') && <option value="upbit">KRW</option>}
              </select>
            </label>
            <button
              onClick={() => {
                if (!charts.includes('view:relative'))
                  setCharts((current) => [...current, 'view:relative']);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>('.coin-dashboard-card[data-metric="view:relative"]')
                    ?.scrollIntoView({ block: 'start' }),
                );
              }}
            >
              {asset === 'BTC' ? 'ETH' : 'BTC'} 대비
            </button>
            <button
              onClick={(event) => openPanel('charts', event.currentTarget)}
              aria-label="보는 지표 선택"
            >
              <SlidersHorizontal size={17} />
              <span>지표</span>
            </button>
            <button
              onClick={(event) => openPanel('save', event.currentTarget)}
              aria-label="분석 저장"
            >
              <Bookmark size={17} />
              <span>저장</span>
            </button>
          </div>
        </div>
        <div className="coin-dashboard-charts">
          {charts.map((metric, index) => (
            <DashboardChartCard
              key={metric}
              asset={asset}
              metric={metric}
              basis={basis}
              ohlcSource={ohlcSource}
              period={period}
              priceInput={priceInput}
              initialWindow={initialRanges.current[metric]}
              rangeRevision={rangeRevision}
              onRange={updateRange}
              onNavigate={rememberView}
              onAll={() => changePeriod('all')}
              eager={index === 0}
              height={chartHeight}
              onHelp={(id, button) => {
                trigger.current = button;
                setPanel(null);
                setHelp(id);
              }}
            />
          ))}
        </div>
        {asset === 'INJ' && (
          <Link to="/reports?scope=injective" className="desk-button" onClick={rememberView}>
            Injective 보고서
          </Link>
        )}
      </div>
      <DeskDialog
        open={panel !== null || help !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPanel(null);
            setHelp(null);
          }
        }}
        title={
          panel === 'coins'
            ? '코인 선택'
            : panel === 'save'
              ? '분석 저장'
              : panel === 'charts'
                ? '보는 지표'
                : (definition?.title ?? '읽는 법')
        }
        returnFocus={trigger}
        sheet
        reading={!!help}
      >
        {panel === 'coins' && picker(true)}
        {panel === 'save' && (
          <WorkspaceBar
            current={current}
            embedded
            hideTransfer
            resolveCurrent={(value) => ({ ...value, dashboard: snapshot() })}
            onOpenWorkspace={() => setPanel(null)}
          />
        )}
        {panel === 'charts' && (
          <div className="coin-dashboard-chart-picker">
            {availableDashboardChartIds(asset).map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={charts.includes(id)}
                  disabled={charts.length === 1 && charts.includes(id)}
                  onChange={(event) => {
                    setCharts((previous) =>
                      event.target.checked
                        ? [...previous, id]
                        : previous.filter((chart) => chart !== id),
                    );
                  }}
                />
                <span>{dashboardCardTitle(asset, id)}</span>
              </label>
            ))}
          </div>
        )}
        {definition && (
          <div className="coin-dashboard-help">
            <p>{definition.shortMeaning}</p>
            <IndicatorConcept metric={definition.id} />
            {definition.baselineMeaning && <p>{definition.baselineMeaning}</p>}
            <details>
              <summary>계산식</summary>
              <p>{definition.formula}</p>
            </details>
          </div>
        )}
      </DeskDialog>
    </div>
  );
}
