import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Star, Search } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import { matchesCoin } from '../shared/coin-search';
import { assetDefinition, availableMarket } from '../shared/asset-registry';
import { defaultIndicator, indicatorDefinition, indicatorUrl } from '../shared/indicator-catalog';
import type { Asset, Point } from '../shared/types';
import { AssetLogo } from './AssetLogo';
import { useQuoteFeed } from './useQuoteFeed';
import { useMarket } from './useMarket';
import { usePersonalDesk } from './PersonalDesk';
import { money, numeric, saved, save, turnover } from './lib';
const ThemeExplorer = lazy(() => import('./ThemeExplorer'));

function Spark({ points }: { points: Point[] }) {
  if (points.length < 2) return <span className="muted">이력 대기</span>;
  const values = points.map((p) => p.value),
    min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  const line = values
    .map((v, i) => `${(i * 110) / (values.length - 1)},${29 - ((v - min) / span) * 25}`)
    .join(' ');
  return (
    <svg
      viewBox="0 0 110 34"
      width="110"
      height="34"
      role="img"
      aria-label={`최근 ${points.length}개 확정 일봉 흐름`}
    >
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
const changeText = (value: number | null | undefined) =>
  value == null ? '—' : `${value > 0 ? '+' : ''}${numeric(value)}%`;
export function MarketHome() {
  const navigate = useNavigate();
  const [saveError, setSaveError] = useState('');
  const { market, changeMarket } = useMarket();
  const [pageSize] = useState(() => (window.matchMedia('(max-width: 767px)').matches ? 20 : 50));
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.max(pageSize, Math.min(150, saved('market-visible-count', pageSize))),
  );
  const [subscribed, setSubscribed] = useState<string[]>([]);
  const feed = useQuoteFeed(market, { assets: subscribed, sparkLimit: pageSize === 20 ? 0 : 150 });
  const { desk, update } = usePersonalDesk();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') || saved('market-sort', 'default');
  const requestedView = params.get('view') ?? saved('market-view', 'all');
  const view = ['favorites', 'themes'].includes(requestedView) ? requestedView : 'all';
  const query = params.get('q') ?? '';
  const filterKey = [query, view, market, sort, pageSize].join('|');
  const previousFilter = useRef(filterKey);
  useEffect(() => {
    if (previousFilter.current !== filterKey) {
      setVisibleCount(pageSize);
      save('market-visible-count', pageSize);
      previousFilter.current = filterKey;
    }
  }, [filterKey, pageSize]);
  const [sortRevision, setSortRevision] = useState(0);
  const [recent] = useState(() => saved<Asset[]>('recent-coins', []));
  const [resume] = useState(() => saved<{ href?: string; asset?: string }>('recent-analysis', {}));
  const resumeHref =
    typeof resume.href === 'string' &&
    ASSETS.some((a) => resume.href!.split('?')[0] === '/coins/' + a.id)
      ? resume.href
      : null;
  const unit = market === 'upbit' ? 'KRW' : 'USDT';
  const scroll = useRef(saved('market-scroll', 0));
  useLayoutEffect(() => {
    window.scrollTo(0, scroll.current);
  }, [!!feed.data]);
  useEffect(() => {
    const track = () => {
      scroll.current = window.scrollY;
      save('market-scroll', scroll.current);
    };
    window.addEventListener('scroll', track);
    return () => window.removeEventListener('scroll', track);
  }, []);
  const href = (asset: Asset) =>
    indicatorUrl(
      asset,
      defaultIndicator(asset),
      new URLSearchParams({
        price_source: availableMarket(asset, market),
        market: availableMarket(asset, market),
      }),
    );
  // Capture ordering on entry or explicit sorting only. Live ticks update values,
  // never move a row underneath a pointer or keyboard focus.
  const order = useMemo(
    () =>
      ASSETS.map((a) => ({ ...a, data: feed.rows.find((r) => r.asset === a.id) }))
        .sort((a, b) =>
          sort === 'change'
            ? (b.data?.quote?.change24h ?? -Infinity) - (a.data?.quote?.change24h ?? -Infinity)
            : sort === 'volume'
              ? (b.data?.quote?.volume24h ?? -Infinity) - (a.data?.quote?.volume24h ?? -Infinity)
              : 0,
        )
        .map((a) => a.id),
    [market, sort, !!feed.data, sortRevision],
  );
  const filtered = order
    .filter(
      (id) =>
        (!query || matchesCoin(id, query)) &&
        (query || view === 'favorites' || assetDefinition(id)?.markets[market]),
    )
    .filter((id) => view !== 'favorites' || desk.favorites.includes(id));
  const visible = filtered.slice(0, visibleCount);
  const subscription = [...new Set([...visible, ...desk.favorites])]
    .filter((id) => assetDefinition(id)?.markets[market])
    .sort()
    .join(',');
  useEffect(() => setSubscribed(subscription.split(',').filter(Boolean)), [subscription]);
  const rows = visible.map((id) => ({
    ...ASSETS.find((a) => a.id === id)!,
    data: feed.rows.find((r) => r.asset === id),
  }));
  const starred = desk.favorites;
  const favorite = (asset: Asset) => {
    try {
      update((current) => ({
        ...current,
        favorites: current.favorites.includes(asset)
          ? current.favorites.filter((a) => a !== asset)
          : [...current.favorites, asset],
      }));
      setSaveError('');
    } catch {
      setSaveError('관심 코인을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');
    }
  };
  return (
    <div className="market-home">
      <div className="market-body">
        <div className="market-heading">
          <h1>시장</h1>
          <span className="market-feed-state">
            {feed.rows.some((row) => row.live)
              ? '실시간 가격'
              : feed.rows.length && feed.rows.every((row) => row.stale)
                ? '시세 갱신 지연'
                : '1분마다 갱신'}
          </span>
        </div>
        <div className="market-view-tabs" role="group" aria-label="시장 보기">
          {(
            [
              ['all', '전체'],
              ['favorites', '관심'],
              ['themes', '테마'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={view === key}
              onClick={() =>
                setParams((p) => {
                  save('market-view', key);
                  p.set('view', key);
                  if (key !== 'themes') p.delete('theme');
                  return p;
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        {view !== 'themes' && (
          <label className="market-search">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="시장 코인 검색"
              placeholder="코인 이름·티커 검색"
              value={query}
              onChange={(e) =>
                setParams(
                  (p) => {
                    if (e.target.value) p.set('q', e.target.value);
                    else p.delete('q');
                    return p;
                  },
                  { replace: true },
                )
              }
            />
          </label>
        )}
        {feed.data?.collection && !feed.data.collection.healthy && (
          <p className="market-runtime-notice" role="status">
            {['no_execution_ledger', 'not_started'].includes(feed.data.collection.reason || '')
              ? '시세 갱신을 확인하고 있습니다.'
              : '시세 갱신이 지연되고 있습니다.'}{' '}
            <Link to="/status">데이터 상태</Link>
          </p>
        )}
        {resumeHref && (
          <p className="market-resume">
            <Link to={resumeHref}>{resume.asset} 분석 이어 보기</Link>
          </p>
        )}
        <div className="market-controls">
          <div role="group" aria-label="시세 거래소">
            <button aria-pressed={market === 'upbit'} onClick={() => changeMarket('upbit')}>
              Upbit · 원화
            </button>
            <button aria-pressed={market === 'binance'} onClick={() => changeMarket('binance')}>
              Binance · USDT
            </button>
          </div>
          {view !== 'themes' && (
            <label>
              정렬{' '}
              <select
                value={sort}
                onChange={(e) => {
                  save('market-sort', e.target.value);
                  setParams((p) => {
                    p.set('sort', e.target.value);
                    return p;
                  });
                }}
              >
                <option value="default">기본 순서</option>
                <option value="change">상승률</option>
                <option value="volume">거래대금</option>
              </select>
            </label>
          )}
          {view !== 'themes' && sort !== 'default' && (
            <button onClick={() => setSortRevision((v) => v + 1)}>지금 값으로 정렬</button>
          )}
        </div>
        {saveError && <p role="alert">{saveError}</p>}
        {feed.error && (
          <div className="error-notice" role="alert">
            시세를 가져오지 못했습니다. <button onClick={feed.reload}>다시 시도</button>
          </div>
        )}
        {!feed.error && feed.loading && !feed.data && <p role="status">시세를 불러오는 중…</p>}
        {view === 'themes' ? (
          <Suspense fallback={<p role="status">테마를 여는 중…</p>}>
            <ThemeExplorer
              selected={params.get('theme')}
              onSelect={(id) =>
                setParams((p) => {
                  if (id) p.set('theme', id);
                  else p.delete('theme');
                  return p;
                })
              }
              href={href}
            />
          </Suspense>
        ) : (
          <div className="market-table-wrap">
            <table className="market-table">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">관심</span>
                  </th>
                  <th>코인</th>
                  <th>
                    현재 가격 <small>{unit}</small>
                  </th>
                  <th>24시간 변동</th>
                  <th>24시간 거래대금</th>
                  <th>최근 30일</th>
                  <th>분석</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id, name, data: r }) => (
                  <tr
                    key={id}
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('a,button,details'))
                        navigate(href(id));
                    }}
                  >
                    <td className="market-favorite-cell">
                      <button
                        className="favorite-button"
                        aria-label={`${name} 관심 코인`}
                        aria-pressed={starred.includes(id)}
                        onClick={() => favorite(id)}
                      >
                        <Star size={17} fill={starred.includes(id) ? 'currentColor' : 'none'} />
                      </button>
                    </td>
                    <th scope="row" className="market-coin-cell">
                      <Link to={href(id)}>
                        <AssetLogo asset={id} size={32} />
                        <span>
                          <span className="market-coin-name" title={name}>
                            {name}
                          </span>
                          <small>
                            {id}
                            {!assetDefinition(id)?.markets[market] &&
                              ` · ${availableMarket(id, market) === 'binance' ? 'Binance USDT' : 'Upbit KRW'}`}
                          </small>
                        </span>
                      </Link>
                    </th>
                    <td className="market-price-cell">
                      <Link to={href(id)}>
                        {r?.status === 'unsupported'
                          ? '다른 거래소에서 보기'
                          : money(r?.displayPrice, unit)}
                      </Link>
                      {r?.displayTime && (r.stale || r.status === 'error') ? (
                        <small className="stale-label">
                          {r.status === 'error' ? '확인 실패' : '갱신 지연'}
                        </small>
                      ) : (
                        !r?.displayTime &&
                        r?.status !== 'unsupported' && (
                          <small>
                            {feed.error ? '확인 필요' : feed.loading ? '불러오는 중' : '수집 대기'}
                          </small>
                        )
                      )}
                    </td>
                    <td
                      className={
                        'market-change-cell ' + ((r?.quote?.change24h ?? 0) >= 0 ? 'up' : 'down')
                      }
                    >
                      <span className="market-mobile-change-label">24시간 </span>
                      {changeText(r?.quote?.change24h)}
                    </td>
                    <td className="market-volume-cell">{turnover(r?.quote?.volume24h, unit)}</td>
                    <td className="market-spark">
                      <Spark points={r?.spark ?? []} />
                    </td>
                    <td className="market-analysis-cell">
                      <Link
                        to={href(id)}
                        aria-label={`${name} ${indicatorDefinition(defaultIndicator(id))?.title} 분석`}
                      >
                        {defaultIndicator(id) === 'rsi' ? '추세 · RSI 14' : '가치평가 · MVRV'} ↗
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="market-empty">
                {query
                  ? '일치하는 코인이 없습니다.'
                  : '관심 코인이 없습니다. 전체에서 별을 눌러 추가하세요.'}
              </p>
            )}
            {filtered.length > visibleCount && (
              <button
                className="market-more"
                onClick={() => {
                  const count = Math.min(150, visibleCount + pageSize);
                  setVisibleCount(count);
                  save('market-visible-count', count);
                }}
              >
                더 보기
              </button>
            )}
          </div>
        )}
        <details className="market-data-note">
          <summary>시세 기준</summary>
          <p>
            변동률·거래대금은 1분마다 확인합니다. 최근 30일은 확정 일봉입니다. 선택한 거래소의
            시세만 표시합니다.
          </p>
        </details>
      </div>
      <aside className="market-rail" aria-label="내 관심 코인">
        <h2>관심 코인</h2>
        {!starred.length && (
          <div className="market-empty">
            <p>별을 눌러 추가하세요.</p>
          </div>
        )}
        {ASSETS.filter((a) => starred.includes(a.id)).map((a) => (
          <Link key={a.id} to={href(a.id)}>
            <AssetLogo asset={a.id} size={25} />
            <span>
              {a.name}
              <small>{a.id}</small>
            </span>
            <b>{money(feed.rows.find((r) => r.asset === a.id)?.displayPrice, unit)}</b>
          </Link>
        ))}
        {recent.length > 0 && (
          <>
            <h2>최근 본 코인</h2>
            {recent
              .map((id) => ASSETS.find((a) => a.id === id))
              .filter((a) => !!a)
              .map((a) => (
                <Link key={a.id} to={href(a.id)}>
                  <AssetLogo asset={a.id} size={24} />
                  {a.name}
                  <small>{a.id}</small>
                </Link>
              ))}
          </>
        )}
      </aside>
    </div>
  );
}
