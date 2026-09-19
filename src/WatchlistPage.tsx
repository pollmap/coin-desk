import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Star, RefreshCw } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import type { Asset, Market, Overview } from '../shared/types';
import { dateLabel, json, money, numeric } from './lib';
import { usePersonalDesk } from './PersonalDesk';

export function WatchlistPage() {
  const [params, setParams] = useSearchParams();
  const market: Market = params.get('market') === 'upbit' ? 'upbit' : 'binance';
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
              quotes[asset] = await json<Overview>(
                '/api/v1/overview?asset=' + asset + '&market=' + market,
                controller.signal,
              );
            } catch (e) {
              errors[asset] = e instanceof Error ? e.message : String(e);
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
          (!onlyFavorites || desk.favorites.includes(a.id)) &&
          (a.id + ' ' + a.name).toLowerCase().includes(search.toLowerCase().trim()),
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
          <div className="eyebrow">MARKET WATCH</div>
          <h1>관심 코인</h1>
          <p>즐겨찾기를 맨 위에 두고 가격·거래대금·기술지표를 함께 비교하세요.</p>
        </div>
        <Link
          className="desk-button"
          to={'/compare?assets=' + desk.favorites.join(',') + '&market=' + market}
        >
          즐겨찾기 성과 비교 ↗
        </Link>
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
          <select value={market} onChange={(e) => setParams({ market: e.target.value })}>
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
      <p className="watch-note">
        화면 60초 조회 · 공유 시세 약 3분 주기 · 별표와 작업공간은 브라우저에 저장됩니다.
        RSI·200일선은 확정 일봉 기준입니다.
      </p>
      <p className="watch-scroll-hint">
        표를 가로로 밀면 거래대금·기술지표·차트 링크를 볼 수 있습니다.
      </p>
      <div
        className="panel watch-table-wrap"
        tabIndex={0}
        aria-label="관심 코인 표. 좁은 화면에서는 가로로 이동할 수 있습니다."
      >
        <table className="watch-table">
          <caption className="sr-only">8개 관심 코인의 현재 시세와 기술지표</caption>
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
                  <td>
                    <b style={{ color: a.color }}>{a.id}</b>
                    <small>{a.name}</small>
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
                  <td>{q ? money(q.volume24h / 1e6, currency) + ' M' : '—'}</td>
                  <td>{numeric(overview?.technical.rsi)}</td>
                  <td className={gap !== null && gap < 0 ? 'down' : 'up'}>
                    {gap === null ? '—' : (gap >= 0 ? '+' : '') + numeric(gap) + '%'}
                  </td>
                  <td>
                    <small>{dateLabel(q?.time, true)}</small>
                  </td>
                  <td>
                    <Link to={'/chart/' + a.id + '?asset=' + a.id + '&market=' + market}>
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
