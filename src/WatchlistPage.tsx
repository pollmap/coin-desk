import { marketAnalysisLink } from '../shared/market-watch';
import { DAY } from '../shared/math';
import { matchesCoin } from '../shared/coin-search';
import { useMarket } from './useMarket';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, RefreshCw } from 'lucide-react';
import { MarketNavigation } from './MarketNavigation';
import { NETWORK_ASSETS } from '../shared/network-catalog';
import { useSearchParams } from 'react-router-dom';
import { useData } from './hooks';
import type { MarketDerivatives } from '../shared/market-derivatives';
import { ASSETS } from '../shared/catalog';
import { AssetLogo } from './AssetLogo';
import type { Asset, Market, Overview } from '../shared/types';
import { dateLabel, json, money, numeric, turnover } from './lib';
import { usePersonalDesk } from './PersonalDesk';

export function WatchlistPage() {
  const { market, changeMarket } = useMarket();
  const { desk, update } = usePersonalDesk();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'all' ? 'all' : 'core';
  const derivatives = params.get('view') === 'derivatives';
  const futures = useData<MarketDerivatives>(
    derivatives ? '/api/v1/market-derivatives' : null,
    false,
    300000,
  );
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [sort, setSort] = useState('default');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    market: Market;
    quotes: Partial<Record<Asset, Overview>>;
    errors: Partial<Record<Asset, string>>;
    loading: boolean;
  }>({ market, quotes: {}, errors: {}, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (document.hidden || busy || controller.signal.aborted) return;
      busy = true;
      setState((prev) =>
        prev.market === market
          ? { ...prev, loading: true }
          : { market, quotes: {}, errors: {}, loading: true },
      );
      const quotes: Partial<Record<Asset, Overview>> = {},
        errors: Partial<Record<Asset, string>> = {};
      let cursor = 0;
      await Promise.all(
        [0, 1].map(async () => {
          while (cursor < ASSETS.length && !controller.signal.aborted) {
            const asset = ASSETS[cursor++].id;
            try {
              const received = await json<Overview>(
                '/api/v1/overview?asset=' + asset + '&market=' + market,
                controller.signal,
              );
              quotes[asset] = received;
              if (!controller.signal.aborted)
                setState((prev) => ({
                  market,
                  quotes: { ...(prev.market === market ? prev.quotes : {}), [asset]: received },
                  errors: { ...(prev.market === market ? prev.errors : {}), [asset]: undefined },
                  loading: true,
                }));
            } catch (e) {
              errors[asset] = e instanceof Error ? e.message : String(e);
              if (!controller.signal.aborted)
                setState((prev) => ({
                  ...prev,
                  errors: { ...prev.errors, [asset]: errors[asset] },
                }));
            }
          }
        }),
      );
      if (!controller.signal.aborted)
        setState((prev) => ({
          market,
          quotes: { ...(prev.market === market ? prev.quotes : {}), ...quotes },
          errors,
          loading: false,
        }));
      busy = false;
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [market, revision]);
  const quotes = state.market === market ? state.quotes : {};
  const errors = state.market === market ? state.errors : {};
  const assets = useMemo(
    () =>
      ASSETS.filter(
        (a) =>
          (search.trim() || scope === 'all' || ['BTC', 'DOGE', 'ETH'].includes(a.id)) &&
          (!onlyFavorites || desk.favorites.includes(a.id)) &&
          matchesCoin(a.id, search),
      ).sort((a, b) => {
        if (sort === 'default')
          return Number(desk.favorites.includes(b.id)) - Number(desk.favorites.includes(a.id));
        const qa = quotes[a.id]?.quote,
          qb = quotes[b.id]?.quote;
        if (!qa || !qb) return Number(!!qb) - Number(!!qa);
        if (sort !== 'volume' && (qa.change24h === null || qb.change24h === null))
          return Number(qb.change24h !== null) - Number(qa.change24h !== null);
        return sort === 'change'
          ? qb.change24h! - qa.change24h!
          : sort === 'decline'
            ? qa.change24h! - qb.change24h!
            : qb.volume24h - qa.volume24h;
      }),
    [desk.favorites, onlyFavorites, search, sort, quotes, scope],
  );
  const currency = market === 'upbit' ? 'KRW' : 'USDT';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>코인 시세</h1>
        </div>
      </div>
      <MarketNavigation
        current="coins"
        market={market}
        assets={desk.favorites.length >= 2 ? desk.favorites : undefined}
      />
      <div className="market-scope" role="group" aria-label="표시할 코인">
        {(['core', 'all'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={scope === value}
            onClick={() =>
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('scope', value);
                next.set('market', market);
                return next;
              })
            }
          >
            {value === 'core' ? 'BTC · DOGE · ETH' : '전체 8개'}
          </button>
        ))}
        <div className="market-view" role="group" aria-label="비교할 데이터">
          {[
            ['spot', '시세·기술'],
            ['derivatives', '선물 수급'],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={derivatives === (value === 'derivatives')}
              onClick={() =>
                setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('view', value);
                  return next;
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="explorer-toolbar">
        <label>
          코인 찾기
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="DOGE 또는 도지코인"
          />
        </label>
        <label>
          시장
          <select value={market} onChange={(e) => changeMarket(e.target.value as Market)}>
            <option value="binance">Binance · USDT</option>
            <option value="upbit">Upbit · KRW</option>
          </select>
        </label>
        <label>
          정렬
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="default">즐겨찾기 우선</option>
            <option value="change">24H 상승률 순</option>
            <option value="decline">24H 하락률 순</option>
            <option value="volume">거래대금 순</option>
          </select>
        </label>
        <button
          className="desk-button"
          aria-pressed={onlyFavorites}
          onClick={() => setOnlyFavorites(!onlyFavorites)}
        >
          <Star size={15} />
          즐겨찾기만
        </button>
        <button
          className="desk-button"
          disabled={state.loading}
          aria-label="코인 목록 새로고침"
          onClick={() => {
            setRevision((v) => v + 1);
            if (derivatives) futures.reload();
          }}
        >
          <RefreshCw size={15} />
          {state.loading ? '조회 중' : '새로고침'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="error-notice">
          {error}
        </p>
      ) : null}
      <p className="watch-note">
        {derivatives
          ? '현재가 1분 · 선물 Bybit USDT 무기한 · 펀딩은 확정 정산, 롱·숏은 계정 수 비중'
          : '1분 자동 갱신 · RSI·200일선은 확정 일봉 기준'}
      </p>
      {derivatives && futures.error && (
        <p role="status" className="refresh-notice">
          선물 갱신 지연 · 마지막 자료를 유지합니다.{' '}
          <button onClick={futures.reload}>다시 시도</button>
        </p>
      )}
      <div
        className="panel watch-table-wrap"
        tabIndex={0}
        aria-label={derivatives ? '코인별 시세와 Bybit 선물 수급' : '코인별 시세와 기술지표'}
      >
        <table className="watch-table">
          <caption className="sr-only">
            {derivatives
              ? '코인별 현재 시세와 Bybit 선물 수급'
              : '코인별 현재 시세와 확정 일봉 기술지표'}
          </caption>
          <thead>
            <tr>
              <th>즐겨찾기</th>
              <th>자산</th>
              <th>가격 · {currency}</th>
              <th>24H 변동</th>
              <th>{derivatives ? '확정 펀딩률' : '24H 거래대금'}</th>
              <th>{derivatives ? '미결제약정 · 코인 수량' : 'RSI 14'}</th>
              <th>{derivatives ? '롱 / 숏 계정 비중' : '200일선 대비'}</th>
              <th>분석</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const overview = quotes[a.id],
                q = overview?.quote;
              const stale =
                !!errors[a.id] || overview?.meta.stale || (!!q && Date.now() / 1000 - q.time > 420);
              const technicalTime = overview?.technical.asOf;
              const technicalDelayed =
                !!overview && (!technicalTime || Date.now() / 1000 - technicalTime > 3 * DAY);
              const technicalTitle = technicalTime
                ? '확정 일봉 ' + dateLabel(technicalTime)
                : '지표 기준일 확인 중';
              const gap =
                q && overview?.technical.sma200
                  ? 100 * (q.price / overview.technical.sma200 - 1)
                  : null;
              return (
                <tr key={a.id}>
                  <td>
                    <button
                      className="star-button"
                      aria-label={a.name + ' 즐겨찾기'}
                      aria-pressed={desk.favorites.includes(a.id)}
                      onClick={() => {
                        try {
                          update((d) => ({
                            ...d,
                            favorites: d.favorites.includes(a.id)
                              ? d.favorites.filter((id) => id !== a.id)
                              : [...d.favorites, a.id],
                          }));
                          setError('');
                        } catch (e) {
                          setError(String(e instanceof Error ? e.message : e));
                        }
                      }}
                    >
                      <Star
                        size={18}
                        fill={desk.favorites.includes(a.id) ? 'currentColor' : 'none'}
                      />
                    </button>
                  </td>
                  <td className="watch-asset">
                    <Link to={marketAnalysisLink(a.id, market)}>
                      <AssetLogo asset={a.id} size={22} /> <b>{a.id}</b>
                      <small>{a.name}</small>
                    </Link>
                  </td>
                  <td title={q ? '가격 시각 ' + dateLabel(q.time, true) : undefined}>
                    {money(q?.price, currency)}
                    {stale ? (
                      <small className="amber" title={errors[a.id] || overview?.meta.warning}>
                        {q ? '갱신 지연 · 보관값' : '조회 실패'}
                      </small>
                    ) : !q ? (
                      <small>{errors[a.id] ? '조회 실패' : '연결 중'}</small>
                    ) : null}
                  </td>
                  <td
                    className={q?.change24h == null ? 'muted' : q.change24h < 0 ? 'down' : 'up'}
                    title={q?.changeUnavailableReason}
                  >
                    {q?.change24h != null
                      ? (q.change24h >= 0 ? '+' : '') + numeric(q.change24h) + '%'
                      : '—'}
                    {q?.changeUnavailableReason ? (
                      <small>24H 계산 불가</small>
                    ) : q?.changeBasis === 'rolling24h-minute' ? (
                      <small>24H≈</small>
                    ) : null}
                  </td>
                  {derivatives ? (
                    (['funding', 'open_interest', 'long_account_ratio'] as const).map((metric) => {
                      const point = futures.data?.data.find((row) => row.asset === a.id)?.[metric];
                      const label = {
                        funding: '확정 펀딩률',
                        open_interest: '미결제약정',
                        long_account_ratio: '롱 / 숏 계정 비중',
                      }[metric];
                      const delayed = point?.stale || !!futures.error;
                      return (
                        <td key={metric} data-label={label}>
                          <Link
                            className="market-metric-link"
                            aria-label={a.name + ' ' + label + ' 차트'}
                            title={
                              point ? 'Bybit · ' + dateLabel(point.time, true) : 'Bybit · 관측 대기'
                            }
                            to={
                              '/futures/' +
                              a.id +
                              marketAnalysisLink(a.id, market).slice(1) +
                              '&panels=futures%3A' +
                              metric
                            }
                          >
                            {!point
                              ? '—'
                              : metric === 'funding'
                                ? (point.value > 0 ? '+' : '') + numeric(point.value, 4) + '%'
                                : metric === 'open_interest'
                                  ? numeric(point.value, 0) + ' ' + a.id
                                  : numeric(point.value, 1) +
                                    '% / ' +
                                    numeric(100 - point.value, 1) +
                                    '%'}
                            {point && metric === 'long_account_ratio' && (
                              <span className="account-ratio-track" aria-hidden="true">
                                <i style={{ width: point.value + '%' }} />
                              </span>
                            )}
                          </Link>
                          {delayed ? (
                            <small className="amber">갱신 지연 · 보관값</small>
                          ) : !point ? (
                            <small>{futures.loading ? '조회 중' : '관측 대기'}</small>
                          ) : null}
                        </td>
                      );
                    })
                  ) : (
                    <>
                      <td data-label="24H 거래대금">{turnover(q?.volume24h, currency)}</td>
                      <td data-label="RSI 14" title={technicalTitle}>
                        {numeric(overview?.technical.rsi)}
                        {technicalDelayed ? <small className="amber">지표 갱신 지연</small> : null}
                      </td>
                      <td
                        data-label="200일선 대비"
                        title={technicalTitle}
                        className={gap === null ? 'muted' : gap < 0 ? 'down' : 'up'}
                      >
                        {gap === null ? '—' : (gap >= 0 ? '+' : '') + numeric(gap) + '%'}
                        {technicalDelayed ? (
                          <small className="amber">
                            {technicalTime ? dateLabel(technicalTime) + ' 기준' : '기준일 확인 중'}
                          </small>
                        ) : null}
                      </td>
                    </>
                  )}
                  <td className="watch-analysis">
                    <Link to={marketAnalysisLink(a.id, market)} aria-label={a.name + ' 차트 열기'}>
                      차트
                    </Link>
                    {NETWORK_ASSETS.some((id) => id === a.id) && (
                      <Link
                        to={'/onchain/' + a.id + marketAnalysisLink(a.id, market).slice(1)}
                        aria-label={a.name + ' 온체인 열기'}
                      >
                        온체인
                      </Link>
                    )}
                    <Link
                      to={'/futures/' + a.id + marketAnalysisLink(a.id, market).slice(1)}
                      aria-label={a.name + ' 선물 열기'}
                    >
                      선물
                    </Link>
                    {q && <small className="sr-only">가격 시각 {dateLabel(q.time, true)}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!assets.length ? (
          <div className="empty-state">
            조건에 맞는 코인이 없습니다. 검색어나 즐겨찾기 필터를 바꿔 주세요.
          </div>
        ) : null}
      </div>
    </>
  );
}
