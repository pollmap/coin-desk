import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw } from 'lucide-react';
import {
  CandlestickSeries,
  CrosshairMode,
  LineSeries,
  PriceScaleMode,
  TrackingModeExitMode,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type SeriesType,
  type UTCTimestamp,
  type MouseEventParams,
  type LogicalRange,
} from 'lightweight-charts';
import { createDeskChart } from './chart-theme';
import { eligibleChartPrice, type LiveChartPrice } from '../shared/live-chart-price';
import type { Candle, Period, Point } from '../shared/types';
import type { ObservationSignal } from '../shared/signals';
import { money, numeric, periodStart, priceDigits } from './lib';
import { ChartTools } from './ChartNavigator';
import { DateNavigator } from './DateNavigator';
import { availableWindow, type DateWindow } from '../shared/date-navigation';
import { ChartDrawings } from './ChartDrawings';
import { BandPrimitive, type BandRow } from './BandPrimitive';
import { SupertrendPrimitive } from './SupertrendPrimitive';
import type { SupertrendRow } from '../shared/supertrend';
import type { Interval } from '../shared/types';
import type { Annotation, DrawingKind } from '../shared/annotations';
import {
  adjacentObservation,
  readingIndex,
  readingsCsv,
  readingDigits,
} from '../shared/chart-readings';
import {
  chartDate,
  chartTick,
  chartPrecision,
  inspectionPosition,
  logicalRangeChanged,
  mobileChartHeight,
  boundedLogicalPan,
  restoreLogicalView,
  type LogicalViewAnchor,
} from './chart-interaction';

export interface AnalysisLine {
  id: string;
  title: string;
  legendTitle?: string;
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
  supertrend?: { rows: SupertrendRow[]; interval: Interval };
}
export interface ChartObservation {
  time: number;
  label: string;
  id?: string;
  direction?: 'up' | 'down' | 'neutral';
}
const EMPTY_OBSERVATIONS: ChartObservation[] = [];
interface ChartInspection {
  time: number;
  x: number;
  y: number;
  pane: number;
  top: number;
  width: number;
  height: number;
  observationX: number;
  observationY: number | null;
  values: { id: string; title: string; unit: string; value: number; color?: string }[];
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
  onDateSelect,
  initialReadingDate,
  exportName,
  readingLabel,
  toolbarTarget,
  livePrice,
  summaryLabel,
  advancedTools = true,
  toolsTarget,
  publicFocus = true,
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
  onReadingDate?: (time: number | null, pinned?: boolean) => void;
  onDateSelect?: (time: number | null, range?: DateWindow) => void;
  initialReadingDate?: number;
  exportName?: string;
  readingLabel?: string;
  toolbarTarget?: HTMLElement | null;
  livePrice?: LiveChartPrice | null;
  summaryLabel?: string;
  advancedTools?: boolean;
  toolsTarget?: HTMLElement | null;
  /** Public charts show the latest value and keep legacy exploration state internal. */
  publicFocus?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null);
  const liveSeries = useRef<ISeriesApi<SeriesType> | null>(null);
  const liveLine = useRef<IPriceLine | null>(null);
  const moveCursor = useRef<(time: number | null, preserveRange?: boolean) => void>(() => {});
  const manualCursor = useRef(false);
  const keyboardInspection = useRef<number | null>(null);
  const inspectionRef = useRef<ChartInspection | null>(null);
  const [inspection, setInspection] = useState<ChartInspection | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 6, top: 6, maxWidth: 240 });
  const touchInspection = useRef(false);
  const pointerKind = useRef('mouse');
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    baseline: { from: number; to: number } | null;
    moved: boolean;
    expires: number;
  } | null>(null);
  const inspectAt = useRef<(x: number, y: number) => void>(() => {});
  const inspectionFrame = useRef(0);
  const tapFrame = useRef(0);
  const cursorFrame = useRef(0);
  const publicMode = useRef(publicFocus);
  publicMode.current = publicFocus;
  const [pinned, setPinned] = useState(false);
  const click = useRef(onSignal);
  click.current = onSignal;
  const observationClick = useRef(onObservation);
  observationClick.current = onObservation;
  const dateSelect = useRef(onDateSelect);
  dateSelect.current = onDateSelect;
  const settings = useRef({ period, log });
  settings.current = { period, log };
  const previous = useRef<{
    key: string;
    from: number;
    to: number;
    logical?: LogicalViewAnchor | null;
  } | null>(null);
  const userRange = useRef(false);
  // LWC applies a range on its next frame. A React data update before that frame
  // must retain the requested window rather than read back the previous one.
  const pendingRange = useRef<DateWindow | null>(null);
  const pendingLogicalRange = useRef<{ from: number; to: number } | null>(null);
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
  const chartHeight = () => {
    const surface = host.current;
    const viewport = window.visualViewport;
    const navigation = document.querySelector<HTMLElement>('.product-nav');
    const navigationHeight =
      navigation && getComputedStyle(navigation).position === 'fixed'
        ? navigation.getBoundingClientRect().height
        : 0;
    const base =
      surface && surface.clientWidth < 600
        ? mobileChartHeight(
            viewport?.height ?? window.innerHeight,
            surface.getBoundingClientRect().top + window.scrollY,
            navigationHeight,
          )
        : 440;
    return base + panelCount(latest.current.lines) * 135;
  };
  const primaryPrecision = useMemo(
    () =>
      chartPrecision(
        points.map((p) => p.value),
        (v) =>
          primary || !['USD', 'USDT', 'KRW'].includes(unit)
            ? readingDigits(v)
            : priceDigits(v, unit),
      ),
    [points, primary, unit],
  );
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
  const summaryTime = pinned && selectedTime !== null ? selectedTime : points.at(-1)?.time;
  const summaryValue = summaryTime === undefined ? undefined : readings.maps[0].get(summaryTime);
  const visibleSummaryTime = publicFocus ? points.at(-1)?.time : summaryTime;
  const visibleSummaryValue = publicFocus
    ? visibleSummaryTime === undefined
      ? undefined
      : readings.maps[0].get(visibleSummaryTime)
    : summaryValue;
  useEffect(() => {
    onReadingDate?.(summaryTime ?? null, pinned && selectedTime !== null);
  }, [summaryTime, pinned, selectedTime, onReadingDate]);
  const timestamp = (t: number | undefined) =>
    t === undefined
      ? '—'
      : new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const showReadingTime = useMemo(
    () => step < 86400 || points.some((point) => point.time % 86400 !== 0),
    [points, step],
  );
  const metricNumber = (value: number | undefined) => numeric(value, readingDigits(value));
  const lineNumber = (line: AnalysisLine, value: number | undefined) =>
    numeric(value, line.supertrend ? priceDigits(value ?? 0, line.unit) : readingDigits(value));
  const fileName = (exportName ?? `${asset}-${unit}`).replace(/[\\/:*?"<>|]/g, '-');
  function dismissInspection() {
    cancelAnimationFrame(tapFrame.current);
    cancelAnimationFrame(inspectionFrame.current);
    cancelAnimationFrame(cursorFrame.current);
    tapFrame.current = 0;
    inspectionFrame.current = 0;
    cursorFrame.current = 0;
    touchInspection.current = false;
    manualCursor.current = false;
    keyboardInspection.current = null;
    inspectionRef.current = null;
    setInspection(null);
    setSelected(null);
    chartRef.current?.clearCrosshairPosition();
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        publicMode.current &&
        event.target instanceof Node &&
        !host.current?.contains(event.target)
      )
        dismissInspection();
    };
    const escape = (event: KeyboardEvent) => {
      if (
        publicMode.current &&
        event.key === 'Escape' &&
        (inspectionRef.current ||
          cursorFrame.current ||
          tapFrame.current ||
          inspectionFrame.current)
      )
        dismissInspection();
    };
    const releaseOutside = (event: PointerEvent) => {
      if (
        !activePointers.current.has(event.pointerId) ||
        (event.target instanceof Node && host.current?.contains(event.target))
      )
        return;
      activePointers.current.delete(event.pointerId);
      if (gesture.current) gesture.current.expires = performance.now() + 250;
      if (publicMode.current) dismissInspection();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('pointerup', releaseOutside, true);
    document.addEventListener('pointercancel', releaseOutside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointerup', releaseOutside, true);
      document.removeEventListener('pointercancel', releaseOutside, true);
      document.removeEventListener('keydown', escape);
      activePointers.current.clear();
      gesture.current = null;
    };
  }, []);
  useEffect(() => {
    if (!inspection || !host.current || !tooltip.current) return;
    const surface = host.current.getBoundingClientRect();
    const visual = window.visualViewport;
    const viewTop = visual?.offsetTop ?? 0;
    const viewBottom = viewTop + (visual?.height ?? window.innerHeight);
    const nav = document.querySelector<HTMLElement>('.product-nav');
    const bottom =
      nav && getComputedStyle(nav).position === 'fixed'
        ? Math.min(viewBottom, nav.getBoundingClientRect().top)
        : viewBottom;
    const top = Math.max(inspection.top, viewTop - surface.top);
    const plotBottom = Math.min(inspection.top + inspection.height, bottom - surface.top);
    const rect = tooltip.current.getBoundingClientRect();
    const position = inspectionPosition(
      { x: inspection.x, y: inspection.top + inspection.y },
      { left: 0, top, width: inspection.width, height: Math.max(1, plotBottom - top) },
      { width: rect.width, height: rect.height },
      pointerKind.current === 'touch',
    );
    setTooltipPosition({
      ...position,
      left: position.left + host.current.offsetLeft,
      top: position.top + host.current.offsetTop,
    });
  }, [inspection]);
  function explore(t: number | null, preserveRange = false) {
    // A layout change under the pointer must not immediately replace “latest”.
    // Resume hover readings only on the next real pointer movement over the plot.
    manualCursor.current = true;
    setPinned(t !== null);
    setSelectionKey(key);
    setSelected(t);
    moveCursor.current(t, preserveRange);
    if (!preserveRange) {
      const range = pendingRange.current ?? chartRef.current?.timeScale().getVisibleRange();
      dateSelect.current?.(
        t,
        range ? { from: Number(range.from), to: Number(range.to) } : undefined,
      );
    }
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
    a.download = `borichart-${fileName}-indicators.csv`;
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
        alignLabels: true,
        entireTextOnly: true,
        minimumWidth: 56,
      },
      timeScale: {
        minBarSpacing: 0.001,
        borderVisible: false,
        lockVisibleTimeRangeOnResize: true,
        timeVisible: step < 86400,
        tickMarkFormatter: (time: number, type: number) => chartTick(time, type),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#0f666b', visible: true, labelVisible: true },
        horzLine: { color: '#0f666b', visible: true, labelVisible: true },
      },
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { pinch: true },
      trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
      localization: {
        locale: 'ko-KR',
        timeFormatter: (time: number) => chartDate(time, showReadingTime) + ' KST',
      },
    });
    chartRef.current = chart;
    const captureLogicalView = (): LogicalViewAnchor | null => {
      const logical = pendingLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange();
      const range = pendingRange.current ?? chart.timeScale().getVisibleRange();
      if (!logical || !range) return null;
      const time = Number(range.from);
      const index = chart.timeScale().timeToIndex(ts(time), true);
      if (index === null) return null;
      return { time, offset: logical.from - index, width: logical.to - logical.from };
    };
    const restoreLogical = (view: LogicalViewAnchor) => {
      const index = chart.timeScale().timeToIndex(ts(view.time), true);
      if (index === null) return false;
      const next = restoreLogicalView(view, index);
      pendingLogicalRange.current = next;
      chart.timeScale().setVisibleLogicalRange(next as LogicalRange);
      return true;
    };
    const price = candles?.length
      ? chart.addSeries(CandlestickSeries, {
          upColor: '#55c8af',
          downColor: '#e98a98',
          wickUpColor: '#55c8af',
          wickDownColor: '#e98a98',
          borderVisible: false,
          priceLineVisible: false,
          priceFormat: {
            type: 'custom',
            minMove: primaryPrecision.minMove,
            formatter: (v: number) => money(v, unit),
          },
        })
      : chart.addSeries(LineSeries, {
          color: primary?.color ?? '#65d4bc',
          lineWidth: 2,
          priceLineVisible: false,
          priceFormat: {
            type: 'custom',
            minMove: primaryPrecision.minMove,
            formatter: (v: number) => display(v),
          },
        });
    if (candles?.length) price.setData(candles.map((p) => ({ ...p, time: ts(p.time) })));
    else price.setData(gapData(points, step));
    liveSeries.current = price;
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
          title: '',
        });
      }
    const cursorSeries = [
      {
        id: 'primary',
        series: price,
        values: new Map(points.map((p) => [p.time, p.value])),
        pane: 0,
        title: primary?.title ?? '종가',
        unit,
        color: primary?.color,
      },
    ];
    const panes = new Map<string, number>();
    for (const line of lines) {
      const paneKey = line.pane ?? line.id;
      if (!line.overlay && !panes.has(paneKey)) panes.set(paneKey, panes.size + 1);
      const index = line.overlay ? 0 : panes.get(paneKey)!;
      const series = chart.addSeries(
        LineSeries,
        {
          // Detailed overlay values belong in the tooltip, not competing axis badges.
          title: '',
          lastValueVisible: false,
          crosshairMarkerVisible: !line.id.startsWith('band:'),
          color: line.color,
          lineVisible: !line.supertrend,
          lineWidth: 1,
          priceLineVisible: false,
          priceFormat: {
            type: 'custom',
            minMove: chartPrecision(
              line.data.map((p) => p.value),
              (v) => (line.supertrend ? priceDigits(v, line.unit) : readingDigits(v)),
            ).minMove,
            formatter: (v: number) => lineNumber(line, v),
          },
        },
        index,
      );
      series.setData(gapData(line.data, line.step ?? 86400));
      const primitive = line.supertrend
        ? new SupertrendPrimitive(line.supertrend.rows, line.supertrend.interval)
        : undefined;
      if (primitive) series.attachPrimitive(primitive);
      cursorSeries.push({
        id: line.id,
        series,
        pane: index,
        title: line.legendTitle ?? line.title,
        unit: line.unit,
        color: line.color,
        values: new Map(line.data.map((p) => [p.time, p.value])),
        ...(primitive ? { primitive } : {}),
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
      if (publicMode.current) return;
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
      if (typeof e.time === 'number') {
        manualCursor.current = true;
        setPinned(true);
        setSelectionKey(key);
        const range = pendingRange.current ?? chart.timeScale().getVisibleRange();
        dateSelect.current?.(
          Number(e.time),
          range ? { from: Number(range.from), to: Number(range.to) } : undefined,
        );
        setSelected(e.time);
      }
    });
    const showInspection = (event: MouseEventParams) => {
      if (!publicMode.current && manualCursor.current) return;
      if (
        publicMode.current &&
        manualCursor.current &&
        keyboardInspection.current !== null &&
        event.time !== keyboardInspection.current
      )
        return;
      const paneIndex = event.paneIndex ?? 0;
      const pane = chart.panes()[paneIndex];
      const size = pane ? chart.paneSize(paneIndex) : undefined;
      if (
        !event.point ||
        typeof event.time !== 'number' ||
        !size ||
        event.point.x < -1 ||
        event.point.x > size.width + 1 ||
        event.point.y < -1 ||
        event.point.y > size.height + 1
      ) {
        if (touchInspection.current && !event.sourceEvent) return;
        inspectionRef.current = null;
      } else {
        const entries = cursorSeries.filter(
          (entry) =>
            entry.pane === paneIndex &&
            !entry.id.startsWith('band:') &&
            entry.values.has(Number(event.time)),
        );
        const values = entries
          .flatMap((entry) => {
            const row = event.seriesData.get(entry.series);
            const value =
              row && ('close' in row ? row.close : 'value' in row ? row.value : undefined);
            return typeof value === 'number' && Number.isFinite(value)
              ? [{ id: entry.id, title: entry.title, unit: entry.unit, value, color: entry.color }]
              : [];
          })
          .slice(0, 3);
        const first = entries.find((entry) => entry.id === values[0]?.id);
        const top =
          (pane?.getHTMLElement()?.getBoundingClientRect().top ??
            host.current!.getBoundingClientRect().top) - host.current!.getBoundingClientRect().top;
        inspectionRef.current = values.length
          ? {
              time: Number(event.time),
              x: event.point.x,
              y: event.point.y,
              pane: paneIndex,
              top,
              width: size.width,
              height: size.height,
              observationX: Number(
                chart.timeScale().timeToCoordinate(ts(Number(event.time))) ?? event.point.x,
              ),
              observationY: first?.series.priceToCoordinate(values[0].value) ?? null,
              values,
            }
          : null;
      }
      if (!inspectionFrame.current)
        inspectionFrame.current = requestAnimationFrame(() => {
          inspectionFrame.current = 0;
          const next = inspectionRef.current;
          setInspection(next);
          setSelectionKey(key);
          setSelected(next?.time ?? null);
        });
    };
    chart.subscribeCrosshairMove(showInspection);
    const syntheticInspection = (
      time: number,
      target: (typeof cursorSeries)[number],
      value: number,
      pointer?: { x: number; y: number },
    ) => {
      chart.setCrosshairPosition(value, ts(time), target.series);
      // LWC deliberately does not emit crosshairMove for its synthetic-position API.
      // Publish the same exact observation here for keyboard and tap inspection.
      const x = chart.timeScale().timeToCoordinate(ts(time));
      const y = target.series.priceToCoordinate(value);
      if (x === null || y === null) return;
      const seriesData: MouseEventParams['seriesData'] = new Map();
      for (const entry of cursorSeries) {
        const observed = entry.values.get(time);
        if (observed !== undefined)
          seriesData.set(entry.series, { time: ts(time), value: observed });
      }
      showInspection({
        time: ts(time),
        paneIndex: target.pane,
        point: (pointer ?? { x, y }) as NonNullable<MouseEventParams['point']>,
        seriesData,
      });
    };
    inspectAt.current = (x, y) => {
      const bounds = host.current!.getBoundingClientRect();
      const pane = chart.panes().find((p) => {
        const rect = p.getHTMLElement()?.getBoundingClientRect();
        return rect && y + bounds.top >= rect.top && y + bounds.top < rect.top + p.getHeight();
      });
      if (!pane) {
        dismissInspection();
        return;
      }
      const index = pane.paneIndex();
      const top = (pane.getHTMLElement()?.getBoundingClientRect().top ?? bounds.top) - bounds.top;
      const width = chart.paneSize(index).width;
      if (x < 0 || x > width) {
        dismissInspection();
        return;
      }
      const time = chart.timeScale().coordinateToTime(x);
      const target = cursorSeries.find(
        (entry) =>
          entry.pane === index &&
          !entry.id.startsWith('band:') &&
          typeof time === 'number' &&
          entry.values.has(time),
      );
      if (!target || typeof time !== 'number') {
        dismissInspection();
        return;
      }
      const value = target.series.coordinateToPrice(y - top);
      if (value === null || !Number.isFinite(value)) {
        dismissInspection();
        return;
      }
      touchInspection.current = true;
      syntheticInspection(time, target, value, { x, y: y - top });
    };
    moveCursor.current = (time, preserveRange = false) => {
      if (time === null) {
        chart.clearCrosshairPosition();
        return;
      }
      const target = cursorSeries.find((entry) => entry.values.has(time));
      if (!target) {
        chart.clearCrosshairPosition();
        return;
      }
      const range = pendingLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange();
      const index = chart.timeScale().timeToIndex(ts(time), true);
      let moved = false;
      if (!preserveRange && range && index !== null && (index < range.from || index > range.to)) {
        // Keyboard/date navigation is a user pan too. Preserve it through
        // ResizeObserver and data refresh, even without a prior drag/zoom.
        userRange.current = true;
        let first = Infinity,
          last = -Infinity;
        for (const series of [
          latest.current.points,
          ...latest.current.lines.map((line) => line.data),
        ]) {
          if (series.length) {
            first = Math.min(first, series[0].time);
            last = Math.max(last, series.at(-1)!.time);
          }
        }
        const firstIndex = chart.timeScale().timeToIndex(ts(first), true);
        const lastIndex = chart.timeScale().timeToIndex(ts(last), true);
        const next =
          firstIndex === null || lastIndex === null
            ? null
            : boundedLogicalPan(range, index, firstIndex, lastIndex);
        if (next) {
          pendingRange.current = null;
          pendingLogicalRange.current = next;
          chart.timeScale().setVisibleLogicalRange(next as LogicalRange);
          moved = true;
        }
      }
      if (moved) {
        cancelAnimationFrame(cursorFrame.current);
        cursorFrame.current = requestAnimationFrame(() => {
          cursorFrame.current = 0;
          syntheticInspection(time, target, target.values.get(time)!);
        });
      } else syntheticInspection(time, target, target.values.get(time)!);
    };
    updateSeries.current = () => {
      const data = latest.current;
      const retainedInspection =
        publicMode.current && (touchInspection.current || keyboardInspection.current !== null)
          ? inspectionRef.current
          : null;
      const requested = pendingRange.current;
      const logicalView = userRange.current ? captureLogicalView() : null;
      const range = requested
        ? { from: ts(requested.from), to: ts(requested.to) }
        : chart.timeScale().getVisibleRange();
      if (candleMode) price.setData((data.candles ?? []).map((p) => ({ ...p, time: ts(p.time) })));
      else price.setData(gapData(data.points, step));
      price.applyOptions({
        priceFormat: {
          type: 'custom',
          minMove: chartPrecision(
            data.points.map((p) => p.value),
            (v) =>
              primary || !['USD', 'USDT', 'KRW'].includes(unit)
                ? readingDigits(v)
                : priceDigits(v, unit),
          ).minMove,
          formatter: (v: number) => (candleMode ? money(v, unit) : display(v)),
        },
      });
      cursorSeries[0].values = new Map(data.points.map((p) => [p.time, p.value]));
      for (const entry of cursorSeries.slice(1)) {
        const line = data.lines.find((l) => l.id === entry.id);
        entry.series.setData(gapData(line?.data ?? [], line?.step ?? 86400));
        if (line)
          entry.series.applyOptions({
            priceFormat: {
              type: 'custom',
              minMove: chartPrecision(
                line.data.map((p) => p.value),
                (v) => (line.supertrend ? priceDigits(v, line.unit) : readingDigits(v)),
              ).minMove,
              formatter: (v: number) => lineNumber(line, v),
            },
          });
        entry.values = new Map((line?.data ?? []).map((p) => [p.time, p.value]));
        if ('primitive' in entry)
          (entry.primitive as SupertrendPrimitive).setRows(line?.supertrend?.rows ?? []);
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
      if (userRange.current && logicalView && restoreLogical(logicalView)) {
        /* exact zoom retained */
      } else if (range && userRange.current) chart.timeScale().setVisibleRange(range);
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
      if (retainedInspection) {
        const time = keyboardInspection.current ?? retainedInspection.time;
        const target = cursorSeries.find(
          (entry) =>
            entry.pane === retainedInspection.pane &&
            entry.id === retainedInspection.values[0]?.id &&
            entry.values.has(time),
        );
        if (!target) dismissInspection();
        else {
          cancelAnimationFrame(cursorFrame.current);
          cursorFrame.current = requestAnimationFrame(() => {
            cursorFrame.current = 0;
            if (keyboardInspection.current !== null)
              syntheticInspection(time, target, target.values.get(time)!);
            else {
              const x = chart.timeScale().timeToCoordinate(ts(time));
              const value = target.series.coordinateToPrice(retainedInspection.y);
              if (x === null || value === null) dismissInspection();
              else syntheticInspection(time, target, value, { x, y: retainedInspection.y });
            }
          });
        }
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
    if (prior?.key === key && userRange.current) {
      // setData runs again before the replacement chart's next frame. Keep the
      // restored user window pending until LWC publishes those exact dates.
      if (!prior.logical || !restoreLogical(prior.logical)) {
        pendingRange.current = { from: prior.from, to: prior.to };
        chart.timeScale().setVisibleRange({ from: ts(prior.from), to: ts(prior.to) });
      }
    } else if (visible.length)
      chart
        .timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    const surface = host.current;
    const updateLogicalWindow = (logical: LogicalRange | null) => {
      if (!logical) return;
      if (
        gesture.current?.moved &&
        performance.now() <= gesture.current.expires &&
        logicalRangeChanged(gesture.current.baseline, logical)
      ) {
        userRange.current = true;
        pendingRange.current = null;
        pendingLogicalRange.current = null;
      }
      if (pendingLogicalRange.current && !logicalRangeChanged(pendingLogicalRange.current, logical))
        pendingLogicalRange.current = null;
      surface.dataset.visibleLogicalFrom = String(logical.from);
      surface.dataset.visibleLogicalTo = String(logical.to);
    };
    const updateWindow = (
      range: ReturnType<ReturnType<IChartApi['timeScale']>['getVisibleRange']>,
    ) => {
      if (range) {
        updateLogicalWindow(chart.timeScale().getVisibleLogicalRange());
        if (
          pendingRange.current?.from === Number(range.from) &&
          pendingRange.current?.to === Number(range.to)
        )
          pendingRange.current = null;
        surface.dataset.visibleFrom = String(range.from);
        surface.dataset.visibleTo = String(range.to);
        setVisibleWindow({ from: Number(range.from), to: Number(range.to) });
        rangeCallback.current?.({ from: Number(range.from), to: Number(range.to) });
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(updateWindow);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateLogicalWindow);
    updateWindow(chart.timeScale().getVisibleRange());
    surface.dataset.observations = String(points.length);
    const resize = new ResizeObserver(() => {
      const requested = pendingRange.current;
      const logical = pendingLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange();
      const range = requested
        ? { from: ts(requested.from), to: ts(requested.to) }
        : chart.timeScale().getVisibleRange();
      const height = chartHeight();
      surface.style.height = height + 'px';
      chart.resize(Math.max(1, surface.clientWidth), height);
      if (userRange.current && logical)
        chart.timeScale().setVisibleLogicalRange(logical as LogicalRange);
      else if (userRange.current && range) chart.timeScale().setVisibleRange(range);
      else restoreDefault();
    });
    resize.observe(surface);
    const resizeViewport = () => {
      const range = pendingRange.current ?? chart.timeScale().getVisibleRange();
      const logical = pendingLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange();
      const height = chartHeight();
      surface.style.height = height + 'px';
      chart.resize(Math.max(1, surface.clientWidth), height);
      if (userRange.current && logical)
        chart.timeScale().setVisibleLogicalRange(logical as LogicalRange);
      else if (userRange.current && range)
        chart
          .timeScale()
          .setVisibleRange({ from: ts(Number(range.from)), to: ts(Number(range.to)) });
      else restoreDefault();
      inspectionRef.current = null;
      setInspection(null);
    };
    window.addEventListener('resize', resizeViewport);
    window.visualViewport?.addEventListener('resize', resizeViewport);
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
      // A style switch can arrive before LWC publishes a queued user zoom.
      // Carry the requested dates into the replacement series, not its stale frame.
      const range = pendingRange.current ?? chart.timeScale().getVisibleRange();
      if (range)
        previous.current = {
          key,
          from: Number(range.from),
          to: Number(range.to),
          logical: captureLogicalView(),
        };
      pendingLogicalRange.current = null;
      markers.detach();
      resize.disconnect();
      window.removeEventListener('resize', resizeViewport);
      window.visualViewport?.removeEventListener('resize', resizeViewport);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inspectionFrame.current);
      cancelAnimationFrame(tapFrame.current);
      cancelAnimationFrame(cursorFrame.current);
      inspectionFrame.current = 0;
      tapFrame.current = 0;
      cursorFrame.current = 0;
      activePointers.current.clear();
      gesture.current = null;
      chart.remove();
      liveSeries.current = null;
      liveLine.current = null;
      chartRef.current = null;
      updateSeries.current = () => {};
      moveCursor.current = () => {};
      inspectAt.current = () => {};
      inspectionRef.current = null;
      touchInspection.current = false;
      setInspection(null);
    };
  }, [key, structure, ready, candleMode]);
  useEffect(() => {
    const series = liveSeries.current;
    if (!series) return;
    series.applyOptions({ lastValueVisible: !eligibleChartPrice(livePrice, asset, unit) });
    if (!eligibleChartPrice(livePrice, asset, unit)) {
      if (liveLine.current) series.removePriceLine(liveLine.current);
      liveLine.current = null;
      return;
    }
    const options = {
      price: livePrice.price,
      color: '#0f666b',
      lineWidth: 1 as const,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '현재가',
    };
    if (liveLine.current) liveLine.current.applyOptions(options);
    else liveLine.current = series.createPriceLine(options);
  }, [livePrice, asset, unit, key, structure, ready, candleMode]);
  useEffect(() => {
    updateSeries.current();
  }, [points, candles, lines, signals, observations, bands]);
  useEffect(() => {
    chartRef.current
      ?.priceScale('right', 0)
      .applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);
  const appliedRange = useRef<string | null>(null);
  useEffect(() => {
    const token = `${key}:${period}:${rangeRevision}`;
    const incoming = availableWindow(readings.times, initialWindow);
    const current = pendingRange.current ?? chartRef.current?.timeScale().getVisibleRange();
    if (
      appliedRange.current === token &&
      incoming &&
      current &&
      incoming.from === Number(current.from) &&
      incoming.to === Number(current.to)
    )
      return;
    appliedRange.current = token;
    userRange.current = false;
    pendingRange.current = null;
    pendingLogicalRange.current = null;
    gesture.current = null;
    appliedFocus.current = null;
    const visible = points.filter((p) => p.time >= periodStart(period, points.at(-1)?.time ?? 0));
    manualCursor.current = false;
    setPinned(false);
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
    // Restore after the range reset, including React's development remount check.
    // Only an exact observation can be pinned; unknown dates never fabricate a value.
    if (initialReadingDate && readings.times.includes(initialReadingDate))
      explore(initialReadingDate, true);
  }, [period, key, ready, rangeRevision, initialWindow?.from, initialWindow?.to]);
  // Pinning a date is independent of the time-scale range. A keyboard step or
  // URL date change must not reapply the old range after an imperative zoom.
  useEffect(() => {
    if (!ready || !chartRef.current) return;
    if (initialReadingDate && readings.times.includes(initialReadingDate)) {
      explore(initialReadingDate, true);
    } else if (initialReadingDate === undefined) {
      manualCursor.current = true;
      setPinned(false);
      setSelectionKey(key);
      setSelected(null);
      chartRef.current.clearCrosshairPosition();
    }
  }, [key, ready, rangeRevision, initialReadingDate]);
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
  const navigator = !publicFocus ? (
    <DateNavigator
      key={key}
      compact={!!toolbarTarget}
      times={readings.times}
      visible={visibleWindow}
      selected={time}
      onRange={(range) => {
        pendingRange.current = range;
        userRange.current = true;
        chartRef.current?.timeScale().setVisibleRange({ from: ts(range.from), to: ts(range.to) });
      }}
      onSelect={explore}
      onNavigate={(date, range) => {
        if (range) {
          pendingRange.current = range;
          userRange.current = true;
          chartRef.current?.timeScale().setVisibleRange({ from: ts(range.from), to: ts(range.to) });
        }
        if (date !== undefined) explore(date, true);
        const desired =
          range ?? pendingRange.current ?? chartRef.current?.timeScale().getVisibleRange();
        dateSelect.current?.(
          date ?? (pinned ? selectedTime : null),
          desired ? { from: Number(desired.from), to: Number(desired.to) } : undefined,
        );
      }}
      onReset={() => {
        explore(null);
        userRange.current = false;
        pendingRange.current = null;
        chartRef.current?.timeScale().fitContent();
        onAll();
      }}
    />
  ) : null;
  const extraTools =
    advancedTools && !publicFocus ? (
      <details className="analysis-tools">
        <summary>내보내기 · 공유 · 날짜별 수치</summary>
        <ChartTools
          chart={chartRef}
          shareVisibleRange
          readingDate={pinned ? selectedTime : null}
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
            a.download = `borichart-${fileName}.png`;
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
                      <td key={l.id}>{lineNumber(l, readings.maps[i + 1].get(t))}</td>
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
    ) : null;
  const secondaryReadings = lines.map((l, i) =>
    l.id.startsWith('band:') ? null : (
      <span
        key={l.id}
        className="analysis-secondary-reading"
        title={publicFocus ? undefined : `${l.title} · ${l.source}`}
      >
        <i style={{ background: l.color }} />
        {l.legendTitle ?? l.title}{' '}
        <b>
          {lineNumber(
            l,
            publicFocus || selectedTime === null
              ? l.data.at(-1)?.value
              : time === undefined
                ? undefined
                : readings.maps[i + 1].get(time),
          )}
        </b>{' '}
        {l.unit}
        {!publicFocus && l.warning && <small role="status"> · {l.warning}</small>}
        {!publicFocus && selectedTime === null && l.data.at(-1)?.time !== time && (
          <small> · {timestamp(l.data.at(-1)?.time).slice(0, 10)}</small>
        )}
      </span>
    ),
  );
  const secondaryBelowChart =
    ['view:hash_ribbons', 'view:hashrate_trend'].includes(primary?.id ?? '') ||
    lines.some((line) => line.supertrend !== undefined);
  return (
    <>
      <div className={'analysis-legend' + (publicFocus ? ' analysis-legend-focused' : '')}>
        <span>
          {asset} · {primary?.title ?? unit}
        </span>
        <span>
          {!publicFocus && (
            <time
              className="analysis-reading-date"
              dateTime={
                summaryTime === undefined ? undefined : new Date(summaryTime * 1000).toISOString()
              }
              title={timestamp(summaryTime)}
            >
              <span className={!pinned ? 'sr-only' : 'analysis-reading-full-date'}>
                {!pinned ? (primary ? '최근 확정값' : (summaryLabel ?? '최근 관측')) : '날짜 고정'}
              </span>{' '}
              {!pinned ? (
                `${timestamp(summaryTime).slice(5, 10).replace('-', '.')} 기준`
              ) : (
                <>
                  <span className="analysis-reading-full-date">· {timestamp(summaryTime)}</span>
                  <span className="analysis-reading-compact-date" aria-hidden="true">
                    {timestamp(summaryTime).slice(0, showReadingTime ? 16 : 10)}
                  </span>
                </>
              )}
            </time>
          )}{' '}
          <b className="analysis-reading-value">
            {readingLabel && <span className="analysis-reading-asset">{readingLabel} </span>}
            {primary || !['USD', 'USDT', 'KRW'].includes(unit) ? (
              <>
                <span>{metricNumber(visibleSummaryValue)}</span>{' '}
                <small className="analysis-primary-unit">{unit}</small>
              </>
            ) : (
              display(visibleSummaryValue)
            )}
          </b>
        </span>
        {!publicFocus && pinned && selectedTime !== null && (
          <button
            className="analysis-reading-reset"
            aria-label="최근값 보기"
            title="최근값 보기"
            onClick={() => {
              explore(null);
              host.current?.focus({ preventScroll: true });
            }}
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span>최근값 보기</span>
          </button>
        )}
        {!secondaryBelowChart && secondaryReadings}
      </div>
      <div className={'analysis-surface' + (drawingKey ? ' with-drawings' : '')}>
        {publicFocus && inspection && (
          <div
            ref={tooltip}
            className="analysis-hover-reading analysis-inspection"
            data-testid="chart-tooltip"
            data-observation-time={inspection.time}
            data-pane={inspection.pane}
            style={tooltipPosition}
          >
            <time dateTime={new Date(inspection.time * 1000).toISOString()}>
              {asset} · {chartDate(inspection.time, showReadingTime)} KST
            </time>
            {inspection.values.map((value) => (
              <span key={value.id} data-series={value.id} data-value={value.value}>
                <span>{value.title}</span>
                <b>
                  {['USD', 'USDT', 'KRW'].includes(value.unit)
                    ? money(value.value, value.unit)
                    : numeric(value.value, readingDigits(value.value))}{' '}
                  {value.unit}
                </b>
              </span>
            ))}
          </div>
        )}
        {publicFocus && inspection && inspection.observationY !== null && (
          <span
            className="analysis-observation-dot"
            aria-hidden="true"
            style={{
              left: inspection.observationX + (host.current?.offsetLeft ?? 0),
              top: inspection.top + inspection.observationY + (host.current?.offsetTop ?? 0),
              background: inspection.values[0]?.color,
            }}
          />
        )}
        {!publicFocus && !pinned && selectedTime !== null && (
          <span className="analysis-hover-reading" data-testid="chart-preview">
            미리 보기 · {timestamp(time)} · {asset} {display(priceValue)}
          </span>
        )}
        <div
          ref={host}
          className="analysis-canvas"
          style={{ height: 440 + panelCount(lines) * 135 }}
          data-chart-kind="analysis"
          data-asset={asset}
          data-primary-metric={primary?.id ?? 'price'}
          data-price-style={candleMode ? 'candles' : 'line'}
          data-live-price={eligibleChartPrice(livePrice, asset, unit) ? livePrice.price : undefined}
          data-panels={panelCount(lines)}
          data-crosshair-mode="normal"
          data-primary-precision={primaryPrecision.precision}
          data-primary-min-move={primaryPrecision.minMove}
          data-hover-time={inspection?.time}
          data-hover-value={inspection?.values[0]?.value}
          data-hover-line-value={inspection?.values[1]?.value}
          data-hover-line-id={inspection?.values[1]?.id}
          data-hover-pane={inspection?.pane}
          data-hover-x={inspection?.x}
          data-hover-y={inspection?.y}
          data-hover-observation-x={inspection?.observationX}
          data-hover-observation-y={inspection?.observationY ?? undefined}
          data-axis-reading={eligibleChartPrice(livePrice, asset, unit) ? 'live' : 'close'}
          onPointerDownCapture={(event) => {
            pointerKind.current = event.pointerType;
            touchInspection.current = false;
            keyboardInspection.current = null;
            if (!activePointers.current.size)
              gesture.current = {
                baseline: chartRef.current?.timeScale().getVisibleLogicalRange() ?? null,
                moved: false,
                expires: performance.now() + 600000,
              };
            else if (gesture.current) gesture.current.moved = true;
            activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          }}
          onPointerMoveCapture={(event) => {
            pointerKind.current = event.pointerType;
            if (publicFocus || !pinned) manualCursor.current = false;
            keyboardInspection.current = null;
            const start = activePointers.current.get(event.pointerId);
            if (
              start &&
              gesture.current &&
              Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
            )
              gesture.current.moved = true;
          }}
          onPointerUpCapture={(event) => {
            const start = activePointers.current.get(event.pointerId);
            const tap =
              event.pointerType === 'touch' &&
              activePointers.current.size === 1 &&
              start &&
              Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8 &&
              !gesture.current?.moved;
            activePointers.current.delete(event.pointerId);
            if (gesture.current) gesture.current.expires = performance.now() + 250;
            if (
              (tap || (event.pointerType === 'touch' && inspectionRef.current)) &&
              publicFocus &&
              !(event.target instanceof Element && event.target.closest('.drawing-overlay'))
            ) {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left,
                y = event.clientY - rect.top;
              cancelAnimationFrame(tapFrame.current);
              tapFrame.current = requestAnimationFrame(() => {
                tapFrame.current = 0;
                inspectAt.current(x, y);
              });
            }
          }}
          onPointerCancel={() => {
            activePointers.current.clear();
            if (gesture.current) gesture.current.expires = performance.now() + 250;
            touchInspection.current = false;
            if (publicFocus) dismissInspection();
          }}
          onPointerLeave={(event) => {
            if (publicFocus && event.pointerType !== 'touch' && !manualCursor.current)
              dismissInspection();
          }}
          onWheelCapture={() => {
            gesture.current = {
              baseline: chartRef.current?.timeScale().getVisibleLogicalRange() ?? null,
              moved: true,
              expires: performance.now() + 300,
            };
            touchInspection.current = false;
          }}
          tabIndex={0}
          role="group"
          aria-label={`${asset} ${unit} ${primary?.title ?? '가격과 비교 지표'}. 좌우 방향키로 값 확인, Escape로 닫기`}
          onKeyDown={(e) => {
            if (
              e.target !== e.currentTarget ||
              !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)
            )
              return;
            e.preventDefault();
            if (publicFocus) {
              pointerKind.current = 'keyboard';
              if (e.key === 'Escape') {
                dismissInspection();
                return;
              }
              const next =
                e.key === 'Home'
                  ? readings.times[0]
                  : e.key === 'End'
                    ? readings.times.at(-1)
                    : adjacentObservation(
                        readings.times,
                        inspectionRef.current?.time ?? selectedTime,
                        e.key === 'ArrowLeft' ? -1 : 1,
                      );
              if (next !== undefined && next !== null) {
                manualCursor.current = true;
                keyboardInspection.current = next;
                touchInspection.current = true;
                moveCursor.current(next);
              }
              return;
            }
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
      {secondaryBelowChart && (
        <div className="analysis-secondary-readings">{secondaryReadings}</div>
      )}
      {publicFocus && (
        <span className="sr-only" role="status">
          {pointerKind.current === 'keyboard' && inspection
            ? chartDate(inspection.time, showReadingTime) +
              ' KST. ' +
              inspection.values
                .map(
                  (value) =>
                    `${value.title} ${numeric(value.value, readingDigits(value.value))} ${value.unit}`,
                )
                .join('. ')
            : ''}
        </span>
      )}
      {toolbarTarget ? createPortal(navigator, toolbarTarget) : navigator}
      {!publicFocus && (
        <span className="sr-only" role="status">
          {selectedTime !== null
            ? `${timestamp(time)} ${asset} ${display(priceValue)}. ${lines.map((l, i) => `${l.title} ${lineNumber(l, time === undefined ? undefined : readings.maps[i + 1].get(time))} ${l.unit}`).join('. ')}`
            : ''}
        </span>
      )}
      {advancedTools &&
        !publicFocus &&
        (toolsTarget ? createPortal(extraTools, toolsTarget) : extraTools)}
    </>
  );
});
