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
  path === '/' || /^\/(coins|chart|onchain|futures|metrics)\//.test(path);
export function IndicatorNavigation({ onNavigate }: { onNavigate: () => void }) {
  const location = useLocation(),
    p = new URLSearchParams(location.search);
  const asset =
    ASSETS.find((a) => a.id === location.pathname.split('/')[2])?.id ??
    ASSETS.find((a) => a.id === p.get('asset'))?.id ??
    'BTC';
  const active = resolveIndicator(asset, location.pathname, p);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>(active.definition?.group ?? INDICATOR_GROUPS[0]);
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
      <div className="indicator-group-tabs" role="group" aria-label="지표 분류">
        {INDICATOR_GROUPS.map((g) => (
          <button
            key={g}
            aria-pressed={g === group}
            onClick={() => {
              setGroup(g);
              setQuery('');
            }}
          >
            {g}
          </button>
        ))}
      </div>
      <nav aria-label="지표 목록" onClick={onNavigate}>
        {INDICATOR_GROUPS.filter((g) => query || g === group).map((group) => (
          <div key={group} className="indicator-group">
            <span className="sidebar-label">{group}</span>
            {matches
              .filter((d) => d.group === group)
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
