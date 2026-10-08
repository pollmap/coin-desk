import { useMemo, useState } from 'react';
import { RelativeControls } from './RelativeControls';
import { supportsReference } from '../shared/indicator-catalog';
import { relativePair } from '../shared/relative-pair';
import { useData } from './hooks';
import { AnalysisChart, type AnalysisLine } from './AnalysisChart';
import {
  alignComparison,
  halvingCycles,
  normalizeWindow,
  rollingCorrelation,
  seasonality,
  type AnalysisView,
  type ComparisonPath,
  type Normalization,
} from '../shared/advanced-analysis';
import { basisName, basisUnit, type PriceBasis } from '../shared/analysis-workspace';
import { closeHistory } from '../shared/price-history';
import { parseUtcDate, utcDate, type DateWindow } from '../shared/date-navigation';
import type { Asset, CandleResponse, SeriesResponse, Point, Period } from '../shared/types';
const COLORS = ['#65b8a8', '#c29be8', '#daa451', '#679bdc', '#da8293'];
const NO_SIGNALS: never[] = [];
const NO_POINTS: Point[] = [];

/** Numeric horizontal axis for elapsed-day and calendar-day comparisons, never fake UTC dates. */
export function PathPlot({
  paths,
  unit = '%',
  calendar = false,
  band,
}: {
  paths: { name: string; data: Point[]; color?: string }[];
  unit?: string;
  calendar?: boolean;
  band?: { low: Point[]; high: Point[] };
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const all = paths.flatMap((p) => p.data).concat(band?.low ?? [], band?.high ?? []);
  if (!all.length) return <p role="status">이 조건에 맞는 관측이 없습니다.</p>;
  const min = Math.min(0, ...all.map((p) => p.value)),
    max = Math.max(1, ...all.map((p) => p.value)),
    end = Math.max(1, ...all.map((p) => p.time));
  const x = (t: number) => 68 + (t / end) * 850,
    y = (v: number) => 310 - ((v - min) / (max - min)) * 280;
  const label = (t: number) =>
    calendar
      ? new Date((Date.UTC(2023, 0, 1) / 1000 + t * 86400) * 1000).toISOString().slice(5, 10)
      : Math.round(t) + '일';
  const path = (points: Point[]) =>
    points
      .map(
        (p, i) =>
          `${!i || p.time - points[i - 1].time > 1 ? 'M' : 'L'}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`,
      )
      .join(' ');
  const values = paths.map((p) => ({
    name: p.name,
    value: p.data.find((v) => v.time === cursor)?.value,
  }));
  return (
    <div className="path-plot">
      <svg
        viewBox="0 0 960 355"
        role="img"
        aria-label={
          paths.map((p) => p.name).join(', ') +
          (calendar ? ' · 달력 날짜별 수익률' : ' · 경과일 비교')
        }
        tabIndex={0}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setCursor(
            Math.max(
              0,
              Math.min(
                end,
                Math.round(((((e.clientX - rect.left) / rect.width) * 960 - 68) / 850) * end),
              ),
            ),
          );
        }}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) {
            e.preventDefault();
            setCursor(
              e.key === 'Escape'
                ? null
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? end
                    : Math.max(0, Math.min(end, (cursor ?? 0) + (e.key === 'ArrowRight' ? 1 : -1))),
            );
          }
        }}
      >
        {Array.from({ length: 5 }, (_, i) => {
          const value = min + ((max - min) * i) / 4;
          return (
            <g key={i}>
              <line x1="68" x2="918" y1={y(value)} y2={y(value)} stroke="var(--border)" />
              <text x="60" y={y(value) + 4} textAnchor="end" fill="var(--muted)" fontSize="11">
                {value.toFixed(0)}
                {unit}
              </text>
            </g>
          );
        })}
        {Array.from({ length: calendar ? 12 : 7 }, (_, i) => {
          const t = calendar
            ? (Date.UTC(2023, i, 1) - Date.UTC(2023, 0, 1)) / 86400000
            : (end * i) / 6;
          return (
            <text key={i} x={x(t)} y="337" textAnchor="middle" fill="var(--muted)" fontSize="12">
              {calendar ? i + 1 + '월' : Math.round(t) + '일'}
            </text>
          );
        })}
        {band && (
          <polygon
            points={[...band.low, ...[...band.high].reverse()]
              .map((p) => x(p.time) + ',' + y(p.value))
              .join(' ')}
            fill="#65b8a820"
          />
        )}
        {paths.map((p, i) => (
          <path
            key={p.name}
            d={path(p.data)}
            stroke={p.color ?? COLORS[i % COLORS.length]}
            strokeWidth={i < 2 ? 2 : 1}
            strokeDasharray={i === 1 ? '6 4' : undefined}
            fill="none"
          />
        ))}
        {cursor !== null && (
          <line
            x1={x(cursor)}
            x2={x(cursor)}
            y1="20"
            y2="310"
            stroke="var(--muted)"
            strokeDasharray="3 4"
          />
        )}
      </svg>
      <div className="path-legend" aria-live="polite">
        {cursor !== null && <strong>{label(cursor)}</strong>}
        {paths.map((p, i) => (
          <span key={p.name}>
            <i style={{ background: p.color ?? COLORS[i % COLORS.length] }} />
            {p.name}
            {cursor !== null ? ' ' + (values[i].value?.toFixed(2) ?? '—') + unit : ''}
          </span>
        ))}
      </div>
      <details>
        <summary>표로 확인</summary>
        <div className="analysis-table">
          <table>
            <caption>
              {calendar ? '달력 날짜' : '경과일'} · {unit}
            </caption>
            <thead>
              <tr>
                <th>날짜</th>
                {paths.map((p) => (
                  <th key={p.name}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(all.map((p) => p.time)))
                .sort((a, b) => a - b)
                .map((t) => (
                  <tr key={t}>
                    <td>{label(t)}</td>
                    {paths.map((p) => (
                      <td key={p.name}>
                        {p.data.find((v) => v.time === t)?.value.toFixed(2) ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
function SeasonalityView({
  points,
  asset,
  source,
  params,
  change,
  cutoff,
}: {
  points: Point[];
  asset: Asset;
  source: string;
  cutoff?: number;
  params: URLSearchParams;
  change: (p: Record<string, string | null>) => void;
}) {
  const result = useMemo(
    () => seasonality(points, cutoff === undefined ? undefined : cutoff + 86400),
    [points, cutoff],
  );
  const geometric = params.get('seasonality_method') === 'log',
    years = params.get('seasonality_years') === '1';
  const setGeometric = (v: boolean) => change({ seasonality_method: v ? 'log' : null });
  const setYears = (v: boolean) => change({ seasonality_years: v ? '1' : null });
  const paths = useMemo(
    () => [
      ...(geometric
        ? [
            {
              name: '평균 일별 로그수익률 누적',
              data: result.summary.map((p) => ({ time: p.day, value: p.geometric })),
            },
          ]
        : [
            { name: '중앙값', data: result.summary.map((p) => ({ time: p.day, value: p.median })) },
            { name: '단순평균', data: result.summary.map((p) => ({ time: p.day, value: p.mean })) },
          ]),
      {
        name: cutoff ? '기준 연도 · 관측일까지' : '올해 · 관측일까지',
        data: result.current,
        color: '#679bdc',
      },
      ...(years ? result.paths.map((p) => ({ name: String(p.year), data: p.data })) : []),
    ],
    [result, geometric, years, cutoff],
  );
  return (
    <section className="analysis-lab">
      <div className="lab-heading">
        <h2>{asset} 계절성</h2>
        <span>
          {result.years[0]}–{result.years.at(-1)} · 완전 연도 {result.years.length}개
        </span>
      </div>
      <div className="lab-controls">
        <label>
          <input
            type="checkbox"
            checked={geometric}
            onChange={(e) => setGeometric(e.target.checked)}
          />
          평균 일별 로그수익률 누적
        </label>
        <label>
          <input type="checkbox" checked={years} onChange={(e) => setYears(e.target.checked)} />
          연도별 경로
        </label>
      </div>
      {result.summary.length ? (
        <PathPlot
          paths={paths}
          calendar
          band={
            geometric
              ? undefined
              : {
                  low: result.summary.map((p) => ({ time: p.day, value: p.low })),
                  high: result.summary.map((p) => ({ time: p.day, value: p.high })),
                }
          }
        />
      ) : (
        <p role="status">
          결측 없는 완전한 연도가 3개 이상 필요합니다. 현재 {result.years.length}개입니다.
        </p>
      )}
      <details>
        <summary>계산 기준 · {source}</summary>
        <p>
          전년 12월 31일 대비 일별 종가 누적수익률입니다. 기본 두 선은 같은 연도 표본의
          중앙값·단순평균, 음영은 25–75% 범위입니다. 현재 연도와 누락일이 있는 연도는 과거 집계에서
          제외합니다. 2월 29일은 공통 달력에서 생략하고, 로그수익률 방식에서는 3월 1일에 합산합니다.
          과거 통계이며 전망 경로가 아닙니다.
        </p>
      </details>
    </section>
  );
}
function CyclesView({
  points,
  asset,
  params,
  change,
  windows,
}: {
  points: Point[];
  asset: Asset;
  params: URLSearchParams;
  change: (p: Record<string, string | null>) => void;
  windows: boolean;
}) {
  const last = points.at(-1)?.time ?? Date.now() / 1000,
    first = points[0]?.time ?? last;
  const defaults = [
    first,
    Math.min(last, first + 365 * 86400),
    Math.max(first, last - 365 * 86400),
    last,
  ];
  const names = ['a_from', 'a_to', 'b_from', 'b_to'];
  const values = names.map((k, i) => params.get('window_' + k) ?? utcDate(defaults[i]));
  const dates = values.map(parseUtcDate);
  const valid = dates.every((v) => v !== null) && dates[0]! < dates[1]! && dates[2]! < dates[3]!;
  const side = params.get('comparison_layout') === 'side',
    setSide = (v: boolean) => change({ comparison_layout: v ? 'side' : null });
  const paths: ComparisonPath[] = useMemo(
    () =>
      windows
        ? valid
          ? [
              normalizeWindow(points, dates[0]!, dates[1]!, '구간 A'),
              normalizeWindow(points, dates[2]!, dates[3]!, '구간 B'),
            ]
          : []
        : halvingCycles(points),
    [points, windows, valid, values.join(',')],
  );
  if (!windows && asset !== 'BTC')
    return (
      <p role="status">반감기 비교는 BTC 전용입니다. 이 코인은 과거 구간 비교를 사용해 주세요.</p>
    );
  return (
    <section className="analysis-lab">
      <div className="lab-heading">
        <h2>{windows ? '과거 구간 비교' : 'BTC 반감기 사이클'}</h2>
        <span>시작값 100 · 실제 경과일</span>
      </div>
      {windows && (
        <div className="lab-controls">
          {values.map((v, i) => (
            <label key={names[i]}>
              {['A 시작', 'A 종료', 'B 시작', 'B 종료'][i]}
              <input
                type="date"
                value={v}
                onChange={(e) => change({ ['window_' + names[i]]: e.target.value })}
              />
            </label>
          ))}
          <label>
            <input type="checkbox" checked={side} onChange={(e) => setSide(e.target.checked)} />
            나란히 보기
          </label>
        </div>
      )}
      {!valid && windows ? (
        <p role="alert">각 구간의 시작일을 종료일 이전으로 정해 주세요.</p>
      ) : side ? (
        <div className="side-paths">
          {paths.map((p) => (
            <PathPlot key={p.name} paths={[{ name: p.name, data: p.points }]} unit="" />
          ))}
        </div>
      ) : (
        <PathPlot paths={paths.map((p) => ({ name: p.name, data: p.points }))} unit="" />
      )}
      <div className="path-legend">
        {paths.map((p) => (
          <span key={p.name}>
            {p.name} · 기준 {utcDate(p.anchor)} / 첫 관측 {utcDate(p.first)}
          </span>
        ))}
      </div>
      <details>
        <summary>비교 기준</summary>
        <p>
          각 구간 첫 관측을 100으로 맞추고 경과일로 비교합니다. 반감기 구간은 다음 반감기
          전날까지입니다. 누락일을 잇거나 아직 관측하지 않은 미래 경로를 만들지 않습니다.
        </p>
      </details>
    </section>
  );
}
function usePrice(asset: string, basis: PriceBasis, enabled = true) {
  return useData<SeriesResponse | CandleResponse>(
    !enabled
      ? null
      : basis === 'reference'
        ? `/api/v1/reference?asset=${asset}&limit=1000`
        : `/api/v1/candles?asset=${asset}&market=${basis}&interval=1d&limit=1000`,
    true,
    basis === 'reference' ? 3600000 : 60000,
  );
}
function RelativeView({
  asset,
  basis,
  params,
  change,
  period,
  initialWindow,
  controlsInToolbar = false,
  toolbarTarget,
  onVisibleRange,
  onReadingDate,
  initialReadingDate,
}: {
  asset: Asset;
  basis: PriceBasis;
  params: URLSearchParams;
  change: (p: Record<string, string | null>) => void;
  period: Period;
  initialWindow?: DateWindow | null;
  controlsInToolbar?: boolean;
  toolbarTarget?: HTMLElement | null;
  onVisibleRange?: (range: DateWindow) => void;
  onReadingDate?: (time: number | null, pinned?: boolean) => void;
  initialReadingDate?: number;
}) {
  const pair = relativePair(asset, params);
  const supported =
    basis !== 'reference' || (supportsReference(pair.asset) && supportsReference(pair.benchmark));
  const left = usePrice(pair.asset, basis, supported);
  const right = usePrice(pair.benchmark, basis, supported);
  const mode: Normalization = ['percent', 'index', 'ratio'].includes(
    params.get('normalization') ?? '',
  )
    ? (params.get('normalization') as Normalization)
    : 'index';
  const window = [30, 90, 365].includes(Number(params.get('correlation')))
    ? Number(params.get('correlation'))
    : 90;
  const raw = useMemo(
    () =>
      [right, left].map((r, i) => ({
        name: [pair.benchmark, pair.asset][i],
        data: (r.data
          ? basis === 'reference'
            ? (r.data as SeriesResponse).data
            : closeHistory(r.data as CandleResponse).data
          : NO_POINTS
        ).filter((p) => !initialWindow || p.time <= initialWindow.to),
      })),
    [left.data, right.data, pair.asset, pair.benchmark, basis, initialWindow?.to],
  );
  const aligned = useMemo(() => alignComparison(raw, mode), [raw, mode]);
  const corr = useMemo(() => rollingCorrelation(raw[0].data, raw[1].data, window), [raw, window]);
  const unit =
    mode === 'ratio' ? `${pair.benchmark}/${pair.asset}` : mode === 'percent' ? '%' : '100 기준';
  const lines = useMemo<AnalysisLine[]>(
    () => [
      ...(mode !== 'ratio'
        ? [
            {
              id: pair.benchmark,
              title: pair.benchmark,
              unit,
              source: basisName(basis),
              data: aligned[0]?.data ?? [],
              color: COLORS[1],
              overlay: true,
            },
          ]
        : []),
      {
        id: 'correlation',
        title: `${pair.asset}/${pair.benchmark} ${window}일 상관`,
        legendTitle: `${window}일 상관`,
        unit: 'r',
        source: basisName(basis),
        data: corr,
        color: '#679bdc',
        thresholds: [-1, 0, 1],
      },
    ],
    [pair.asset, pair.benchmark, mode, unit, basis, aligned, corr, window],
  );
  const error = left.error || right.error;
  const loading = left.loading || right.loading;
  return (
    <section
      className="analysis-lab"
      data-relative-asset={pair.asset}
      data-relative-benchmark={pair.benchmark}
    >
      {!controlsInToolbar && <RelativeControls asset={asset} params={params} change={change} />}
      {!supported ? (
        <p role="status">
          {pair.asset}·{pair.benchmark}의 공통 USD 참조 원천이 없습니다. 더보기에서 공통 거래소
          원천을 선택하세요.
        </p>
      ) : error ? (
        <p role="alert">
          비교 이력을 불러오지 못했습니다.{' '}
          <button
            onClick={() => {
              left.reload();
              right.reload();
            }}
          >
            다시 시도
          </button>
        </p>
      ) : aligned[1]?.data.length ? (
        <>
          <AnalysisChart
            toolbarTarget={toolbarTarget}
            onVisibleRange={onVisibleRange}
            onReadingDate={onReadingDate}
            initialReadingDate={initialReadingDate}
            asset={pair.asset}
            exportName={`${pair.asset}-${pair.benchmark}-${mode}`}
            primary={{
              id: `relative:${pair.asset}:${pair.benchmark}:${mode}`,
              title: `${pair.asset}/${pair.benchmark} ${mode === 'ratio' ? '가격 비율' : mode === 'percent' ? '수익률' : '시작값 100'}`,
              unit,
              source: basisName(basis),
              color: COLORS[0],
              data: aligned[1].data,
            }}
            unit={unit}
            source={basisName(basis)}
            points={aligned[1].data}
            lines={lines}
            signals={NO_SIGNALS}
            period={period}
            log={false}
            onAll={() => change({ period: 'all' })}
            onSignal={() => {}}
            initialWindow={initialWindow}
          />
          {mode === 'ratio' && (
            <p className="relative-ratio-label">
              1 {pair.asset}의 가격을 {pair.benchmark} 수량으로 표시합니다.
            </p>
          )}
          {!corr.length && (
            <p className="muted">
              {window}일 상관에는 연속 {window + 1}개 공통 일별 종가와 변동이 필요합니다.
            </p>
          )}
        </>
      ) : (
        <p role="status">
          {loading
            ? '두 코인의 공통 이력을 불러오는 중…'
            : '선택 원천에서 두 코인의 공통 확정 이력이 없습니다.'}
        </p>
      )}
      <details>
        <summary>정규화·상관 기준</summary>
        <p>
          공통 첫 관측을 기준으로 정규화하며 확대해도 기준일은 바뀌지 않습니다. 가격 비율은{' '}
          {pair.asset} 종가 ÷ {pair.benchmark} 종가입니다. 상관은 연속 일간 로그수익률의 Pearson
          상관입니다. 결측을 이어 붙이지 않으며 상관은 인과관계가 아닙니다.
        </p>
      </details>
    </section>
  );
}

export function AnalysisLab({
  view,
  points,
  asset,
  basis,
  params,
  change,
  period,
  initialWindow,
  controlsInToolbar = false,
  toolbarTarget,
  onVisibleRange,
  onReadingDate,
  initialReadingDate,
}: {
  view: AnalysisView;
  points: Point[];
  asset: Asset;
  basis: PriceBasis;
  params: URLSearchParams;
  change: (p: Record<string, string | null>) => void;
  period: Period;
  initialWindow?: DateWindow | null;
  controlsInToolbar?: boolean;
  toolbarTarget?: HTMLElement | null;
  onVisibleRange?: (range: DateWindow) => void;
  onReadingDate?: (time: number | null, pinned?: boolean) => void;
  initialReadingDate?: number;
}) {
  const scoped = useMemo(
    () => (initialWindow ? points.filter((p) => p.time <= initialWindow.to) : points),
    [points, initialWindow?.to],
  );
  if (view === 'seasonality')
    return (
      <SeasonalityView
        points={scoped}
        cutoff={initialWindow?.to}
        asset={asset}
        source={basisName(basis)}
        params={params}
        change={change}
      />
    );
  if (view === 'cycles' || view === 'windows')
    return (
      <CyclesView
        points={scoped}
        asset={asset}
        params={params}
        change={change}
        windows={view === 'windows'}
      />
    );
  return (
    <RelativeView
      controlsInToolbar={controlsInToolbar}
      toolbarTarget={toolbarTarget}
      onVisibleRange={onVisibleRange}
      onReadingDate={onReadingDate}
      initialReadingDate={initialReadingDate}
      asset={asset}
      basis={basis}
      params={params}
      change={change}
      period={period}
      initialWindow={initialWindow}
    />
  );
}
