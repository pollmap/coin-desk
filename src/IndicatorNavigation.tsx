import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import { matchesIndicator } from '../shared/indicator-search';
import {
  navigationIndicators,
  indicatorUrl,
  resolveIndicator,
  indicatorUnit,
  INDICATOR_PURPOSES,
  type IndicatorDefinition,
} from '../shared/indicator-catalog';

const PURPOSES: readonly (readonly [string, string])[] = [
  ['all', '전체 지표'],
  ...INDICATOR_PURPOSES.map((value) => [value, value] as const),
];

export const isIndicatorRoute = (path: string) =>
  path === '/' || /^\/(coins|chart|onchain|futures|metrics)\//.test(path);
export function IndicatorNavigation({ onNavigate }: { onNavigate: () => void }) {
  const location = useLocation(),
    p = new URLSearchParams(location.search);
  const previousLocation = useRef(location.key);
  useEffect(() => {
    if (previousLocation.current !== location.key) {
      previousLocation.current = location.key;
      onNavigate();
    }
  }, [location.key, onNavigate]);
  const asset =
    ASSETS.find((a) => a.id === location.pathname.split('/')[2])?.id ??
    ASSETS.find((a) => a.id === p.get('asset'))?.id ??
    'BTC';
  const active = resolveIndicator(asset, location.pathname, p);
  const [query, setQuery] = useState('');
  const [purpose, setPurpose] = useState<string>(active.definition?.purpose ?? 'all');
  const matches = navigationIndicators(asset, active.id).filter(
    (d) => d.assets.includes(asset) && matchesIndicator(d, query),
  );
  const visibleMatches = matches.filter(
    (d) => query.trim() || purpose === 'all' || d.purpose === purpose,
  );
  const unitOf = (d: IndicatorDefinition) => indicatorUnit(asset, d.id);
  return (
    <div className="indicator-navigation">
      <label className="indicator-picker-search">
        <input
          type="text"
          aria-label="지표 검색"
          placeholder="지표명 또는 확인하고 싶은 내용"
          maxLength={100}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim()) setPurpose('all');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
        />
      </label>
      <label className="indicator-purpose-filter">
        <span>확인할 내용</span>
        <select
          aria-label="지표 목적"
          value={purpose}
          onChange={(e) => {
            setPurpose(e.target.value);
            setQuery('');
          }}
        >
          {PURPOSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <nav className="indicator-picker-results" aria-label="지표 목록">
        {visibleMatches.map((d) => (
          <Link
            key={d.id}
            to={
              active.id === d.id
                ? location.pathname + location.search
                : indicatorUrl(asset, d.id, p)
            }
            onClick={(event) => {
              if (
                active.id === d.id &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                onNavigate();
              }
            }}
            className={active.id === d.id ? 'active' : ''}
            aria-current={active.id === d.id ? 'page' : undefined}
            aria-label={d.title + ' ' + unitOf(d)}
            aria-describedby={`indicator-meaning-${asset}-${d.id.replace(':', '-')}`}
          >
            <span>
              <strong>{d.title}</strong>
              <small
                className="indicator-picker-description"
                id={`indicator-meaning-${asset}-${d.id.replace(':', '-')}`}
              >
                {d.shortMeaning}
              </small>
            </span>
            <span className="indicator-picker-meta">
              {active.id === d.id && <Check size={17} aria-label="선택됨" />}
              <small>{unitOf(d)}</small>
            </span>
          </Link>
        ))}
        {!visibleMatches.length && (
          <div className="indicator-no-results" role="status">
            <p>
              {query.trim()
                ? `${asset}에서 “${query.trim()}”에 맞는 지표가 없습니다.`
                : `${asset}에 제공하는 ${PURPOSES.find(([value]) => value === purpose)?.[1] ?? '선택'} 지표가 없습니다.`}
            </p>
            <button
              onClick={() => {
                setQuery('');
                setPurpose('가격과 추세');
              }}
            >
              가격으로 계산하는 지표 보기
            </button>
          </div>
        )}
      </nav>
      <nav className="nav-utilities">
        <Link to={'/learn?' + p}>분석 사전</Link>
        <Link to="/status">데이터 · 자동 갱신</Link>
        <Link to="/workspace/library">개인 자료함</Link>
      </nav>
    </div>
  );
}
