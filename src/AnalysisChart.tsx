import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  LineSeries,
  PriceScaleMode,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from 'lightweight-charts';
import { createDeskChart } from './chart-theme';
import type { Candle, Period, Point } from '../shared/types';
import type { ObservationSignal } from '../shared/signals';
import { money, numeric, periodStart } from './lib';
import { ChartTools } from './ChartNavigator';
import { DateNavigator } from './DateNavigator';
import { availableWindow, type DateWindow } from '../shared/date-navigation';
import { ChartDrawings } from './ChartDrawings';
import { BandPrimitive, type BandRow } from './BandPrimitive';
import type { Annotation, DrawingKind } from '../shared/annotations';
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
export interface ChartObservation {
  time: number;
  label: string;
  id?: string;
  direction?: 'up' | 'down' | 'neutral';
}
const EMPTY_OBSERVATIONS: ChartObservation[] = [];
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
  primary,
  initialWindow,
  drawingKey,
  onAnnotations,
  onVisibleRange,
  observations = EMPTY_OBSERVATIONS,
  onObservation,
  initialTool,
  bands,
  onReadingDate,
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
  primary?: AnalysisLine;
  initialWindow?: DateWindow | null;
  drawingKey?: string;
  onAnnotations?: (items: Annotation[]) => void;
  onVisibleRange?: (range: DateWindow) => void;
  observations?: ChartObservation[];
  onObservation?: (id: string) => void;
  initialTool?: DrawingKind;
  bands?: BandRow[];
  onReadingDate?: (time: number | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null);
  const moveCursor = useRef<(time: number | null) => void>(() => {});
  const manualCursor = useRef(false);
  const click = useRef(onSignal);
  click.current = onSignal;
  const observationClick = useRef(onObservation);
  observationClick.current = onObservation;
  const settings = useRef({ period, log });
  settings.current = { period, log };
  const previous = useRef<{ key: string; from: number; to: number } | null>(null);
  const userRange = useRef(false);
  const appliedFocus = useRef<string | null>(null);
  const rangeCallback = useRef(onVisibleRange);
  rangeCallback.current = onVisibleRange;
  const [drawingApi, setDrawingApi] = useState<{
    chart: IChartApi;
    series: ISeriesApi<SeriesType>;
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null),
    [tableCount, setTableCount] = useState(50);
  const [visibleWindow, setVisibleWindow] = useState<DateWindow | null>(null);
  const key = asset + unit + source + step + (primary?.id ?? 'price');
  const structure = lines.map((l) => [l.id, l.pane, l.overlay].join(':')).join('|');
  const ready = points.length > 0;
  const candleMode = !!candles?.length;
  const latest = useRef({ points, candles, lines, signals, observations, bands, initialWindow });
  latest.current = { points, candles, lines, signals, observations, bands, initialWindow };
  const updateSeries = useRef<() => void>(() => {});
  const chartHeight = () =>
    (host.current && host.current.clientWidth < 600 ? 330 : 440) +
    panelCount(latest.current.lines) * 135;
  const display = (value: number | undefined) =>
    primary || !['USD', 'USDT', 'KRW'].includes(unit)
      ? numeric(value, readingDigits(value)) + ' ' + unit
      : money(value, unit);
  const columns = useMemo(
    () => [{ title: primary?.title ?? asset, unit, source, data: points }, ...lines],
    [asset, unit, source, points, lines, primary?.title],
  );
  const readings = useMemo(() => readingIndex(columns), [columns]);
  const [selectionKey, setSelectionKey] = useState(key);
  const selectedTime = selectionKey === key ? selected : null;
  const time = selectedTime ?? points.at(-1)?.time;
  const priceValue = time === undefined ? undefined : readings.maps[0].get(time);
  useEffect(() => {
    onReadingDate?.(time ?? null);
  }, [time, onReadingDate]);
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
      autoSize: false,
      width: Math.max(1, host.current.clientWidth),
      height: chartHeight(),
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
          color: primary?.color ?? '#65d4bc',
          lineWidth: 2,
          priceLineVisible: false,
          priceFormat: { type: 'custom', formatter: (v: number) => display(v) },
        });
    if (candles?.length) price.setData(candles.map((p) => ({ ...p, time: ts(p.time) })));
    else price.setData(gapData(points, step));
    const bandPrimitive = bands ? new BandPrimitive(bands) : null;
    if (bandPrimitive) price.attachPrimitive(bandPrimitive);
    if (primary)
      for (const level of primary.thresholds ??
        (primary.id.includes('mvrv') ? [1] : primary.id.includes('funding') ? [0] : [])) {
        price.createPriceLine({
          price: level,
          color: '#8292a5',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: String(level),
        });
      }
    const cursorSeries = [
      { id: 'primary', series: price, values: new Map(points.map((p) => [p.time, p.value])) },
    ];
    const panes = new Map<string, number>();
    for (const line of lines) {
      const paneKey = line.pane ?? line.id;
      if (!line.overlay && !panes.has(paneKey)) panes.set(paneKey, panes.size + 1);
      const index = line.overlay ? 0 : panes.get(paneKey)!;
      const series = chart.addSeries(
        LineSeries,
        {
          // The library can still show a title badge when lastValueVisible is false.
          title: line.id.startsWith('band:') ? '' : line.title + ' · ' + line.unit,
          lastValueVisible: !line.id.startsWith('band:'),
          crosshairMarkerVisible: !line.id.startsWith('band:'),
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
      cursorSeries.push({
        id: line.id,
        series,
        values: new Map(line.data.map((p) => [p.time, p.value])),
      });
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
      [
        ...signals
          .filter((s) => s.status !== 'withdrawn' && dates.has(s.time))
          .map((s) => ({
            id: s.id,
            time: ts(s.time),
            position: 'aboveBar' as const,
            color: '#e7c681',
            shape: 'circle' as const,
            text: '',
          })),
        ...observations
          .filter((s) => dates.has(s.time))
          .map((s) => ({
            id: s.id ?? 'calculated:' + s.time,
            time: ts(s.time),
            position: s.direction === 'down' ? ('aboveBar' as const) : ('belowBar' as const),
            color:
              s.direction === 'down' ? '#e98a98' : s.direction === 'up' ? '#55c8af' : '#dfb873',
            shape:
              s.direction === 'down'
                ? ('arrowDown' as const)
                : s.direction === 'neutral'
                  ? ('circle' as const)
                  : ('arrowUp' as const),
            // Large histories can contain hundreds of patterns. Keep the price readable;
            // the clickable marker and accessible observation list retain every label.
            text: s.id ? '' : s.label,
          })),
      ].sort((a, b) => Number(a.time) - Number(b.time)),
    );
    chart.subscribeClick((e) => {
      const observation = latest.current.observations.find(
        (o) => o.id && o.id === e.hoveredObjectId,
      );
      if (observation?.id) {
        observationClick.current?.(observation.id);
        return;
      }
      const s =
        latest.current.signals.find((s) => s.id === e.hoveredObjectId) ??
        latest.current.signals.find((s) => s.time === Number(e.time));
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
    updateSeries.current = () => {
      const data = latest.current;
      const range = chart.timeScale().getVisibleRange();
      if (candleMode) price.setData((data.candles ?? []).map((p) => ({ ...p, time: ts(p.time) })));
      else price.setData(gapData(data.points, step));
      cursorSeries[0].values = new Map(data.points.map((p) => [p.time, p.value]));
      for (const entry of cursorSeries.slice(1)) {
        const line = data.lines.find((l) => l.id === entry.id);
        entry.series.setData(gapData(line?.data ?? [], line?.step ?? 86400));
        entry.values = new Map((line?.data ?? []).map((p) => [p.time, p.value]));
      }
      bandPrimitive?.setRows(data.bands ?? []);
      const dates = new Set(data.points.map((p) => p.time));
      markers.setMarkers(
        [
          ...data.signals
            .filter((s) => s.status !== 'withdrawn' && dates.has(s.time))
            .map((s) => ({
              id: s.id,
              time: ts(s.time),
              position: 'aboveBar' as const,
              color: '#e7c681',
              shape: 'circle' as const,
              text: '',
            })),
          ...data.observations
            .filter((s) => dates.has(s.time))
            .map((s) => ({
              id: s.id ?? 'calculated:' + s.time,
              time: ts(s.time),
              position: s.direction === 'down' ? ('aboveBar' as const) : ('belowBar' as const),
              color: s.direction === 'down' ? '#e98a98' : '#55c8af',
              shape: s.direction === 'down' ? ('arrowDown' as const) : ('arrowUp' as const),
              text: s.id ? '' : s.label,
            })),
        ].sort((a, b) => Number(a.time) - Number(b.time)),
      );
      host.current!.dataset.observations = String(data.points.length);
      if (range && userRange.current) chart.timeScale().setVisibleRange(range);
      else {
        const explicit = availableWindow(
          data.points.map((p) => p.time),
          data.initialWindow,
        );
        const visible = data.points.filter(
          (p) => p.time >= periodStart(settings.current.period, data.points.at(-1)?.time ?? 0),
        );
        if (explicit)
          chart.timeScale().setVisibleRange({ from: ts(explicit.from), to: ts(explicit.to) });
        else if (visible.length)
          chart
            .timeScale()
            .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
      }
    };
    const prior = previous.current;
    const from = periodStart(settings.current.period, points.at(-1)!.time);
    const visible = points.filter((p) => p.time >= from);
    const restoreDefault = () => {
      const data = latest.current;
      const visible = data.points.filter(
        (p) => p.time >= periodStart(settings.current.period, data.points.at(-1)?.time ?? 0),
      );
      const explicit = availableWindow(
        data.points.map((p) => p.time),
        data.initialWindow,
      );
      if (explicit)
        chart.timeScale().setVisibleRange({ from: ts(explicit.from), to: ts(explicit.to) });
      else if (visible.length)
        chart
          .timeScale()
          .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    };
    if (prior?.key === key && userRange.current)
      chart.timeScale().setVisibleRange({ from: ts(prior.from), to: ts(prior.to) });
    else if (visible.length)
      chart
        .timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    const surface = host.current;
    const updateWindow = (
      range: ReturnType<ReturnType<IChartApi['timeScale']>['getVisibleRange']>,
    ) => {
      if (range) {
        surface.dataset.visibleFrom = String(range.from);
        surface.dataset.visibleTo = String(range.to);
        setVisibleWindow({ from: Number(range.from), to: Number(range.to) });
        rangeCallback.current?.({ from: Number(range.from), to: Number(range.to) });
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(updateWindow);
    updateWindow(chart.timeScale().getVisibleRange());
    surface.dataset.observations = String(points.length);
    const resize = new ResizeObserver(() => {
      const range = chart.timeScale().getVisibleRange();
      const height = chartHeight();
      surface.style.height = height + 'px';
      chart.resize(Math.max(1, surface.clientWidth), height);
      if (userRange.current && range) chart.timeScale().setVisibleRange(range);
      else restoreDefault();
    });
    resize.observe(surface);
    const restored = availableWindow(readings.times, initialWindow);
    if (restored && !userRange.current)
      chart.timeScale().setVisibleRange({ from: ts(restored.from), to: ts(restored.to) });
    // LWC settles pane/price-axis widths on its first animation frame. Restore only
    // after that layout, rather than capturing its temporary default bar spacing.
    surface.dataset.rangeReady = '0';
    const frame = requestAnimationFrame(() => {
      if (!userRange.current) restoreDefault();
      updateWindow(chart.timeScale().getVisibleRange());
      surface.dataset.rangeReady = '1';
    });
    setDrawingApi({ chart, series: price });
    return () => {
      const range = chart.timeScale().getVisibleRange();
      if (range) previous.current = { key, from: Number(range.from), to: Number(range.to) };
      markers.detach();
      resize.disconnect();
      cancelAnimationFrame(frame);
      chart.remove();
      chartRef.current = null;
      updateSeries.current = () => {};
      moveCursor.current = () => {};
    };
  }, [key, structure, ready, candleMode]);
  useEffect(() => {
    updateSeries.current();
  }, [points, candles, lines, signals, observations, bands]);
  useEffect(() => {
    chartRef.current
      ?.priceScale('right', 0)
      .applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);
  useEffect(() => {
    userRange.current = false;
    appliedFocus.current = null;
    const visible = points.filter((p) => p.time >= periodStart(period, points.at(-1)?.time ?? 0));
    manualCursor.current = false;
    setSelected(null);
    chartRef.current?.clearCrosshairPosition();
    if (visible.length)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    const restored = availableWindow(readings.times, initialWindow);
    if (restored)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(restored.from), to: ts(restored.to) });
  }, [period, key, rangeRevision, initialWindow?.from, initialWindow?.to]);
  useEffect(() => {
    if (!focus) {
      appliedFocus.current = null;
      return;
    }
    if (!chartRef.current || !points.length) return;
    const token = `${key}:${focus}`;
    if (appliedFocus.current === token) return;
    // A shared date window wins on entry. A newly selected observation clears that
    // window upstream. Preserve either selection through the first resize/frame
    // and subsequent data refreshes, including any later manual pan or zoom.
    const window =
      availableWindow(readings.times, initialWindow) ??
      availableWindow(readings.times, { from: focus - 90 * 86400, to: focus + 90 * 86400 });
    if (window) {
      userRange.current = true;
      chartRef.current.timeScale().setVisibleRange({ from: ts(window.from), to: ts(window.to) });
      appliedFocus.current = token;
    }
  }, [focus, points, key, period, rangeRevision, initialWindow?.from, initialWindow?.to]);
  return (
    <>
      <div className="analysis-legend">
        <span>
          {asset} · {primary?.title ?? unit}
        </span>
        <span>
          {timestamp(time)} <b>{display(priceValue)}</b>
        </span>
        {lines.map((l, i) =>
          l.id.startsWith('band:') ? null : (
            <span key={l.id} title={l.source}>
              <i style={{ background: l.color }} />
              {l.title}{' '}
              <b>
                {metricNumber(
                  selectedTime === null
                    ? l.data.at(-1)?.value
                    : time === undefined
                      ? undefined
                      : readings.maps[i + 1].get(time),
                )}
              </b>{' '}
              {l.unit}
              {l.warning && <small role="status"> · {l.warning}</small>}
              {selectedTime === null && l.data.at(-1)?.time !== time && (
                <small> · {timestamp(l.data.at(-1)?.time).slice(0, 10)}</small>
              )}
            </span>
          ),
        )}
      </div>
      <div className={'analysis-surface' + (drawingKey ? ' with-drawings' : '')}>
        <div
          ref={host}
          className="analysis-canvas"
          style={{ height: 440 + panelCount(lines) * 135 }}
          data-chart-kind="analysis"
          data-asset={asset}
          data-primary-metric={primary?.id ?? 'price'}
          onPointerDown={() => {
            manualCursor.current = false;
            userRange.current = true;
          }}
          onWheel={() => {
            userRange.current = true;
          }}
          tabIndex={0}
          role="group"
          aria-label={`${asset} ${unit} ${primary?.title ?? '가격과 비교 지표'}. 좌우 방향키로 관측 탐색`}
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
        {drawingKey && drawingApi && (
          <ChartDrawings
            key={drawingKey}
            chart={drawingApi.chart}
            series={drawingApi.series}
            storageKey={drawingKey}
            onChange={onAnnotations}
            initialTool={initialTool}
          />
        )}
      </div>
      <DateNavigator
        key={key}
        times={readings.times}
        visible={visibleWindow}
        selected={time}
        onRange={(range) => {
          userRange.current = true;
          chartRef.current?.timeScale().setVisibleRange({ from: ts(range.from), to: ts(range.to) });
        }}
        onSelect={explore}
        onReset={() => {
          explore(null);
          userRange.current = false;
          chartRef.current?.timeScale().fitContent();
          onAll();
        }}
      />
      <span className="sr-only" role="status">
        {selectedTime !== null
          ? `${timestamp(time)} ${asset} ${display(priceValue)}. ${lines.map((l, i) => `${l.title} ${metricNumber(time === undefined ? undefined : readings.maps[i + 1].get(time))} ${l.unit}`).join('. ')}`
          : ''}
      </span>
      <details className="analysis-tools">
        <summary>내보내기 · 공유 · 날짜별 수치</summary>
        <ChartTools
          chart={chartRef}
          shareVisibleRange
          rows={points}
          label={asset}
          unit={unit}
          source={source}
          onReset={onAll}
          onExport={exportReadings}
          exportLabel={primary ? '지표 CSV' : '가격·지표 CSV'}
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
            <caption>
              {asset} {primary?.title ?? '가격·지표'} · 날짜별 관측 (최근순)
            </caption>
            <thead>
              <tr>
                <th>UTC 날짜</th>
                <th>
                  {primary?.title ?? '가격'} · {unit}
                </th>
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
                    <td>{display(readings.maps[0].get(t))}</td>
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
