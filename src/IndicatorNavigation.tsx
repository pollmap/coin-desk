import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import {
  INDICATOR_GROUPS,
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
  const visibleMatches = matches.filter((d) => query.trim() || d.group === group);
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
      <nav aria-label="지표 목록">
        {INDICATOR_GROUPS.filter((g) => visibleMatches.some((d) => d.group === g)).map((group) => (
          <div key={group} className="indicator-group">
            <span className="sidebar-label">{group}</span>
            {matches
              .filter((d) => d.group === group)
              .map((d) => (
                <Link
                  key={d.id}
                  to={indicatorUrl(asset, d.id, p)}
                  onClick={onNavigate}
                  className={active.id === d.id ? 'active' : ''}
                  aria-current={active.id === d.id ? 'page' : undefined}
                >
                  {d.title}
                  <small>{d.unit.replace('자산 단위', asset).replace('자산', asset)}</small>
                </Link>
              ))}
          </div>
        ))}
        {!visibleMatches.length && (
          <div className="indicator-no-results" role="status">
            <p>
              {query.trim()
                ? `${asset}에서 “${query.trim()}”에 맞는 지표가 없습니다.`
                : `${asset}의 ${group} 지표는 현재 확보한 원천이 없습니다.`}
            </p>
            <button
              onClick={() => {
                setQuery('');
                setGroup('기술·성과');
              }}
            >
              가격으로 계산하는 지표 보기
            </button>
          </div>
        )}
      </nav>
      <nav className="nav-utilities" onClick={onNavigate}>
        <Link to={'/learn?' + p}>분석 사전</Link>
        <Link to="/status">데이터 · 자동 갱신</Link>
        <Link to="/workspace/library">개인 자료함</Link>
      </nav>
    </div>
  );
}
