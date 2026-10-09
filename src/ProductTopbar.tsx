import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Search, Sun, Moon, HelpCircle, X, List, ArrowLeftRight, Bookmark } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import { availableMarket, supportsMarket } from '../shared/asset-registry';
import { matchesCoin, exactCoin } from '../shared/coin-search';
import { matchesIndicator } from '../shared/indicator-search';
import { defaultIndicator, indicatorUrl, navigationIndicators } from '../shared/indicator-catalog';
import { saved, save } from './lib';
import { AssetLogo } from './AssetLogo';

export function ProductTopbar() {
  const navigate = useNavigate();
  const location = useLocation(),
    p = new URLSearchParams(location.search);
  const asset =
    ASSETS.find((a) => a.id === (location.pathname.split('/')[2] || p.get('asset')))?.id ?? 'BTC';
  const [query, setQuery] = useState(''),
    [theme, setTheme] = useState(
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    );
  const [searchOpen, setSearchOpen] = useState(false);
  const preferredMarket =
    (p.get('market') || saved('price-market', 'upbit')) === 'binance' ? 'binance' : 'upbit';
  const searchButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null),
    box = useRef<HTMLDivElement>(null),
    help = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (searchOpen) input.current?.focus();
  }, [searchOpen]);
  const results = [
    ...ASSETS.filter((a) => matchesCoin(a.id, query))
      .sort((a, b) => Number(exactCoin(b.id, query)) - Number(exactCoin(a.id, query)))
      .map((a) => ({
        id: a.id,
        title: a.name,
        kind:
          a.id +
          (supportsMarket(a.id, preferredMarket)
            ? ''
            : availableMarket(a.id, preferredMarket) === 'binance'
              ? ' · Binance USDT'
              : ' · Upbit KRW'),
        href: indicatorUrl(
          a.id,
          defaultIndicator(a.id),
          new URLSearchParams({
            market: availableMarket(a.id, preferredMarket),
            price_source: availableMarket(a.id, preferredMarket),
          }),
        ),
        asset: a.id,
      })),
    ...navigationIndicators(asset, '')
      .filter((d) => matchesIndicator(d, query))
      .map((d) => ({
        id: d.id,
        title: d.title,
        kind: asset + ' 지표',
        href: indicatorUrl(asset, d.id, p),
        asset: null,
      })),
  ].slice(0, 12);
  useEffect(() => {
    setQuery('');
    setSearchOpen(false);
    if (help.current) help.current.open = false;
    document.title =
      (location.pathname === '/' || location.pathname === '/coins'
        ? '코인 시장'
        : location.pathname.startsWith('/coins/')
          ? asset + ' · 지표 분석'
          : location.pathname.startsWith('/learn')
            ? '지표 사전'
            : location.pathname.startsWith('/workspace')
              ? '내 저장'
              : location.pathname === '/compare'
                ? '코인 비교'
                : location.pathname === '/status'
                  ? '데이터 상태'
                  : '보리차트') + ' | 보리차트';
  }, [location.pathname, location.search]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setSearchOpen(true);
        input.current?.focus();
      }
    };
    const dismiss = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setQuery('');
    };
    window.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('keydown', keyboard);
      document.removeEventListener('pointerdown', dismiss);
    };
  }, []);
  return (
    <>
      <Link to="/" className="product-brand" aria-label="보리차트 홈">
        <img
          fetchPriority="low"
          decoding="async"
          src="/brand/bori-64.png"
          srcSet="/brand/bori-32.png 1x, /brand/bori-64.png 2x"
          width="32"
          height="32"
          alt=""
        />
        <b>보리차트</b>
      </Link>
      <nav className="product-nav" aria-label="주요 화면">
        <NavLink
          to="/coins"
          end
          className={({ isActive }) => (isActive || location.pathname === '/' ? 'active' : '')}
        >
          <List size={20} aria-hidden="true" />
          시장
        </NavLink>
        <NavLink to="/compare">
          <ArrowLeftRight size={20} aria-hidden="true" />
          비교
        </NavLink>
        <NavLink to="/workspace">
          <Bookmark size={20} aria-hidden="true" />내 저장
        </NavLink>
      </nav>
      <button
        ref={searchButton}
        className="mobile-search-button"
        aria-label="코인·지표 검색 열기"
        aria-expanded={searchOpen}
        aria-controls="product-search"
        onClick={() => setSearchOpen(!searchOpen)}
      >
        <Search size={20} />
      </button>
      <div
        id="product-search"
        className={'product-search' + (searchOpen ? ' is-open' : '')}
        ref={box}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && e.target === input.current && query.trim() && results.length) {
            e.preventDefault();
            navigate(results[0].href);
          }
          if (e.key === 'Escape') {
            setQuery('');
            setSearchOpen(false);
            if (window.matchMedia('(max-width: 760px)').matches) searchButton.current?.focus();
            else input.current?.focus();
          }
          if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
            const nodes = [
              input.current,
              ...(box.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []),
            ].filter(Boolean) as HTMLElement[];
            const i = nodes.indexOf(document.activeElement as HTMLElement);
            nodes[(i + (e.key === 'ArrowDown' ? 1 : nodes.length - 1)) % nodes.length]?.focus();
            e.preventDefault();
          }
        }}
      >
        <Search size={17} />
        <input
          ref={input}
          aria-label="코인·지표 검색"
          placeholder="코인이나 지표 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-controls={query.trim() ? 'product-search-results' : undefined}
        />
        {query ? (
          <button
            aria-label="검색 지우기"
            onClick={() => {
              setQuery('');
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
        {query.trim() && (
          <div className="product-search-results" id="product-search-results">
            {results.map((r) => (
              <Link key={r.id} to={r.href}>
                {r.asset && <AssetLogo asset={r.asset} size={22} />}
                <span>{r.title}</span>
                <small>{r.kind}</small>
              </Link>
            ))}
            {!results.length && <p role="status">일치하는 코인이나 지표가 없습니다.</p>}
          </div>
        )}
      </div>
      <details
        className="product-help"
        ref={help}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && help.current) {
            help.current.open = false;
            help.current.querySelector('summary')?.focus();
          }
        }}
      >
        <summary aria-label="도움말">
          <HelpCircle size={20} />
        </summary>
        <nav>
          <Link to={'/learn?' + new URLSearchParams({ ...Object.fromEntries(p), asset })}>
            지표 사전
          </Link>
          <Link to="/status">데이터 상태</Link>
          <Link to="/workspace/library">개인 자료함</Link>
          <Link to="/brand">브랜드</Link>
        </nav>
      </details>
      <button
        className="icon-button theme-toggle"
        aria-label={theme === 'dark' ? '밝은 테마로 변경' : '어두운 테마로 변경'}
        onClick={() => {
          const next = theme === 'dark' ? 'light' : 'dark';
          setTheme(next);
          save('theme', next);
          document.documentElement.dataset.theme = next;
          window.dispatchEvent(new Event('coin-desk-theme'));
        }}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </>
  );
}
