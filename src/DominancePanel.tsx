import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createChart,
  LineSeries,
  ColorType,
  TickMarkType,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ASSETS } from '../shared/catalog';
import type { Dominance } from '../shared/types';
import { useData } from './hooks';
import { dateLabel, numeric } from './lib';

const colors: Record<string, string> = {
  ...Object.fromEntries(ASSETS.map((a) => [a.id, a.color])),
  STABLE: '#5dc9ad',
  USDT: '#43ac93',
  USDC: '#659fe5',
};
export function DominancePanel({ compact = false }: { compact?: boolean }) {
  const result = useData<Dominance>('/api/v1/dominance', false, 300000);
  return (
    <section className="dominance-panel panel">
      <div className="panel-title">
        <h2>시장 도미넌스</h2>
        <Link to="/dominance">전체 비중 보기 ↗</Link>
      </div>
      <div className={'dominance-grid ' + (compact ? 'compact' : '')}>
        {(result.data?.coins || [])
          .filter(
            (c) => !compact || ['BTC', 'DOGE', 'ETH', 'STABLE', 'USDT', 'USDC'].includes(c.id),
          )
          .map((c) => (
            <div
              className="dominance-item"
              key={c.id}
              title={
                (c.timeBasis === 'retrieved' ? '조회 시각 ' : '일별 기준 ') +
                dateLabel(c.asOf, true)
              }
            >
              <span>
                <i style={{ background: colors[c.id] }} />
                {c.id === 'STABLE' ? '스테이블코인 전체 ≈' : c.id + '.D'}
              </span>
              <strong>
                {numeric(c.value, c.value < 1 ? 3 : 2)}
                <small>%</small>
              </strong>
              <div className="dominance-track">
                <i style={{ width: c.value + '%', background: colors[c.id] }} />
              </div>
            </div>
          ))}
      </div>
      {result.error || result.data?.warning ? (
        <p role="alert" className="amber">
          {result.error || result.data?.warning} <button onClick={result.reload}>다시 시도</button>
        </p>
      ) : !result.data ? (
        <p className="muted">시장 시가총액을 불러오는 중…</p>
      ) : null}
      {result.data?.coins.find((c) => c.id === 'STABLE') ? (
        <p className="dominance-basis">
          스테이블 전체 ≈ · DefiLlama 일별 USD 시가총액 / CoinLore 전체 시가총액 ·{' '}
          {dateLabel(result.data.coins.find((c) => c.id === 'STABLE')?.asOf)} 기준
        </p>
      ) : null}
      <div className="source-line">
        <a href="https://www.coinlore.com/cryptocurrency-data-api" target="_blank" rel="noreferrer">
          CoinLore · 전체 시가총액 대비 비중
        </a>
        <span className={result.data?.stale ? 'amber' : ''}>
          {result.data?.stale ? '갱신 지연 · ' : ''}
          조회 {dateLabel(result.data?.asOf, true)}
        </span>
      </div>
    </section>
  );
}
export function DominancePage() {
  const history = useData<{
    data: { time: number; coins: Dominance['coins'] }[];
    historyStart: number | null;
  }>('/api/v1/dominance/history', false, 300000);
  const [selected, setSelected] = useState('BTC');
  const ref = useRef<HTMLDivElement>(null);
  const lastView = useRef<{ selected: string; from: UTCTimestamp; to: UTCTimestamp } | null>(null);
  const rows = history.data?.data;
  const points = useMemo(
    () =>
      [
        ...new Map(
          (rows || []).flatMap((row) => {
            const coin = row.coins.find((c) => c.id === selected);
            return coin &&
              Number.isFinite(coin.value) &&
              Number.isSafeInteger(row.time) &&
              row.time > 0
              ? [[row.time, { time: row.time as UTCTimestamp, value: coin.value }] as const]
              : [];
          }),
        ).values(),
      ].sort((a, b) => a.time - b.time),
    [rows, selected],
  );
  const selectedLabel = selected === 'STABLE' ? '스테이블코인 전체 ≈' : selected + '.D';
  const latest = points.at(-1);
  useEffect(() => {
    if (!ref.current || points.length < 2) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      height: 350,
      layout: {
        background: { type: ColorType.Solid, color: '#111721' },
        textColor: '#8490a2',
        attributionLogo: true,
      },
      grid: { vertLines: { color: '#1b2431' }, horzLines: { color: '#1b2431' } },
      timeScale: {
        timeVisible: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: number, type: TickMarkType) =>
          new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            ...(type === TickMarkType.Year
              ? { year: 'numeric' as const }
              : type === TickMarkType.Month
                ? { year: 'numeric' as const, month: 'short' as const }
                : type === TickMarkType.DayOfMonth
                  ? { month: '2-digit' as const, day: '2-digit' as const }
                  : {
                      hour: '2-digit' as const,
                      minute: '2-digit' as const,
                      hour12: false,
                      ...(type === TickMarkType.TimeWithSeconds
                        ? { second: '2-digit' as const }
                        : {}),
                    }),
          }).format(new Date(Number(time) * 1000)),
      },
      localization: { timeFormatter: (t: number) => dateLabel(Number(t), true) },
    });
    const line = chart.addSeries(LineSeries, {
      color: colors[selected],
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => numeric(v, 3) + '%' },
    });
    line.setData(points);
    const prior = lastView.current;
    if (
      prior?.selected === selected &&
      prior.to >= points[0].time &&
      prior.from <= points.at(-1)!.time
    )
      chart.timeScale().setVisibleRange({ from: prior.from, to: prior.to });
    else chart.timeScale().fitContent();
    return () => {
      const range = chart.timeScale().getVisibleRange();
      if (range)
        lastView.current = {
          selected,
          from: Number(range.from) as UTCTimestamp,
          to: Number(range.to) as UTCTimestamp,
        };
      chart.remove();
    };
  }, [points, selected]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MARKET DOMINANCE</div>
          <h1>코인 · 스테이블코인 도미넌스</h1>
          <p>전체 시장에서 비트코인, 도지코인, 이더리움과 스테이블코인이 차지하는 비중입니다.</p>
        </div>
      </div>
      <DominancePanel />
      <section className="panel dominance-history">
        <div className="panel-title">
          <h2>누적 관측 이력</h2>
          <select
            aria-label="도미넌스 자산"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {[...ASSETS.map((a) => a.id), 'STABLE', 'USDT', 'USDC'].map((id) => (
              <option key={id} value={id}>
                {id === 'STABLE' ? '스테이블코인 전체' : id + '.D'}
              </option>
            ))}
          </select>
        </div>
        {latest ? (
          <p className="dominance-basis">
            {selectedLabel} 최신 관측 {numeric(latest.value, latest.value < 1 ? 3 : 2)}% ·{' '}
            {dateLabel(latest.time, true)} · {points.length.toLocaleString()}회 관측
          </p>
        ) : null}
        {points.length >= 2 ? (
          <div ref={ref} role="img" aria-label={selected + ' 도미넌스 이력'} />
        ) : (
          <div className="empty-state">
            {selectedLabel}의 실제 관측은 현재 {points.length}개입니다. 해당 자산의 두 번째 관측부터
            차트가 표시됩니다.
          </div>
        )}
        {history.error ? (
          <p className="amber" role="alert">
            {history.error} <button onClick={history.reload}>다시 시도</button>
          </p>
        ) : null}
        <div className="source-line">
          표시 이력 시작 {dateLabel(points[0]?.time, true)} · 실제 수집한 최근 1,000회 관측 · 시간축
          KST · 매시간 갱신
        </div>
      </section>
      <section className="metric-explanation">
        <div>
          <h2>비중을 읽는 기준</h2>
          <p>
            코인별 비중과 USDT.D·USDC.D는 각 코인의 시가총액 ÷ CoinLore 전체 암호자산 시가총액 ×
            100입니다. CoinLore는 개별 값의 기준 시각을 제공하지 않으므로 화면에는 조회 시각을
            표시합니다.
          </p>
          <p>
            스테이블코인 전체 ≈는 DefiLlama가 집계한 모든 스테이블코인의 일별 USD 시가총액 ÷
            CoinLore 전체 시가총액입니다. 서로 다른 원천·갱신 주기를 사용하는 근사 비교이며,
            CoinGlass·TradingView 값과 동일한 지수가 아닙니다. USDT와 USDC를 포함하므로 세 값을
            더하지 않습니다.
          </p>
          <p>
            스테이블코인 원천:{' '}
            <a href="https://defillama.com/stablecoins" target="_blank" rel="noreferrer">
              DefiLlama Stablecoins
            </a>
            . 날짜는 각 카드에 표시합니다. 이력은 서비스에서 실제로 수집한 시점부터 쌓으며 다른
            산식의 과거 값과 연결하지 않습니다.
          </p>
        </div>
      </section>
    </>
  );
}
