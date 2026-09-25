import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  LineSeries,
  PriceScaleMode,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { createDeskChart } from './chart-theme';
import type { Candle, Period, Point } from '../shared/types';
import type { ObservationSignal } from '../shared/signals';
import { money, numeric, periodStart } from './lib';
import { ChartTools } from './ChartNavigator';
import {
  adjacentObservation,
  readingIndex,
  readingsCsv,
  readingDigits,
} from '../shared/chart-readings';

export interface AnalysisLine {
  id: string;
  title: string;
  unit: string;
  source: string;
  data: Point[];
  color: string;
  overlay?: boolean;
  pane?: string;
  thresholds?: number[];
  step?: number;
  warning?: string;
  formula?: string;
}
const panelCount = (lines: AnalysisLine[]) =>
  new Set(lines.filter((l) => !l.overlay && l.data.length).map((l) => l.pane ?? l.id)).size;
const ts = (n: number) => n as UTCTimestamp;
/** Insert whitespace at missing observations, never draw a price through missing days. */
export function gapData(points: Point[], step = 86400) {
  return points.flatMap((p, i) =>
    i && p.time - points[i - 1].time > step
      ? [{ time: ts(points[i - 1].time + step) }, { time: ts(p.time), value: p.value }]
      : [{ time: ts(p.time), value: p.value }],
  );
}
export const AnalysisChart = memo(function AnalysisChart({
  asset,
  unit,
  source,
  points,
  candles,
  lines,
  period,
  log,
  step = 86400,
  signals,
  focus,
  onSignal,
  onAll,
  rangeRevision = 0,
}: {
  asset: string;
  unit: string;
  source: string;
  points: Point[];
  candles?: Candle[];
  lines: AnalysisLine[];
  period: Period;
  log: boolean;
  step?: number;
  signals: ObservationSignal[];
  focus?: number;
  onSignal: (s: ObservationSignal) => void;
  onAll: () => void;
  rangeRevision?: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null);
  const moveCursor = useRef<(time: number | null) => void>(() => {});
  const manualCursor = useRef(false);
  const click = useRef(onSignal);
  click.current = onSignal;
  const settings = useRef({ period, log });
  settings.current = { period, log };
  const previous = useRef<{ key: string; from: number; to: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null),
    [tableCount, setTableCount] = useState(50);
  const key = asset + unit + step;
  const columns = useMemo(
    () => [{ title: asset, unit, source, data: points }, ...lines],
    [asset, unit, source, points, lines],
  );
  const readings = useMemo(() => readingIndex(columns), [columns]);
  const [selectionKey, setSelectionKey] = useState(key);
  const selectedTime = selectionKey === key ? selected : null;
  const time = selectedTime ?? points.at(-1)?.time;
  const priceValue = time === undefined ? undefined : readings.maps[0].get(time);
  const timestamp = (t: number | undefined) =>
    t === undefined
      ? '—'
      : new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const metricNumber = (value: number | undefined) => numeric(value, readingDigits(value));
  function explore(t: number | null) {
    manualCursor.current = t !== null;
    setSelectionKey(key);
    setSelected(t);
    moveCursor.current(t);
  }
  function exportReadings() {
    const visible = chartRef.current?.timeScale().getVisibleRange();
    const content = readingsCsv(
      columns,
      visible ? { from: Number(visible.from), to: Number(visible.to) } : undefined,
    );
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Coin-Desk-${asset}-${unit}-indicators.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useEffect(() => {
    if (!host.current || !points.length) return;
    const panels = panelCount(lines);
    const chart = createDeskChart(host.current, {
      autoSize: true,
      height: 370 + panels * 135,
      layout: { textColor: '#9aa8b8', fontFamily: 'Inter, Segoe UI, Malgun Gothic, sans-serif' },
      rightPriceScale: {
        mode: settings.current.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.06 },
      },
      timeScale: { minBarSpacing: 0.001, borderVisible: false, lockVisibleTimeRangeOnResize: true },
      localization: { locale: 'ko-KR' },
    });
    chartRef.current = chart;
    const price = candles?.length
      ? chart.addSeries(CandlestickSeries, {
          upColor: '#55c8af',
          downColor: '#e98a98',
          wickUpColor: '#55c8af',
          wickDownColor: '#e98a98',
          borderVisible: false,
          priceLineVisible: false,
          priceFormat: { type: 'custom', formatter: (v: number) => money(v, unit) },
        })
      : chart.addSeries(LineSeries, {
          color: '#65d4bc',
          lineWidth: 2,
          priceLineVisible: false,
          priceFormat: { type: 'custom', formatter: (v: number) => money(v, unit) },
        });
    if (candles?.length) price.setData(candles.map((p) => ({ ...p, time: ts(p.time) })));
    else price.setData(gapData(points, step));
    const cursorSeries = [{ series: price, values: new Map(points.map((p) => [p.time, p.value])) }];
    const panes = new Map<string, number>();
    for (const line of lines.filter((l) => l.data.length)) {
      const paneKey = line.pane ?? line.id;
      if (!line.overlay && !panes.has(paneKey)) panes.set(paneKey, panes.size + 1);
      const index = line.overlay ? 0 : panes.get(paneKey)!;
      const series = chart.addSeries(
        LineSeries,
        {
          title: line.title + ' · ' + line.unit,
          color: line.color,
          lineWidth: 1,
          priceLineVisible: false,
          priceFormat: {
            type: 'custom',
            formatter: (v: number) => numeric(v, readingDigits(v)),
          },
        },
        index,
      );
      series.setData(gapData(line.data, line.step ?? 86400));
      cursorSeries.push({ series, values: new Map(line.data.map((p) => [p.time, p.value])) });
      for (const level of line.thresholds ??
        (line.unit === 'RSI'
          ? [30, 70]
          : line.id.includes('mvrv')
            ? [1]
            : line.id.includes('funding')
              ? [0]
              : [])) {
        series.createPriceLine({
          price: level,
          color: '#8292a5',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: String(level),
        });
      }
      if (index)
        series
          .priceScale()
          .applyOptions({ mode: PriceScaleMode.Normal, scaleMargins: { top: 0.2, bottom: 0.15 } });
    }
    chart.panes()[0].setStretchFactor(3);
    for (const p of chart.panes().slice(1)) p.setStretchFactor(1);
    const dates = new Set(points.map((p) => p.time));
    const markers = createSeriesMarkers(
      price,
      signals
        .filter((s) => s.status !== 'withdrawn' && dates.has(s.time))
        .map((s) => ({
          id: s.id,
          time: ts(s.time),
          position: 'aboveBar' as const,
          color: '#e7c681',
          shape: 'circle' as const,
          text: '',
        })),
    );
    chart.subscribeClick((e) => {
      const s =
        signals.find((s) => s.id === e.hoveredObjectId) ??
        signals.find((s) => s.time === Number(e.time));
      if (s) click.current(s);
    });
    chart.subscribeCrosshairMove((e) => {
      if (manualCursor.current) return;
      setSelectionKey(key);
      setSelected(e.time === undefined ? null : Number(e.time));
    });
    moveCursor.current = (time) => {
      if (time === null) {
        chart.clearCrosshairPosition();
        return;
      }
      const target = cursorSeries.find((entry) => entry.values.has(time));
      if (!target) {
        chart.clearCrosshairPosition();
        return;
      }
      const range = chart.timeScale().getVisibleRange();
      if (range && (time < Number(range.from) || time > Number(range.to))) {
        const width = Number(range.to) - Number(range.from);
        chart.timeScale().setVisibleRange({ from: ts(time - width / 2), to: ts(time + width / 2) });
      }
      chart.setCrosshairPosition(target.values.get(time)!, ts(time), target.series);
    };
    const prior = previous.current;
    const from = periodStart(settings.current.period, points.at(-1)!.time);
    const visible = points.filter((p) => p.time >= from);
    if (prior?.key === key)
      chart.timeScale().setVisibleRange({ from: ts(prior.from), to: ts(prior.to) });
    else if (visible.length)
      chart
        .timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    const surface = host.current;
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (range) {
        surface.dataset.visibleFrom = String(range.from);
        surface.dataset.visibleTo = String(range.to);
      }
    });
    surface.dataset.observations = String(points.length);
    return () => {
      const range = chart.timeScale().getVisibleRange();
      if (range) previous.current = { key, from: Number(range.from), to: Number(range.to) };
      markers.detach();
      chart.remove();
      chartRef.current = null;
      moveCursor.current = () => {};
    };
  }, [key, points, candles, lines, signals, asset, unit, source, step]);
  useEffect(() => {
    chartRef.current
      ?.priceScale('right', 0)
      .applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);
  useEffect(() => {
    const visible = points.filter((p) => p.time >= periodStart(period, points.at(-1)?.time ?? 0));
    manualCursor.current = false;
    setSelected(null);
    chartRef.current?.clearCrosshairPosition();
    if (visible.length)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
  }, [period, key, rangeRevision]);
  useEffect(() => {
    if (focus)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(focus - 90 * 86400), to: ts(focus + 90 * 86400) });
  }, [focus, points]);
  return (
    <>
      <div className="analysis-legend">
        <span>
          {asset} · {unit}
        </span>
        <span>
          {timestamp(time)} <b>{money(priceValue, unit)}</b>
        </span>
        {lines.map((l, i) => (
          <span key={l.id} title={l.source}>
            <i style={{ background: l.color }} />
            {l.title}{' '}
            <b>{metricNumber(time === undefined ? undefined : readings.maps[i + 1].get(time))}</b>{' '}
            {l.unit}
          </span>
        ))}
      </div>
      <div
        ref={host}
        className="analysis-canvas"
        style={{ height: 370 + panelCount(lines) * 135 }}
        data-chart-kind="analysis"
        data-asset={asset}
        onPointerDown={() => {
          manualCursor.current = false;
        }}
        tabIndex={0}
        role="group"
        aria-label={`${asset} ${unit} 가격과 비교 지표. 좌우 방향키로 관측 탐색`}
        onKeyDown={(e) => {
          if (
            e.target !== e.currentTarget ||
            !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)
          )
            return;
          e.preventDefault();
          explore(
            e.key === 'Escape'
              ? null
              : e.key === 'Home'
                ? (readings.times[0] ?? null)
                : e.key === 'End'
                  ? (readings.times.at(-1) ?? null)
                  : adjacentObservation(
                      readings.times,
                      time ?? null,
                      e.key === 'ArrowLeft' ? -1 : 1,
                    ),
          );
        }}
      />
      <div className="analysis-date-controls" role="group" aria-label="차트 날짜 탐색">
        <button
          aria-label="이전 관측"
          disabled={time === readings.times[0]}
          onClick={() => explore(adjacentObservation(readings.times, time ?? null, -1))}
        >
          ←
        </button>
        <label>
          날짜{' '}
          <input
            type="date"
            aria-label="차트 탐색 날짜 (UTC)"
            value={time === undefined ? '' : new Date(time * 1000).toISOString().slice(0, 10)}
            min={
              readings.times.length
                ? new Date(readings.times[0] * 1000).toISOString().slice(0, 10)
                : undefined
            }
            max={
              readings.times.length
                ? new Date(readings.times.at(-1)! * 1000).toISOString().slice(0, 10)
                : undefined
            }
            onInput={(e) => {
              const t = Date.parse(e.currentTarget.value + 'T00:00:00Z') / 1000;
              if (Number.isFinite(t) && e.currentTarget.validity.valid) explore(t);
            }}
            onChange={(e) => {
              const t = Date.parse(e.target.value + 'T00:00:00Z') / 1000;
              if (Number.isFinite(t) && e.target.validity.valid) explore(t);
            }}
          />
        </label>
        <button
          aria-label="다음 관측"
          disabled={time === readings.times.at(-1)}
          onClick={() => explore(adjacentObservation(readings.times, time ?? null, 1))}
        >
          →
        </button>
        <button onClick={() => explore(null)} disabled={selectedTime === null}>
          최신 값
        </button>
      </div>
      <span className="sr-only" role="status">
        {selectedTime !== null
          ? `${timestamp(time)} ${asset} ${money(priceValue, unit)}. ${lines.map((l, i) => `${l.title} ${metricNumber(time === undefined ? undefined : readings.maps[i + 1].get(time))} ${l.unit}`).join('. ')}`
          : ''}
      </span>
      <details className="analysis-tools">
        <summary>내보내기 · 공유 · 날짜별 수치</summary>
        <ChartTools
          chart={chartRef}
          rows={points}
          label={asset}
          unit={unit}
          source={source}
          onReset={onAll}
          onExport={exportReadings}
          exportLabel="가격·지표 CSV"
        />
        <button
          onClick={() => {
            const canvas = chartRef.current?.takeScreenshot();
            if (!canvas) return;
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = `Coin-Desk-${asset}-${unit}.png`;
            a.click();
          }}
        >
          차트 이미지 저장
        </button>
        <div className="analysis-table">
          <table>
            <caption>{asset} 가격·지표 · 날짜별 관측 (최근순)</caption>
            <thead>
              <tr>
                <th>UTC 날짜</th>
                <th>가격 · {unit}</th>
                {lines.map((l) => (
                  <th key={l.id}>
                    {l.title} · {l.unit}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {readings.times
                .slice(-tableCount)
                .reverse()
                .map((t) => (
                  <tr key={t}>
                    <td>{timestamp(t)}</td>
                    <td>{money(readings.maps[0].get(t), unit)}</td>
                    {lines.map((l, i) => (
                      <td key={l.id}>{metricNumber(readings.maps[i + 1].get(t))}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {tableCount < readings.times.length && (
          <button onClick={() => setTableCount((n) => n + 100)}>이전 100개 표시</button>
        )}
      </details>
    </>
  );
});
