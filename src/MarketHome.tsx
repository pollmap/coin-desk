import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import { defaultIndicator, indicatorUrl } from '../shared/indicator-catalog';
import type { Asset, Point } from '../shared/types';
import { AssetLogo } from './AssetLogo';
import { useQuoteFeed } from './useQuoteFeed';
import { useMarket } from './useMarket';
import { usePersonalDesk } from './PersonalDesk';
import { dateLabel, money, numeric, saved, save, turnover } from './lib';

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
  const feed = useQuoteFeed(market);
  const { desk, update } = usePersonalDesk();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') || saved('market-sort', 'default');
  const recent = saved<Asset[]>('recent-coins', []);
  const unit = market === 'upbit' ? 'KRW' : 'USDT';
  const scroll = useRef(saved('market-scroll', 0));
  useLayoutEffect(() => {
    window.scrollTo(0, scroll.current);
  }, [feed.data]);
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
      new URLSearchParams({ price_source: market, market }),
    );
  const rows = ASSETS.map((a) => ({ ...a, data: feed.rows.find((r) => r.asset === a.id) })).sort(
    (a, b) =>
      sort === 'change'
        ? (b.data?.quote?.change24h ?? -Infinity) - (a.data?.quote?.change24h ?? -Infinity)
        : sort === 'volume'
          ? (b.data?.quote?.volume24h ?? -Infinity) - (a.data?.quote?.volume24h ?? -Infinity)
          : 0,
  );
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
          <h1>코인 시장</h1>
          <span className="market-feed-state">
            {feed.rows.some((row) => row.live)
              ? '가격 초 단위 갱신'
              : feed.rows.length && feed.rows.every((row) => row.stale)
                ? '시세 갱신 지연'
                : '화면 1분마다 확인'}{' '}
            · {market === 'upbit' ? 'Upbit' : 'Binance'} {unit}
          </span>
        </div>
        {feed.data?.collection && !feed.data.collection.healthy && (
          <p className="market-runtime-notice" role="status">
            {['no_execution_ledger', 'not_started'].includes(feed.data.collection.reason || '')
              ? '수집기 실행 기록이 없습니다. 마지막 저장 시세를 표시합니다.'
              : '분 단위 수집의 정상 실행을 확인하지 못했습니다. 표시된 체결 시각을 확인해 주세요.'}{' '}
            <Link to="/status">데이터 상태</Link>
          </p>
        )}
        <section className="market-leaders" aria-label="주요 코인">
          {ASSETS.slice(0, 3).map((a) => {
            const row = feed.rows.find((r) => r.asset === a.id);
            return (
              <Link to={href(a.id)} key={a.id} className="market-leader">
                <span>
                  <AssetLogo asset={a.id} size={24} />
                  {a.name}
                  <small>{a.id}</small>
                </span>
                <strong>{money(row?.displayPrice, unit)}</strong>
                <span className={(row?.quote?.change24h ?? 0) >= 0 ? 'up' : 'down'}>
                  {changeText(row?.quote?.change24h)}
                  <small>24시간</small>
                  {row?.stale && <small className="stale-label">갱신 지연</small>}
                </span>
              </Link>
            );
          })}
        </section>
        <div className="market-controls">
          <div role="group" aria-label="시세 거래소">
            <button aria-pressed={market === 'upbit'} onClick={() => changeMarket('upbit')}>
              Upbit · 원화
            </button>
            <button aria-pressed={market === 'binance'} onClick={() => changeMarket('binance')}>
              Binance · USDT
            </button>
          </div>
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
        </div>
        {saveError && <p role="alert">{saveError}</p>}
        {feed.error && (
          <div className="error-notice" role="alert">
            시세를 가져오지 못했습니다. <button onClick={feed.reload}>다시 시도</button>
          </div>
        )}
        {feed.loading && !feed.data && <p role="status">시세를 불러오는 중…</p>}
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
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, name, data: r }) => (
                <tr
                  key={id}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('a,button')) navigate(href(id));
                  }}
                >
                  <td>
                    <button
                      className="favorite-button"
                      aria-label={`${name} 관심 코인`}
                      aria-pressed={starred.includes(id)}
                      onClick={() => favorite(id)}
                    >
                      <Star size={17} fill={starred.includes(id) ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  <th scope="row">
                    <Link to={href(id)}>
                      <AssetLogo asset={id} size={32} />
                      <span>
                        {name}
                        <small>{id}</small>
                      </span>
                    </Link>
                  </th>
                  <td>
                    <Link to={href(id)}>{money(r?.displayPrice, unit)}</Link>
                    <small className={r?.stale ? 'stale-label' : 'muted'}>
                      {r?.displayTime
                        ? `${r.status === 'error' ? '분 단위 확인 실패 · ' : r.stale ? '갱신 지연 · ' : ''}${dateLabel(r.displayTime, true)}`
                        : feed.loading
                          ? '불러오는 중'
                          : r?.status === 'unsupported'
                            ? '거래 미지원'
                            : r?.status === 'error'
                              ? '시세 확인 필요'
                              : '수집 대기'}
                    </small>
                  </td>
                  <td className={(r?.quote?.change24h ?? 0) >= 0 ? 'up' : 'down'}>
                    {changeText(r?.quote?.change24h)}
                  </td>
                  <td>{turnover(r?.quote?.volume24h, unit)}</td>
                  <td
                    className={
                      (r?.spark.at(-1)?.value ?? 0) >= (r?.spark[0]?.value ?? 0) ? 'up' : 'down'
                    }
                  >
                    <Spark points={r?.spark ?? []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="market-footnote">
          변동률·거래대금은 1분 단위 확인값입니다. 최근 흐름은 확정 일봉이며, 거래소별 가격과
          거래대금은 합산하지 않습니다.
        </p>
      </div>
      <aside className="market-rail" aria-label="내 관심 코인">
        <h2>관심 코인</h2>
        {!starred.length && (
          <div className="market-empty">
            <img src="/brand/coin-desk-shiba-smile.png" alt="" width="64" height="64" />
            <p>별을 눌러 자주 보는 코인을 모아보세요.</p>
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
        <h2>최근 본 코인</h2>
        {recent.length ? (
          recent
            .map((id) => ASSETS.find((a) => a.id === id))
            .filter((a) => !!a)
            .map((a) => (
              <Link key={a.id} to={href(a.id)}>
                <AssetLogo asset={a.id} size={24} />
                {a.name}
                <small>{a.id}</small>
              </Link>
            ))
        ) : (
          <p className="muted">코인을 열면 여기에 남습니다.</p>
        )}
        <Link className="market-learn" to="/learn">
          지표가 궁금하다면 · 지표 사전
        </Link>
      </aside>
    </div>
  );
}
