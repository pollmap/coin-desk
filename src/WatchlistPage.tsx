import { marketAnalysisLink } from '../shared/market-watch';
import { DAY } from '../shared/math';
import { matchesCoin } from '../shared/coin-search';
import { useMarket } from './useMarket';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, RefreshCw, ArrowLeftRight, ChartPie } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import { AssetLogo } from './AssetLogo';
import type { Asset, Market, Overview } from '../shared/types';
import { dateLabel, json, money, numeric, turnover } from './lib';
import { usePersonalDesk } from './PersonalDesk';

export function WatchlistPage() {
  const { market, changeMarket } = useMarket();
  const { desk, update } = usePersonalDesk();
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
        (a) => (!onlyFavorites || desk.favorites.includes(a.id)) && matchesCoin(a.id, search),
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
    [desk.favorites, onlyFavorites, search, sort, quotes],
  );
  const currency = market === 'upbit' ? 'KRW' : 'USDT';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>시장·비교</h1>
        </div>
        <nav className="watch-actions" aria-label="시장 분석">
          <Link
            className="desk-button"
            to={
              '/compare?assets=' +
              (desk.favorites.length >= 2 ? desk.favorites : ['BTC', 'DOGE', 'ETH']).join(',') +
              '&period=all&market=' +
              market
            }
          >
            <ArrowLeftRight size={16} /> 성과 비교
          </Link>
          <Link className="desk-button" to={'/dominance?market=' + market}>
            <ChartPie size={16} /> 시장 비중
          </Link>
        </nav>
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
          {onlyFavorites ? '즐겨찾기만' : '전체 코인'}
        </button>
        <button
          className="desk-button"
          disabled={state.loading}
          aria-label="코인 목록 새로고침"
          onClick={() => setRevision((v) => v + 1)}
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
      <p className="watch-note">1분 자동 갱신 · RSI·200일선은 확정 일봉 기준</p>
      <div className="panel watch-table-wrap" tabIndex={0} aria-label="코인별 시세와 기술지표">
        <table className="watch-table">
          <caption className="sr-only">코인별 현재 시세와 확정 일봉 기술지표</caption>
          <thead>
            <tr>
              <th>즐겨찾기</th>
              <th>자산</th>
              <th>가격 · {currency}</th>
              <th>24H 변동</th>
              <th>24H 거래대금</th>
              <th>RSI 14</th>
              <th>200일선 대비</th>
              <th>가격 시각 KST</th>
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
                      <AssetLogo asset={a.id} size={22} /> <b style={{ color: a.color }}>{a.id}</b>
                      <small>{a.name}</small>
                    </Link>
                  </td>
                  <td>
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
                  <td>
                    <small>{dateLabel(q?.time, true)}</small>
                  </td>
                  <td>
                    <Link to={marketAnalysisLink(a.id, market)} aria-label={a.name + ' 차트 열기'}>
                      차트 ↗
                    </Link>
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
