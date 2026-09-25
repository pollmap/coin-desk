import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Asset, Period, SeriesResponse } from '../shared/types';
import { bandPosition, historyBands } from '../shared/history-bands';
import {
  positionGeometry,
  priceObservations,
  PRICE_TOP,
  DRAWDOWN_TOP,
  DRAWDOWN_BOTTOM,
} from '../shared/position-chart';
import { useData } from './hooks';
import { dateLabel, money, periodStart } from './lib';
import './history-position.css';

const colors = ['#4f86cc', '#4bb8bf', '#83c59a', '#e6ba65', '#e37c67'];
const labels = ['깊은 하단', '하단', '중앙', '상단', '높은 상단'];

export function HistoryPositionPanel({
  asset,
  supplied,
  currency = 'USD',
  fetchReference = true,
  period,
  log = true,
}: {
  asset: Asset;
  period?: Period;
  log?: boolean;
  fetchReference?: boolean;
  supplied?: SeriesResponse;
  currency?: 'USD' | 'KRW' | 'USDT';
}) {
  const fetched = useData<SeriesResponse>(
    supplied || !fetchReference ? null : `/api/v1/reference?asset=${asset}&limit=1000`,
    true,
    900000,
  );
  const result = supplied
    ? { data: supplied, loading: false, error: undefined, reload: fetched.reload }
    : fetched;
  const observations = useMemo(() => priceObservations(result.data?.data ?? []), [result.data]);
  const calculated = useMemo(() => historyBands(result.data?.data ?? []), [result.data]);
  const bandMap = useMemo(() => new Map(calculated.map((p) => [p.time, p])), [calculated]);
  const [range, setRange] = useState<'four' | 'all'>('all');
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(230, Math.floor(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const all = useMemo(
    () =>
      period
        ? observations.filter((p) => p.time >= periodStart(period, observations.at(-1)?.time ?? 0))
        : range === 'all'
          ? observations
          : observations.filter(
              (p) => p.time >= (observations.at(-1)?.time ?? 0) - 4 * 365.25 * 86400,
            ),
    [observations, range, period],
  );
  const geometry = useMemo(
    () =>
      positionGeometry(
        all,
        calculated.filter((p) => p.time >= (all[0]?.time ?? Infinity)),
        width,
        log,
      ),
    [all, calculated, width, log],
  );
  const selectedIndex = selectedTime === null ? -1 : all.findIndex((p) => p.time === selectedTime);
  const index = selectedIndex < 0 ? all.length - 1 : selectedIndex;
  const view = all[index];
  const band = view ? bandMap.get(view.time) : undefined;

  function selectPointer(event: PointerEvent<SVGSVGElement>) {
    if (!geometry) return;
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - box.left) / box.width) * width;
    const target =
      geometry.first +
      ((Math.min(geometry.right, Math.max(geometry.left, svgX)) - geometry.left) /
        (geometry.right - geometry.left)) *
        (geometry.last - geometry.first);
    let nearest = 0;
    for (let i = 1; i < all.length; i++)
      if (Math.abs(all[i].time - target) < Math.abs(all[nearest].time - target)) nearest = i;
    setSelectedTime(all[nearest].time);
  }

  return (
    <section className="panel position-panel" aria-labelledby="position-title">
      <div className="position-heading">
        <div>
          <h2 id="position-title">{asset} 가격 위치 밴드</h2>
          <p>
            {currency} · {log ? '로그축' : '선형축'} · 과거 730일 대비 위치
          </p>
        </div>
        {!period && (
          <div className="position-range" role="group" aria-label="가격 위치 표시 기간">
            <button
              onClick={() => {
                setRange('all');
                setSelectedTime(null);
              }}
              aria-pressed={range === 'all'}
            >
              전체
            </button>
            <button
              onClick={() => {
                setRange('four');
                setSelectedTime(null);
              }}
              aria-pressed={range === 'four'}
            >
              최근 4년
            </button>
          </div>
        )}
      </div>
      {result.error && (
        <div role="alert" className="error-notice">
          {result.error}
          <button onClick={result.reload}>다시 시도</button>
        </div>
      )}
      <div ref={container} className="position-canvas">
        {geometry && view ? (
          <>
            <div className="position-stats">
              <div>
                <small>
                  {dateLabel(view.time)} · {currency}
                </small>
                <strong>{money(view.price, currency)}</strong>
              </div>
              <div>
                <small>과거 분포에서의 위치</small>
                <strong>
                  {band ? bandPosition(band.z) : '계산 전'}{' '}
                  {band && (
                    <em>
                      {band.z >= 0 ? '+' : ''}
                      {band.z.toFixed(2)}σ
                    </em>
                  )}
                </strong>
              </div>
              <div>
                <small>당시 최고 종가 대비</small>
                <strong>{view.drawdown.toFixed(1)}%</strong>
              </div>
            </div>
            <div className="position-legend" aria-label="가격 위치 구간">
              {labels.map((label, i) => (
                <span key={label}>
                  <i style={{ background: colors[i] }} />
                  {label}
                </span>
              ))}
              <span>
                <i className="position-actual" />
                실제 가격
              </span>
            </div>
            <svg
              className="position-svg"
              viewBox={`0 0 ${width} 396`}
              role="img"
              aria-label={`${asset} 전체 ${currency} 가격, 730일 가격 분포와 낙폭. 날짜별 값은 아래 날짜 탐색으로 확인할 수 있습니다.`}
              onPointerDown={selectPointer}
              onPointerMove={(e) => {
                if (e.pointerType === 'mouse') selectPointer(e);
              }}
            >
              {[0, 1, 2, 3, 4].map((i) => {
                const price = geometry.tick(i / 4);
                const y = geometry.y(price);
                return (
                  <g key={i}>
                    <line
                      x1={geometry.left}
                      x2={geometry.right}
                      y1={y}
                      y2={y}
                      className="position-grid"
                    />
                    <text
                      x={geometry.left - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="position-label"
                    >
                      {money(price, currency)}
                    </text>
                  </g>
                );
              })}
              {geometry.polygons.map((p, i) => (
                <polygon key={i} points={p.points} fill={colors[p.band]} opacity="0.58" />
              ))}
              {geometry.paths.map((p, i) => (
                <path key={i} d={p.price} className="position-price" />
              ))}
              <text x={geometry.left} y="283" className="position-label">
                최고 종가 대비 낙폭
              </text>
              <line
                x1={geometry.left}
                x2={geometry.right}
                y1={DRAWDOWN_TOP}
                y2={DRAWDOWN_TOP}
                className="position-zero"
              />
              {geometry.paths.map((p, i) => (
                <path key={i} d={p.drawdown} className="position-drawdown" />
              ))}
              <text
                x={geometry.left - 8}
                y={DRAWDOWN_TOP + 4}
                textAnchor="end"
                className="position-label"
              >
                0%
              </text>
              <text
                x={geometry.left - 8}
                y={DRAWDOWN_BOTTOM + 4}
                textAnchor="end"
                className="position-label"
              >
                −100%
              </text>
              <text x={geometry.left} y="389" className="position-label">
                {new Date(geometry.first * 1000).toISOString().slice(0, 7)}
              </text>
              <text x={geometry.right} y="389" textAnchor="end" className="position-label">
                {new Date(geometry.last * 1000).toISOString().slice(0, 7)}
              </text>
              <g>
                <line
                  x1={geometry.x(view.time)}
                  x2={geometry.x(view.time)}
                  y1={PRICE_TOP}
                  y2={DRAWDOWN_BOTTOM}
                  className="position-crosshair"
                />
                <circle
                  cx={geometry.x(view.time)}
                  cy={geometry.y(view.price)}
                  r="4"
                  className="position-dot"
                />
              </g>
            </svg>
            <div className="position-inspector">
              <label htmlFor="position-date">
                날짜 탐색 <span>{dateLabel(view.time)}</span>
              </label>
              <input
                id="position-date"
                type="range"
                min="0"
                max={all.length - 1}
                step="1"
                value={index}
                aria-valuetext={`${dateLabel(view.time)}, ${money(view.price, currency)}, ${band ? bandPosition(band.z) : '밴드 계산 전'}, 낙폭 ${view.drawdown.toFixed(1)}%`}
                onChange={(e) => setSelectedTime(all[Number(e.target.value)].time)}
              />
              <button onClick={() => setSelectedTime(null)}>최신으로</button>
            </div>
            <p className="position-note">
              {!band ? '이 날짜에는 이전 730일 연속 가격이 부족해 색상 밴드가 없습니다. ' : ''}
              색상은 과거 대비 위치이며 미래 가격이나 매수·매도 신호가 아닙니다.
            </p>
          </>
        ) : !result.error ? (
          <div className="loading" role="status">
            {result.loading
              ? '전체 가격 이력을 불러오고 있습니다…'
              : '표시할 가격 자료가 없습니다.'}
          </div>
        ) : null}
      </div>
      <details className="position-method">
        <summary>계산 방법·출처</summary>
        <p>
          {result.data?.meta.source}의 실제 {currency} 일별 종가를 첫 관측부터 표시합니다. 밴드는
          그날 이전의 연속된 730개 UTC 로그가격 평균과 표준편차(−2, −1.3, −0.55, +0.55, +1.3, +2σ)로
          계산합니다. 당일 가격과 미래 가격은 계산에 넣지 않으며, 자료가 끊긴 구간은 이어 그리지
          않습니다. 낙폭은 첫 관측부터 그날까지의 최고 종가 대비입니다. 통용되는 비트코인 로그회귀
          레인보우 모델과는 다른 과거 분포 시각화입니다.
        </p>
        <div className="coverage-strip">
          <span>{dateLabel(result.data?.meta.dataAsOf)} 기준</span>
          {currency === 'USD' && (
            <>
              <a
                href="https://docs.coinmetrics.io/network-data/network-data-overview/market/price"
                target="_blank"
                rel="noreferrer"
              >
                Coin Metrics · 가격 정의 ↗
              </a>
              <a
                href="https://github.com/coinmetrics/data/blob/master/LICENSE"
                target="_blank"
                rel="noreferrer"
              >
                CC BY-NC 4.0
              </a>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
