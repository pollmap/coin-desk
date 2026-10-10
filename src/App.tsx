import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { Database, Clock3 } from 'lucide-react';
import { NotificationInbox } from './NotificationInbox';
import { ProductTopbar } from './ProductTopbar';
import { MarketHome as WatchlistPage } from './MarketHome';
import './analysis-ux.css';
const AnalysisWorkspace = lazy(() =>
  import('./IndicatorWorkspace').then((m) => ({ default: m.IndicatorWorkspace })),
);
const LegacyWatchlist = lazy(() =>
  import('./WatchlistPage').then((m) => ({ default: m.WatchlistPage })),
);
const ResearchLibrary = lazy(() =>
  import('./ResearchLibrary').then((m) => ({ default: m.ResearchLibrary })),
);
const LearnPage = lazy(() => import('./LearnPage').then((m) => ({ default: m.LearnPage })));
const ComparePage = lazy(() => import('./ComparePage').then((m) => ({ default: m.ComparePage })));
const MetricsExplorer = lazy(() =>
  import('./MetricsExplorer').then((m) => ({ default: m.MetricsExplorer })),
);
const DominancePage = lazy(() =>
  import('./DominancePanel').then((m) => ({ default: m.DominancePage })),
);
const DataStatusPage = lazy(() =>
  import('./DataStatusPage').then((m) => ({ default: m.DataStatusPage })),
);
const BrandPage = lazy(() => import('./BrandPage').then((m) => ({ default: m.BrandPage })));
const PricePage = lazy(() => import('./LegacyPages').then((m) => ({ default: m.PricePage })));
const WorkspacePage = lazy(() =>
  import('./LegacyPages').then((m) => ({ default: m.WorkspacePage })),
);
const SourceDialog = lazy(() => import('./LegacyPages').then((m) => ({ default: m.SourceDialog })));
const LegacyIndicatorRoute = lazy(() => import('./IndicatorRedirect'));
function EntryRoute() {
  const location = useLocation(),
    p = new URLSearchParams(location.search);
  if (
    ['asset', 'metric', 'visual', 'panels', 'indicators', 'draw_tool', 'patterns'].some((k) =>
      p.has(k),
    )
  ) {
    return <LegacyIndicatorRoute />;
  }
  return <WatchlistPage />;
}
function MarketRoute() {
  const [params] = useSearchParams();
  return params.get('view') === 'derivatives' ? <LegacyWatchlist /> : <WatchlistPage />;
}
function Loading({ message = '실제 데이터를 불러오고 있습니다…' }: { message?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-line" />
      {message}
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
  const [sources, setSources] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSources(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const pageKey =
    location.pathname +
    ':' +
    (location.pathname === '/learn' || location.pathname.startsWith('/learn/')
      ? ''
      : location.pathname.match(/^\/coins\/([^/]+)$/)?.[1] ||
        new URLSearchParams(location.search).get('asset') ||
        '');
  const previousPage = useRef(pageKey);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (
        previousPage.current !== pageKey &&
        !location.hash &&
        location.pathname !== '/' &&
        location.pathname !== '/coins'
      ) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        const main = document.getElementById('main-content');
        // Reading pages focus their heading. Do not overwrite that destination
        // with the main landmark in a later animation frame.
        const target = main?.querySelector<HTMLElement>('[data-route-focus]') ?? main;
        // A user may already be typing the next search before this frame runs.
        // Keep that deliberate focus instead of swallowing their Enter key.
        if (!document.activeElement?.matches('.product-search input'))
          target?.focus({ preventScroll: true });
      }
      previousPage.current = pageKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [pageKey, location.hash]);
  return (
    <div className="app product-desk">
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      <div className="main-shell">
        <header className="topbar">
          <ProductTopbar />
          <NotificationInbox />
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
          <Suspense fallback={<Loading message="화면을 열고 있습니다…" />}>
            <Routes>
              <Route path="/" element={<EntryRoute />} />
              <Route path="/coins/:asset" element={<AnalysisWorkspace />} />
              <Route path="/chart/:asset" element={<LegacyIndicatorRoute />} />
              <Route path="/technical/:asset" element={<PricePage workspace />} />
              <Route path="/metrics/:metric" element={<LegacyIndicatorRoute />} />
              <Route path="/coins" element={<MarketRoute />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/workspace/library" element={<ResearchLibrary />} />
              <Route path="/learn" element={<LearnPage />} />
              <Route path="/learn/:id" element={<LearnPage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/explore" element={<MetricsExplorer />} />
              <Route path="/dominance" element={<DominancePage />} />
              <Route path="/status" element={<DataStatusPage />} />
              <Route path="/onchain/:asset" element={<LegacyIndicatorRoute />} />
              <Route path="/futures/:asset" element={<LegacyIndicatorRoute />} />
              <Route
                path="/research"
                element={<Navigate to={{ pathname: '/', search: location.search }} replace />}
              />
              <Route
                path="/history"
                element={<Navigate to={{ pathname: '/', search: location.search }} replace />}
              />
              <Route path="/brand" element={<BrandPage />} />
              <Route
                path="*"
                element={
                  <div className="empty-state">
                    페이지를 찾지 못했습니다. <Link to="/">시장으로 이동</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer>
          <span>
            <Clock3 size={12} />
            시각 표시 KST · 일별 기준 UTC
          </span>
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.
          </a>
        </footer>
      </div>
      {sources ? (
        <Suspense fallback={null}>
          <SourceDialog onClose={() => setSources(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
