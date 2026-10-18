import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { hasFocusedAnalysisParams } from '../shared/default-analysis';
import { ASSETS } from '../shared/catalog';
import { ProductTopbar } from './ProductTopbar';
import { MarketHome as WatchlistPage } from './MarketHome';
import './analysis-ux.css';
const AnalysisWorkspace = lazy(() =>
  import('./IndicatorWorkspace').then((m) => ({ default: m.IndicatorWorkspace })),
);
const CoinDashboard = lazy(() =>
  import('./CoinDashboard').then((m) => ({ default: m.CoinDashboard })),
);
const ReportsPage = lazy(() => import('./ReportsPage'));
const ResearchLibrary = lazy(() =>
  import('./ResearchLibrary').then((m) => ({ default: m.ResearchLibrary })),
);
const LearnPage = lazy(() => import('./LearnPage').then((m) => ({ default: m.LearnPage })));
const ComparePage = lazy(() =>
  import('./ComparisonWorkspace').then((m) => ({ default: m.ComparisonWorkspace })),
);
const DominancePage = lazy(() =>
  import('./DominancePanel').then((m) => ({ default: m.DominancePage })),
);
const BrandPage = lazy(() => import('./BrandPage').then((m) => ({ default: m.BrandPage })));
const WorkspacePage = lazy(() => import('./SavedPage'));
const LegacyIndicatorRoute = lazy(() => import('./IndicatorRedirect'));
function EntryRoute() {
  const location = useLocation(),
    p = new URLSearchParams(location.search);
  if (hasFocusedAnalysisParams(p)) {
    return <LegacyIndicatorRoute />;
  }
  if (p.has('asset')) {
    const asset = ASSETS.find((a) => a.id === p.get('asset'))?.id ?? 'BTC';
    return (
      <Navigate
        replace
        to={{ pathname: '/coins/' + asset, search: location.search, hash: location.hash }}
      />
    );
  }
  return <WatchlistPage />;
}
function CoinRoute() {
  const params = new URLSearchParams(useLocation().search);
  return hasFocusedAnalysisParams(params) ? <AnalysisWorkspace /> : <CoinDashboard />;
}
function Loading({ message = '불러오는 중…' }: { message?: string }) {
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
  const coinMode = /^\/coins\/[^/]+$/.test(location.pathname)
    ? hasFocusedAnalysisParams(new URLSearchParams(location.search))
      ? ':focused'
      : ':dashboard'
    : '';
  const pageKey =
    location.pathname +
    ':' +
    (location.pathname === '/learn' || location.pathname.startsWith('/learn/')
      ? ''
      : location.pathname.match(/^\/coins\/([^/]+)$/)?.[1] ||
        new URLSearchParams(location.search).get('asset') ||
        '') +
    coinMode;
  const previousPage = useRef(pageKey);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (
        previousPage.current !== pageKey &&
        !location.hash &&
        location.pathname !== '/' &&
        location.pathname !== '/coins'
      ) {
        // The multi-chart page restores its own saved reading position after layout.
        const dashboardRoute =
          /^\/coins\/[^/]+$/.test(location.pathname) &&
          !hasFocusedAnalysisParams(new URLSearchParams(location.search));
        if (!dashboardRoute) window.scrollTo({ top: 0, behavior: 'instant' });
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
        </header>
        {!online ? (
          <div className="connection-banner" role="status">
            인터넷 연결을 확인해 주세요.
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
              <Route path="/coins/:asset" element={<CoinRoute />} />
              <Route path="/chart/:asset" element={<LegacyIndicatorRoute />} />
              <Route path="/technical/:asset" element={<LegacyIndicatorRoute />} />
              <Route path="/metrics/:metric" element={<LegacyIndicatorRoute />} />
              <Route path="/coins" element={<WatchlistPage />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/workspace/library" element={<ResearchLibrary />} />
              <Route path="/learn" element={<LearnPage />} />
              <Route path="/learn/:id" element={<LearnPage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/reports/:reportId" element={<ReportsPage />} />
              <Route path="/explore" element={<Navigate to="/learn" replace />} />
              <Route path="/dominance" element={<DominancePage />} />
              <Route path="/status" element={<Navigate to="/" replace />} />
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
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.
          </a>
          <a href="https://coinmetrics.io/community-network-data/" target="_blank" rel="noreferrer">
            Coin Metrics · CC BY-NC 4.0
          </a>
        </footer>
      </div>
    </div>
  );
}
