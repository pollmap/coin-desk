import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import { eventsForAsset, eventTime, type HistoryEvent } from '../shared/history-events';
import { eventPriceContext } from '../shared/event-price-context';
import { AssetHeader } from './AssetHeader';
import { useData } from './hooks';
import { dateLabel, money } from './lib';
import { closeHistory } from '../shared/price-history';
import type { Asset, CandleResponse, SeriesResponse } from '../shared/types';
import './history-workspace.css';
const LongHistoryChart = lazy(() =>
  import('./LongHistoryChart').then((m) => ({ default: m.LongHistoryChart })),
);

export function HistoryPage() {
  const [params] = useSearchParams();
  const asset = ASSETS.find((a) => a.id === params.get('asset'))?.id || 'BTC';
  return <HistoryWorkspace key={asset} asset={asset} />;
}

function HistoryWorkspace({ asset }: { asset: Asset }) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [includeMarket, setIncludeMarket] = useState(true);
  const log = params.get('log') !== '0';
  const [reverse, setReverse] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [focusRevision, setFocusRevision] = useState(0);
  const chartPanel = useRef<HTMLElement>(null);
  const allEvents = eventsForAsset(asset);
  // Filtering the list must not silently discard the chart the user is examining.
  const selected = allEvents.find((e) => e.id === params.get('event'));
  const events = allEvents.filter(
    (e) =>
      (includeMarket || e.assets.includes(asset)) &&
      (category === '전체' || e.category === category) &&
      (e.title + e.summary + e.date).toLowerCase().includes(query.trim().toLowerCase()),
  );
  if (reverse) events.reverse();
  const index = selected ? events.findIndex((e) => e.id === selected.id) : -1;
  const referenceAvailable = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'].includes(asset);
  const requestedSource = params.get('price_source');
  const source =
    requestedSource === 'upbit' || requestedSource === 'binance'
      ? requestedSource
      : referenceAvailable
        ? 'reference'
        : 'binance';
  const reference = source === 'reference';
  const currency = reference ? 'USD' : source === 'upbit' ? 'KRW' : 'USDT';
  const windowDays = [30, 90, 365].includes(Number(params.get('window')))
    ? Number(params.get('window'))
    : 90;
  const result = useData<SeriesResponse | CandleResponse>(
    reference
      ? `/api/v1/reference?asset=${asset}&limit=1000`
      : `/api/v1/candles?asset=${asset}&market=${source}&interval=1d&limit=1000`,
    true,
    900000,
  );
  const series = useMemo(
    () =>
      result.data
        ? reference
          ? (result.data as SeriesResponse)
          : closeHistory(result.data as CandleResponse)
        : undefined,
    [result.data, reference],
  );
  const context = useMemo(
    () => (selected && series ? eventPriceContext(series.data, selected, windowDays) : undefined),
    [series, selected, windowDays],
  );
  function update(key: string, value?: string, replace = false) {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('asset', asset);
        if (value === undefined) n.delete(key);
        else n.set(key, value);
        if (key === 'price_source' && (value === 'upbit' || value === 'binance'))
          n.set('market', value);
        return n;
      },
      { replace },
    );
  }
  function choose(event?: HistoryEvent) {
    update('event', event?.id);
    setFocusRevision((v) => v + 1);
    if (window.matchMedia('(max-width: 1100px)').matches)
      chartPanel.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
  }
  function clearFilters() {
    setQuery('');
    setCategory('전체');
    setIncludeMarket(true);
  }
  return (
    <div className="history-page">
      <AssetHeader
        asset={asset}
        current="events"
        subtitle="사건을 고르면 당시 차트가 열립니다"
        href={(a) =>
          '/history?' +
          new URLSearchParams({ asset: a, price_source: source, log: log ? '1' : '0' })
        }
      />
      <div className="history-workspace">
        <aside className="history-event-list" aria-label="역사 사건 선택">
          <div className="history-mobile-picker">
            <label htmlFor="history-event-select">사건 선택</label>
            <select
              id="history-event-select"
              value={selected?.id || ''}
              onChange={(e) => choose(allEvents.find((event) => event.id === e.target.value))}
            >
              <option value="">전체 역사와 가격</option>
              {allEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.date.slice(0, event.precision === 'month' ? 7 : 10)} · {event.title}
                </option>
              ))}
            </select>
            <button
              aria-expanded={listOpen}
              aria-controls="history-browse-list"
              onClick={() => setListOpen((v) => !v)}
            >
              {listOpen ? '목록 접기' : '목록·검색 열기'}
            </button>
          </div>
          <div
            id="history-browse-list"
            className={'history-browse-list' + (listOpen ? ' is-open' : '')}
          >
            <div className="history-list-heading">
              <h2>
                주요 사건 <span>{events.length}</span>
              </h2>
              <button
                onClick={() => setReverse((v) => !v)}
                aria-label={reverse ? '오래된순으로 정렬' : '최신순으로 정렬'}
              >
                {reverse ? '최신순 ↓' : '오래된순 ↑'}
              </button>
            </div>
            <input
              type="search"
              aria-label="역사 검색"
              placeholder="사건·연도 검색 · FTX, 2022…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="history-list-filters">
              <select
                aria-label="사건 분류"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {['전체', '탄생', '공급·반감기', '업그레이드', '거래소·위기', '제도·채택'].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={includeMarket}
                  onChange={(e) => setIncludeMarket(e.target.checked)}
                />
                시장 공통 사건
              </label>
            </div>
            <div className="history-event-scroll">
              {events.map((event) => (
                <button
                  key={event.id}
                  className="history-event-row"
                  aria-pressed={selected?.id === event.id}
                  onClick={() => choose(event)}
                >
                  <time>{event.precision === 'month' ? event.date.slice(0, 7) : event.date}</time>
                  <strong>{event.title}</strong>
                  <span>
                    {event.category}
                    {event.market ? ' · 시장 공통' : ''}
                    <b aria-hidden="true">↗</b>
                  </span>
                </button>
              ))}
              {!events.length && (
                <div className="empty-state">
                  <p>일치하는 사건이 없습니다.</p>
                  <button onClick={clearFilters}>검색·필터 초기화</button>
                </div>
              )}
            </div>
          </div>
        </aside>
        <section
          ref={chartPanel}
          className="panel event-chart history-event-detail"
          aria-label="사건과 가격 흐름"
        >
          <div className="panel-title">
            <div>
              <small>
                {selected
                  ? `${selected.precision === 'month' ? selected.date.slice(0, 7) : selected.date} · ${selected.category}`
                  : '전체 이력에서 시작하기'}
              </small>
              <h2 aria-live="polite">{selected?.title || `${asset} 가격으로 보는 역사`}</h2>
            </div>
            <div className="event-chart-actions">
              <button
                aria-label="이전 사건"
                disabled={index <= 0}
                onClick={() => choose(events[index - 1])}
              >
                ← 이전
              </button>
              <button
                aria-label="다음 사건"
                disabled={index < 0 || index >= events.length - 1}
                onClick={() => choose(events[index + 1])}
              >
                다음 →
              </button>
            </div>
          </div>
          {selected ? (
            <p className="event-summary">
              {selected.summary}{' '}
              <a href={selected.source} target="_blank" rel="noreferrer">
                {selected.sourceName} ↗
              </a>
            </p>
          ) : (
            <p className="event-summary">
              목록에서 사건을 선택하면 당시 가격과 전후 흐름을 함께 볼 수 있습니다.
            </p>
          )}
          {selected && index < 0 && (
            <p className="event-note">
              선택한 사건은 현재 검색·필터 밖에 있습니다.{' '}
              <button onClick={clearFilters}>목록에 표시</button>
            </p>
          )}
          <div className="history-chart-controls">
            <label>
              가격 기준{' '}
              <select
                aria-label="역사 가격 기준"
                value={source}
                onChange={(e) => update('price_source', e.target.value)}
              >
                {referenceAvailable && <option value="reference">USD · 전체 참조가격</option>}
                <option value="upbit">KRW · Upbit</option>
                <option value="binance">USDT · Binance</option>
              </select>
            </label>
            <div className="event-chart-actions" role="group" aria-label="사건 전후 표시 기간">
              {[30, 90, 365].map((days) => (
                <button
                  key={days}
                  disabled={!selected || context?.outside}
                  aria-pressed={!!selected && !context?.outside && windowDays === days}
                  onClick={() => {
                    update('window', String(days), true);
                    setFocusRevision((v) => v + 1);
                  }}
                >
                  전후 {days === 365 ? '1년' : `${days}일`}
                </button>
              ))}
              <button aria-pressed={!selected} onClick={() => choose()}>
                전체 이력
              </button>
              <button aria-pressed={log} onClick={() => update('log', log ? '0' : '1', true)}>
                로그축
              </button>
            </div>
          </div>
          {context?.outside ? (
            <p className="event-note" role="status">
              이 사건 당시의 {currency} 가격 기록이 없습니다. 아래는 확보된 전체 이력입니다.
              {!reference && referenceAvailable && (
                <button onClick={() => update('price_source', 'reference')}>
                  더 오래된 USD 이력 보기
                </button>
              )}
            </p>
          ) : selected?.precision === 'month' ? (
            <p className="event-note">
              월 단위 사건입니다. 해당 월 전후를 표시하며 하루 기준 수익률은 계산하지 않습니다.
            </p>
          ) : null}
          {series?.data.length ? (
            <Suspense fallback={<p role="status">차트 준비 중…</p>}>
              <LongHistoryChart
                series={series}
                asset={asset}
                period="all"
                height={340}
                log={log}
                currency={currency}
                focusTime={!context?.outside && selected ? eventTime(selected) : undefined}
                focusLabel={selected?.precision === 'month' ? '해당 월' : selected?.title}
                focusRange={context?.range}
                focusRevision={focusRevision}
                onPeriodChange={() => choose()}
              />
            </Suspense>
          ) : (
            <div className="empty-state" role={result.error ? 'alert' : 'status'}>
              <p>
                {result.error ||
                  (result.loading
                    ? '전체 가격 이력을 불러오고 있습니다…'
                    : '이 가격 원천의 확보된 이력이 없습니다.')}
              </p>
              {!result.loading && <button onClick={result.reload}>다시 시도</button>}
            </div>
          )}
          {result.error && series?.data.length ? (
            <p className="event-note" role="alert">
              새 데이터를 불러오지 못해 이전 관측을 표시합니다.{' '}
              <button onClick={result.reload}>다시 시도</button>
            </p>
          ) : null}
          {selected && context && !context.outside && selected.precision !== 'month' && (
            <dl className="event-price-facts" aria-label="사건일 대비 가격 변화">
              <div>
                <dt>사건일 종가 · {currency}</dt>
                <dd>{money(context.baseline?.value, currency)}</dd>
              </div>
              {context.changes.map((change) => (
                <div key={change.days}>
                  <dt>{change.days}일 후</dt>
                  <dd>
                    {change.percent === undefined
                      ? '—'
                      : `${change.percent > 0 ? '+' : ''}${change.percent.toFixed(2)}%`}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {selected && context && !context.outside && selected.precision !== 'month' && (
            <p className="event-note">
              사건일 UTC 종가 대비 변화 · 해당 날짜의 가격이 없으면 — 표시
              {context.clipped ? ' · 확보 기간 내 구간만 표시' : ''}
            </p>
          )}
          <details className="research-source">
            <summary>출처·날짜·계산 기준</summary>
            <p>
              공식 발표와 원문 기록으로 확인한 주요 사건입니다. 사건과 가격의 인과관계를 뜻하지
              않습니다. 변화율은 동일 원천의 사건일 UTC 종가 대비 7·30·90일 후 종가로 계산합니다.
              결측값을 보간하지 않습니다. USD는 Coin Metrics 참조가격, KRW·USDT는 각각 Upbit·Binance
              실제 거래가격이며 환율 환산이 아닙니다. 가격 확보 시작:{' '}
              {dateLabel(series?.data[0]?.time)}.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
