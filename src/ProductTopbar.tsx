import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Search, Sun, Moon, HelpCircle, List, ArrowLeftRight, Bookmark } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import { saved, save } from './lib';
const SearchDialog = lazy(() => import('./SearchDialog'));

export function ProductTopbar() {
  const location = useLocation(),
    p = new URLSearchParams(location.search);
  const asset =
    ASSETS.find((a) => a.id === (location.pathname.split('/')[2] || p.get('asset')))?.id ?? 'BTC';
  const [query, setQuery] = useState(''),
    [theme, setTheme] = useState(
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    );
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null),
    help = useRef<HTMLDetailsElement>(null),
    searchReturn = useRef<HTMLElement | null>(null);
  useEffect(() => {
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
    const openSearch = (e: Event) => {
      const detail = (e as CustomEvent<{ query: string; trigger: HTMLElement }>).detail;
      setQuery(detail?.query ?? '');
      searchReturn.current = detail?.trigger ?? searchButton.current;
      setSearchOpen(true);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        searchReturn.current = document.activeElement as HTMLElement;
        setQuery('');
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', keyboard);
    window.addEventListener('bori-open-search', openSearch);
    return () => {
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('bori-open-search', openSearch);
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
        className="product-search search-trigger"
        aria-label="코인·지표 검색 열기"
        aria-expanded={searchOpen}
        onClick={() => {
          searchReturn.current = searchButton.current;
          setQuery('');
          setSearchOpen(true);
        }}
      >
        <Search size={18} aria-hidden="true" />
        <span>코인·지표 검색</span>
        <kbd>/</kbd>
      </button>
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchDialog
            open
            close={() => setSearchOpen(false)}
            asset={asset}
            initialQuery={query}
            trigger={searchReturn}
          />
        </Suspense>
      )}
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
