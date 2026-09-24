import { matchesCoin } from '../shared/coin-search';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Search,
  ChartNoAxesCombined,
  Activity,
  ArrowLeftRight,
  Coins,
  X,
  Layers,
  Star,
  Database,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { ASSETS, METRICS } from '../shared/catalog';
import { NETWORK_METRICS, isNetworkAsset, networkMetric } from '../shared/network-catalog';
import type { Asset } from '../shared/types';
import { saved, save } from './lib';
import { AssetLogo } from './AssetLogo';
import { useMarket } from './useMarket';

const featured = ASSETS.map((a) => a.id);
const marketItems = [
  { title: '시장 도미넌스', to: '/dominance' },
  { title: '코인 성과 비교', to: '/compare' },
  { title: '관심 코인', to: '/coins' },
  { title: '코인 역사', to: '/history' },
];

/** Query and fragment are part of a coin view. NavLink pathname matching ignores them. */
export function coinSection(pathname: string, hash: string): string {
  if (pathname.startsWith('/futures/')) return 'derivatives';
  if (pathname.startsWith('/onchain/')) return 'onchain';
  if (pathname.startsWith('/chart/')) return 'chart';
  if (pathname !== '/') return '';
  if (hash === '#derivatives') return 'derivatives';
  if (hash === '#btc-cycle') return 'cycle';
  if (hash === '#relative-analysis') return 'relative';
  return 'history';
}

export function DeskNavigation({ onNavigate }: { onNavigate: () => void }) {
  const [query, setQuery] = useState('');
  const location = useLocation();
  const { market } = useMarket();
  const candidate =
    location.pathname.split('/')[2] ||
    new URLSearchParams(location.search).get('asset') ||
    saved('lastAsset', 'BTC');
  const asset: Asset = ASSETS.find((a) => a.id === candidate)?.id || 'BTC';
  const section = coinSection(location.pathname, location.hash);
  const networkAsset = isNetworkAsset(asset) ? asset : 'BTC';
  const entries = useMemo(
    () =>
      [
        ...ASSETS.map((a) => ({
          title: `${a.id} · ${a.name}`,
          asset: a.id,
          aliases: a.name + a.id,
          to: `/?asset=${a.id}&period=all`,
          type: '코인',
        })),
        ...METRICS.map((m) => ({
          title: m.title,
          aliases: m.title + m.english + m.id,
          to: '/metrics/' + m.id,
          type: 'BTC 지표',
        })),
        ...marketItems.map((item) => ({ ...item, aliases: item.title, type: '시장' })),
        ...featured.flatMap((id) => [
          {
            title: id + ' 선물 · 펀딩비·미결제약정',
            aliases: id + ' 펀딩비 미결제약정 선물',
            to: `/futures/${id}`,
            type: id,
          },
          { title: id + ' 온체인', aliases: id + ' 온체인', to: `/onchain/${id}`, type: id },
        ]),
        ...NETWORK_METRICS.filter((m) => networkMetric(networkAsset, m.id)).map((m) => ({
          title: m.title,
          aliases: m.title + ' ' + m.id,
          to: `/onchain/${networkAsset}?metric=${m.id}`,
          type: networkAsset + ' 네트워크',
        })),
      ].filter((x, i, arr) => arr.findIndex((y) => y.to === x.to) === i),
    [networkAsset],
  );
  const results = entries.filter((e) =>
    'asset' in e
      ? matchesCoin(e.asset as Asset, query)
      : e.aliases.toLowerCase().includes(query.toLowerCase().trim()),
  );
  return (
    <>
      <label className="nav-search">
        <Search size={15} />
        <input
          aria-label="코인·지표 검색"
          placeholder="코인·지표 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
        />
        {query && (
          <button aria-label="검색 지우기" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </label>
      {query.trim() ? (
        <nav className="nav-search-results" aria-label="검색 결과" onClick={onNavigate}>
          <span className="sidebar-label">검색 결과 {results.length}</span>
          {results.map((r) => (
            <Link key={r.to} to={r.to}>
              <span>
                {'asset' in r && r.asset ? <AssetLogo asset={r.asset as Asset} size={18} /> : null}{' '}
                {r.title}
              </span>
              <small>{r.type}</small>
            </Link>
          ))}
          {!results.length && (
            <p className="nav-empty">검색 결과가 없습니다. 코인 이름이나 MVRV를 입력해 보세요.</p>
          )}
        </nav>
      ) : (
        <>
          <nav className="primary-nav" onClick={onNavigate} aria-label="주요 화면">
            <Link
              to={`/?asset=${asset}&period=all`}
              className={section ? 'active' : ''}
              aria-current={section ? 'page' : undefined}
              aria-label="코인 분석"
              title="코인 분석"
            >
              <ChartNoAxesCombined size={18} />
              <span>코인 분석</span>
            </Link>
            <NavLink to="/coins" aria-label="시장 시세" title="시장 시세">
              <Coins size={18} />
              <span>시장 시세</span>
            </NavLink>
            <NavLink to="/compare" aria-label="성과 비교" title="성과 비교">
              <ArrowLeftRight size={18} />
              <span>성과 비교</span>
            </NavLink>
            <NavLink to="/explore" aria-label="지표 찾기" title="지표 찾기">
              <Layers size={18} />
              <span>지표 찾기</span>
            </NavLink>
            <NavLink to={'/dominance?asset=' + asset} aria-label="시장 비중" title="시장 비중">
              <Activity size={18} />
              <span>시장 비중</span>
            </NavLink>
            <NavLink
              to={'/research?asset=' + asset}
              aria-label="리서치 모아보기"
              title="리서치 모아보기"
            >
              <Layers size={18} />
              <span>리서치 모아보기</span>
            </NavLink>
            <NavLink
              to={'/history?asset=' + asset + '&market=' + market}
              aria-label="코인 역사"
              title="코인 역사"
            >
              <Activity size={18} />
              <span>코인 역사</span>
            </NavLink>
            <NavLink to="/workspace" aria-label="내 작업공간" title="내 작업공간">
              <Star size={18} />
              <span>내 작업공간</span>
            </NavLink>
          </nav>
        </>
      )}
      <nav className="nav-utilities" onClick={onNavigate}>
        <NavLink to="/status" aria-label="데이터 · 자동 갱신" title="데이터 · 자동 갱신">
          <Database size={15} />
          <span>데이터 · 자동 갱신</span>
        </NavLink>
        <NavLink to="/brand" aria-label="Coin Desk 브랜드" title="Coin Desk 브랜드">
          <Activity size={15} />
          <span>Coin Desk 브랜드</span>
        </NavLink>
      </nav>
    </>
  );
}

export function DeskTopbar({
  collapsed,
  onCollapse,
}: {
  collapsed: boolean;
  onCollapse: () => void;
}) {
  const location = useLocation();
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    saved<string>('theme', 'dark') === 'light' ? 'light' : 'dark',
  );
  const id = location.pathname.split('/')[2];
  const names: Record<string, string> = {
    research: '리서치 모아보기',
    history: '코인 역사',
    coins: '시장 시세',
    compare: '코인 성과 비교',
    explore: '지표 탐색',
    dominance: '시장 도미넌스',
    status: '데이터 · 자동 갱신',
    brand: '브랜드',
    workspace: '내 작업공간',
  };
  const title = location.pathname.startsWith('/futures/')
    ? id + ' 선물'
    : location.pathname.startsWith('/metrics/')
      ? METRICS.find((m) => m.id === id)?.title
      : location.pathname.startsWith('/chart/')
        ? `${id} 기술적 분석`
        : location.pathname.startsWith('/onchain/')
          ? `${id} 온체인`
          : names[location.pathname.split('/')[1]] || '코인 분석';
  useEffect(() => {
    document.title = (title || '코인 분석') + ' | Coin Desk';
  }, [title]);
  return (
    <>
      <button
        className="icon-button sidebar-toggle"
        aria-label={collapsed ? '탐색 메뉴 펼치기' : '탐색 메뉴 접기'}
        aria-controls="site-sidebar"
        aria-expanded={!collapsed}
        onClick={onCollapse}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <span className="breadcrumb" aria-label="현재 위치">
        <Link to="/">Coin Desk</Link>
        <span>/</span>
        <b>{title}</b>
      </span>
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
        {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    </>
  );
}
