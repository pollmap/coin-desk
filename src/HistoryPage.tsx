import { lazy, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import { eventsForAsset, eventTime, type HistoryEvent } from '../shared/history-events';
import { AssetHeader } from './AssetHeader';
import { useData } from './hooks';
import { dateLabel } from './lib';
import { closeHistory } from '../shared/price-history';
import type { Asset, CandleResponse, SeriesResponse } from '../shared/types';
const LongHistoryChart = lazy(() =>
  import('./LongHistoryChart').then((m) => ({ default: m.LongHistoryChart })),
);

export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const asset = ASSETS.find((a) => a.id === params.get('asset'))?.id || 'BTC';
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [market, setMarket] = useState(true);
  const [log, setLog] = useState(true);
  const [reverse, setReverse] = useState(false);
  const events = eventsForAsset(asset, market).filter(
    (e) =>
      (category === '전체' || e.category === category) &&
      (e.title + e.summary + e.date).toLowerCase().includes(query.toLowerCase()),
  );
  if (reverse) events.reverse();
  const selected = events.find((e) => e.id === params.get('event'));
  const reference = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'].includes(asset);
  const result = useData<SeriesResponse | CandleResponse>(
    reference
      ? `/api/v1/reference?asset=${asset}&limit=1000`
      : `/api/v1/candles?asset=${asset}&market=binance&interval=1d&limit=1000`,
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
  const choose = (event?: HistoryEvent) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('asset', asset);
        if (event) n.set('event', event.id);
        else n.delete('event');
        return n;
      },
      { replace: true },
    );
  const outside =
    selected &&
    series?.data.length &&
    (eventTime(selected) < series.data[0].time || eventTime(selected) > series.data.at(-1)!.time);
  return (
    <div className="history-page">
      <AssetHeader
        asset={asset as Asset}
        current="events"
        subtitle={asset === 'BTC' ? '비트코인과 시장의 주요 전환점' : '가격과 함께 읽는 주요 사건'}
        href={(a) => '/history?asset=' + a}
      />
      <section className="panel event-chart" aria-label="사건과 가격 흐름">
        <div className="panel-title">
          <div>
            <h2>{selected?.title || '가격으로 보는 코인 역사'}</h2>
            <small>
              {reference ? 'Coin Metrics · USD 참조가격' : 'Binance · USDT 종가'} ·{' '}
              {selected ? '선택한 사건 전후' : '전체 확보 이력'}
            </small>
          </div>
          <div className="event-chart-actions">
            <button onClick={() => choose()}>전체 이력</button>
            <button aria-pressed={log} onClick={() => setLog((v) => !v)}>
              가격축 · {log ? '로그' : '일반'}
            </button>
          </div>
        </div>
        {selected && (
          <p className="event-summary">
            <time>
              {selected.precision === 'month' ? selected.date.slice(0, 7) : selected.date}
            </time>{' '}
            {selected.summary}{' '}
            <a href={selected.source} target="_blank" rel="noreferrer">
              {selected.sourceName} ↗
            </a>
          </p>
        )}
        {outside ? (
          <p className="event-note" role="status">
            사건 당시 가격은 이 원천의 확보 이력 밖입니다. 전체 이력을 표시합니다.
          </p>
        ) : selected?.precision === 'month' ? (
          <p className="event-note">
            월 단위 사건입니다. 특정 하루의 가격 반응으로 해석하지 않습니다.
          </p>
        ) : null}
        {series?.data.length ? (
          <Suspense fallback={<p>차트 준비 중…</p>}>
            <LongHistoryChart
              series={series}
              asset={asset}
              period="all"
              log={log}
              currency={reference ? 'USD' : 'USDT'}
              focusTime={!outside && selected ? eventTime(selected) : undefined}
              focusLabel={selected?.precision === 'month' ? '해당 월' : selected?.title}
            />
          </Suspense>
        ) : (
          <p role={result.error ? 'alert' : 'status'}>
            {result.error || '전체 가격 이력을 불러오고 있습니다…'}{' '}
            {result.error && <button onClick={result.reload}>다시 시도</button>}
          </p>
        )}
      </section>
      <div className="timeline-toolbar">
        <h2>주요 사건</h2>
        <input
          type="search"
          aria-label="역사 검색"
          placeholder="FTX, 출시, 2022…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="사건 분류"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {['전체', '탄생', '공급·반감기', '업그레이드', '거래소·위기', '제도·채택'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={market} onChange={(e) => setMarket(e.target.checked)} />{' '}
          시장 공통 사건
        </label>
        <button onClick={() => setReverse((v) => !v)}>{reverse ? '최신순' : '오래된순'}</button>
      </div>
      <div className="event-timeline">
        {events.map((event) => (
          <article key={event.id} className={selected?.id === event.id ? 'selected' : ''}>
            <time>{event.precision === 'month' ? event.date.slice(0, 7) : event.date}</time>
            <div>
              <span className="event-category">
                {event.category}
                {event.market ? ' · 시장 공통' : ''}
              </span>
              <h3>
                <button
                  onClick={() => {
                    choose(event);
                    document
                      .querySelector('.event-chart')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {event.title}
                </button>
              </h3>
              <p>{event.summary}</p>
              <a href={event.source} target="_blank" rel="noreferrer">
                {event.sourceName} ↗
              </a>
            </div>
          </article>
        ))}
      </div>
      {!events.length && <p className="empty-state">검색 조건에 맞는 사건이 없습니다.</p>}
      <details className="research-source">
        <summary>연혁의 범위와 날짜 기준</summary>
        <p>
          공식 발표·원문 기록으로 확인한 주요 사건 모음입니다. 전체 사건을 망라하지 않으며 기사
          발행일과 실제 발생일을 구분합니다. 일자를 확인하지 못한 사건은 월 단위로 표시합니다.
          사건과 가격의 인과관계를 단정하지 않습니다. 가격 확보 시작:{' '}
          {dateLabel(series?.data[0]?.time)}.
        </p>
      </details>
    </div>
  );
}
