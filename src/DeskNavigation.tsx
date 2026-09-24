import { useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  ChartNoAxesCombined,
  Activity,
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

const featured = ['BTC', 'DOGE', 'ETH'] as const;
const marketItems = [
  { title: '시장 도미넌스', to: '/dominance' },
  { title: '코인 성과 비교', to: '/compare' },
  { title: '관심 코인', to: '/coins' },
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
  const candidate =
    location.pathname.split('/')[2] ||
    new URLSearchParams(location.search).get('asset') ||
    saved('lastAsset', 'BTC');
  const asset: Asset = ASSETS.find((a) => a.id === candidate)?.id || 'BTC';
  const section = coinSection(location.pathname, location.hash);
  const activeAsset = section ? asset : null;
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
    e.aliases.toLowerCase().includes(query.toLowerCase().trim()),
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
        />
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
            <Link to="/" aria-label="대시보드" title="대시보드">
              <LayoutDashboard size={17} />
              <span>대시보드</span>
            </Link>
            <Link to={'/chart/' + asset} aria-label="기술적 분석" title="기술적 분석">
              <ChartNoAxesCombined size={17} />
              <span>기술적 분석</span>
            </Link>
            <NavLink to="/explore" aria-label="온체인 · 지표 탐색" title="온체인 · 지표 탐색">
              <Layers size={17} />
              <span>온체인 · 지표 탐색</span>
            </NavLink>
            <NavLink to="/workspace" aria-label="내 작업공간" title="내 작업공간">
              <Star size={17} />
              <span>내 작업공간</span>
            </NavLink>
          </nav>
          <div className="nav-groups">
            <span className="sidebar-label">코인별 분석</span>
            <div className="coin-nav-list">
              {featured.map((id) => {
                const name = ASSETS.find((item) => item.id === id)!.name;
                const current = activeAsset === id;
                const root = `/?asset=${id}&period=all`;
                const links = [
                  { id: 'history', label: '전체 가격', to: root },
                  { id: 'chart', label: '거래소 차트', to: `/chart/${id}?period=all` },
                  { id: 'onchain', label: '온체인', to: `/onchain/${id}?period=all` },
                  { id: 'derivatives', label: '선물 · 펀딩비 / 미결제약정', to: `/futures/${id}` },
                  id === 'BTC'
                    ? { id: 'cycle', label: '이동평균 · Pi Cycle', to: root + '#btc-cycle' }
                    : { id: 'relative', label: 'BTC 대비 성과', to: root + '#relative-analysis' },
                ];
                return (
                  <div key={id} className={'coin-nav-group' + (current ? ' current' : '')}>
                    <Link className="coin-nav-title" to={root} onClick={onNavigate}>
                      <AssetLogo asset={id} size={19} />
                      <b>{id}</b>
                      <span>{name}</span>
                    </Link>
                    {current && (
                      <nav aria-label={`${id} 분석`} onClick={onNavigate}>
                        {links.map((link) => (
                          <Link
                            key={link.id}
                            to={link.to}
                            className={section === link.id ? 'active' : ''}
                            aria-current={section === link.id ? 'page' : undefined}
                          >
                            {link.label}
                          </Link>
                        ))}
                      </nav>
                    )}
                  </div>
                );
              })}
            </div>
            <details className="market-nav">
              <summary>시장 · 비교</summary>
              <nav onClick={onNavigate}>
                {marketItems.map((item) => (
                  <NavLink key={item.to} to={item.to}>
                    {item.title}
                  </NavLink>
                ))}
              </nav>
            </details>
          </div>
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
    coins: '관심 코인',
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
          : names[location.pathname.split('/')[1]] || '대시보드';
  return (
    <>
      <button
        className="icon-button sidebar-toggle"
        aria-label={collapsed ? '탐색 메뉴 펼치기' : '탐색 메뉴 접기'}
        aria-expanded={!collapsed}
        onClick={onCollapse}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <span className="breadcrumb">
        <Link to="/">Coin Desk</Link>
        <span>/</span>
        <b>{title}</b>
      </span>
      <div className="topbar-coins">
        {ASSETS.slice(0, 3).map((a) => (
          <Link key={a.id} to={`/?asset=${a.id}`}>
            <AssetLogo asset={a.id} size={18} />
            {a.id}
          </Link>
        ))}
      </div>
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
