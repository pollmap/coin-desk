import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import {
  INDICATOR_GROUPS,
  indicatorFamily,
  navigationIndicators,
  indicatorUrl,
  resolveIndicator,
} from '../shared/indicator-catalog';

export const isIndicatorRoute = (path: string) =>
  path === '/' || /^\/(chart|onchain|futures|metrics)\//.test(path);
export function IndicatorNavigation({ onNavigate }: { onNavigate: () => void }) {
  const location = useLocation(),
    p = new URLSearchParams(location.search);
  const asset =
    ASSETS.find((a) => a.id === location.pathname.split('/')[2])?.id ??
    ASSETS.find((a) => a.id === p.get('asset'))?.id ??
    'BTC';
  const active = resolveIndicator(asset, location.pathname, p);
  const [query, setQuery] = useState('');
  const matches = navigationIndicators(asset, active.id).filter(
    (d) =>
      d.assets.includes(asset) &&
      (d.title + ' ' + d.id).toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="indicator-navigation">
      <label className="nav-search">
        <input
          aria-label="지표 검색"
          placeholder="MVRV, RSI, 밴드…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
        />
      </label>
      <nav aria-label="지표 목록" onClick={onNavigate}>
        {!query && (
          <div className="indicator-favorites">
            <span className="sidebar-label">자주 보는 지표</span>
            {['net:mvrv', 'view:rainbow', 'view:btc_rainbow', 'rsi', 'futures:funding'].flatMap(
              (id) => {
                const d = matches.find((d) => indicatorFamily(d.id) === indicatorFamily(id));
                return d
                  ? [
                      <Link
                        key={id}
                        to={indicatorUrl(asset, d.id, p)}
                        className={active.id === d.id ? 'active' : ''}
                        aria-current={active.id === d.id ? 'page' : undefined}
                      >
                        {d.title}
                      </Link>,
                    ]
                  : [];
              },
            )}
          </div>
        )}
        {INDICATOR_GROUPS.map((group) => (
          <div key={group} className="indicator-group">
            <span className="sidebar-label">{group}</span>
            {matches
              .filter(
                (d) =>
                  d.group === group &&
                  (query ||
                    !['net:mvrv', 'view:rainbow', 'view:btc_rainbow', 'rsi', 'futures:funding']
                      .map(indicatorFamily)
                      .includes(indicatorFamily(d.id))),
              )
              .map((d) => (
                <Link
                  key={d.id}
                  to={indicatorUrl(asset, d.id, p)}
                  className={active.id === d.id ? 'active' : ''}
                  aria-current={active.id === d.id ? 'page' : undefined}
                >
                  {d.title}
                  <small>{d.unit.replace('자산 단위', asset).replace('자산', asset)}</small>
                </Link>
              ))}
          </div>
        ))}
        {!matches.length && <p role="status">이 코인에 지원되는 검색 결과가 없습니다.</p>}
      </nav>
      <nav className="nav-utilities" onClick={onNavigate}>
        <Link to={'/learn?' + p}>분석 사전</Link>
        <Link to="/status">데이터 · 자동 갱신</Link>
        <Link to="/workspace/library">개인 자료함</Link>
      </nav>
    </div>
  );
}
