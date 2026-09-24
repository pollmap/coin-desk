import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Asset, SeriesResponse } from '../shared/types';
import { bandPosition, historyBands } from '../shared/history-bands';
import { useData } from './hooks';
import { dateLabel, money } from './lib';
import './history-position.css';

const WIDTH = 1000;
const LEFT = 68;
const RIGHT = 984;
const TOP = 14;
const BOTTOM = 286;
const colors = ['#4f86cc', '#4bb8bf', '#83c59a', '#e6ba65', '#e37c67'];

export function HistoryPositionPanel({ asset }: { asset: Asset }) {
  const result = useData<SeriesResponse>(`/api/v1/reference?asset=${asset}&limit=1000`, true, 900000);
  const calculated = useMemo(() => historyBands(result.data?.data ?? []), [result.data]);
  const [range, setRange] = useState<'four' | 'all'>('four');
  const [hover, setHover] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = calculated.at(-1);
  const all = useMemo(() => {
    if (!latest || range === 'all') return calculated;
    const cutoff = latest.time - 4 * 365.25 * 86400;
    return calculated.filter((point) => point.time >= cutoff);
  }, [calculated, latest, range]);
  const sampled = useMemo(() => {
    const step = Math.max(1, Math.ceil(all.length / 550));
    const list = all.filter((_, index) => index % step === 0);
    if (all.length && list.at(-1) !== all.at(-1)) list.push(all.at(-1)!);
    return list;
  }, [all]);
  const view = hover === null ? latest : sampled[hover] ?? latest;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [range, calculated.length]);
  const geometry = useMemo(() => {
    if (sampled.length < 2) return null;
    const first = sampled[0].time;
    const last = sampled.at(-1)!.time;
    const logs = sampled.flatMap((point) => [Math.log(point.price), Math.log(point.bands[0]), Math.log(point.bands[5])]);
    const low = Math.min(...logs);
    const high = Math.max(...logs);
    const padding = Math.max(0.1, (high - low) * 0.07);
    const min = low - padding;
    const max = high + padding;
    const x = (time: number) => LEFT + (time - first) / (last - first) * (RIGHT - LEFT);
    const y = (price: number) => BOTTOM - (Math.log(price) - min) / (max - min) * (BOTTOM - TOP);
    const line = sampled.map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point.price).toFixed(1)}`).join(' ');
    const bands = colors.map((_, band) => {
      const upper = sampled.map((point) => `${x(point.time).toFixed(1)},${y(point.bands[band + 1]).toFixed(1)}`);
      const lower = [...sampled].reverse().map((point) => `${x(point.time).toFixed(1)},${y(point.bands[band]).toFixed(1)}`);
      return [...upper, ...lower].join(' ');
    });
    const drawdown = sampled.map((point, index) =>
      `${index ? 'L' : 'M'}${x(point.time).toFixed(1)},${(349 + Math.max(-100, point.drawdown) * 0.58).toFixed(1)}`,
    ).join(' ');
    return { x, y, min, max, first, last, line, bands, drawdown };
  }, [sampled]);

  function selectPointer(event: PointerEvent<SVGSVGElement>) {
    if (!geometry) return;
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - box.left) / box.width * WIDTH;
    const target = geometry.first + (Math.min(RIGHT, Math.max(LEFT, svgX)) - LEFT) /
      (RIGHT - LEFT) * (geometry.last - geometry.first);
    let nearest = 0;
    let distance = Infinity;
    for (let index = 0; index < sampled.length; index++) {
      const delta = Math.abs(sampled[index].time - target);
      if (delta < distance) { distance = delta; nearest = index; }
    }
    setHover(nearest);
  }

  if (asset !== 'BTC' && asset !== 'DOGE') return null;
  return <section className="panel position-panel" aria-labelledby="position-title">
    <div className="position-heading">
      <div>
        <h2 id="position-title">{asset} 장기 가격 위치 밴드</h2>
        <p>레인보우형 시각화 · 실제 USD 일별 참조가격과 이전 730일의 로그가격 분포</p>
      </div>
      <div className="position-range" role="group" aria-label="표시 기간">
        <button className={range === 'four' ? 'active' : ''} onClick={() => { setRange('four'); setHover(null); }} aria-pressed={range === 'four'}>최근 4년</button>
        <button className={range === 'all' ? 'active' : ''} onClick={() => { setRange('all'); setHover(null); }} aria-pressed={range === 'all'}>전체</button>
      </div>
    </div>
    {result.error && <div role="alert" className="error-notice">{result.error}<button onClick={result.reload}>다시 시도</button></div>}
    {geometry && view ? <>
      <div className="position-stats">
        <div><small>{hover === null ? '최신 관측' : '선택한 관측'} · {dateLabel(view.time)}</small><strong>{money(view.price, 'USD')}</strong></div>
        <div><small>당시 730일 밴드 위치</small><strong>{bandPosition(view.z)} <em>{view.z >= 0 ? '+' : ''}{view.z.toFixed(2)}σ</em></strong></div>
        <div><small>그날까지의 최고 종가 대비</small><strong>{view.drawdown.toFixed(1)}%</strong></div>
      </div>
      <div className="position-legend" aria-label="가격 위치 구간">
        {['깊은 하단', '하단', '중앙', '상단', '높은 상단'].map((label, index) => <span key={label}><i style={{ background: colors[index] }} />{label}</span>)}
        <span><i className="position-actual" />실제 가격</span>
      </div>
      <p className="position-scroll-hint">차트를 좌우로 밀어 과거 구간을 확인하세요.</p>
      <div className="position-chart-scroll" ref={scroller}><svg className="position-svg" viewBox="0 0 1000 380" role="img"
        aria-label={`${asset} 일별 USD 가격과 과거 730일 기준 위치 밴드 및 최고 종가 대비 낙폭`}
        tabIndex={0}
        onPointerMove={selectPointer} onPointerLeave={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setHover((current) => Math.min(sampled.length - 1, Math.max(0, (current ?? sampled.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
        }}>
        {[0, 1, 2, 3, 4].map((index) => {
          const price = Math.exp(geometry.min + (geometry.max - geometry.min) * index / 4);
          const y = geometry.y(price);
          return <g key={index}><line x1={LEFT} x2={RIGHT} y1={y} y2={y} className="position-grid" /><text x={LEFT - 8} y={y + 4} textAnchor="end" className="position-label">{money(price, 'USD')}</text></g>;
        })}
        {geometry.bands.map((polygon, index) => <polygon key={index} points={polygon} fill={colors[index]} opacity="0.52" />)}
        <path d={geometry.line} className="position-price" />
        <line x1={LEFT} x2={RIGHT} y1="349" y2="349" className="position-zero" />
        <path d={geometry.drawdown} className="position-drawdown" />
        <text x={LEFT - 8} y="351" textAnchor="end" className="position-label">0%</text>
        <text x={LEFT - 8} y="291" textAnchor="end" className="position-label">−100%</text>
        <text x={LEFT} y="373" className="position-label">{dateLabel(geometry.first)}</text>
        <text x={RIGHT} y="373" textAnchor="end" className="position-label">{dateLabel(geometry.last)}</text>
        {hover !== null && view && <g><line x1={geometry.x(view.time)} x2={geometry.x(view.time)} y1={TOP} y2="349" className="position-crosshair" /><circle cx={geometry.x(view.time)} cy={geometry.y(view.price)} r="5" className="position-dot" /></g>}
      </svg></div>
      <p className="position-method">위 색상은 매일 그날 이전의 <b>연속된 730개 UTC 일별 가격</b>에서 자연로그 평균과 표준편차로 다시 계산합니다. 해당 날짜 가격은 밴드 계산에 넣지 않습니다. 아래 선은 그때까지 관측한 최고 종가 대비 낙폭입니다. 색상은 상대 위치 설명이며 적정가·바닥·매수 신호가 아닙니다.</p>
      <div className="coverage-strip"><span>Coin Metrics PriceUSD · {dateLabel(result.data?.meta.dataAsOf)} 기준</span><a href="https://docs.coinmetrics.io/network-data/network-data-overview/market/price" target="_blank" rel="noreferrer">원천·정의 ↗</a><a href="https://github.com/coinmetrics/data/blob/master/LICENSE" target="_blank" rel="noreferrer">CC BY-NC 4.0</a></div>
    </> : <div className="loading" role="status">{result.loading ? '가격 위치 밴드를 계산하고 있습니다…' : '연속된 730일 가격 자료가 없어 밴드를 표시할 수 없습니다.'}</div>}
  </section>;
}
