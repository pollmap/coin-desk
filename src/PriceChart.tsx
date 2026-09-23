import { ChartNavigator } from './ChartNavigator';
import { createDeskChart as createChart } from './chart-theme';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  PriceScaleMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  calculateIndicators,
  candlesCsv,
  pointAtOrBefore,
  validDrawings,
} from '../shared/chart-analysis';
import { indicatorSpec } from '../shared/indicators';
import type { Candle, Drawing, Interval, Period, Point } from '../shared/types';
import { dateLabel, money, priceDigits, periodStart, save, saved } from './lib';
import { ChartRangeControl } from './ChartRangeControl';
import { zoomChartRange } from './chart-range';
import { THRESHOLDS, thresholdState } from '../shared/thresholds';
import { ThresholdBands } from './ThresholdBands';
import { ThresholdLegend } from './ThresholdLegend';
import './chart-improvements.css';
const EMPTY: Candle[] = [];
const ts = (t: number) => t as UTCTimestamp;
const lineData = (p: Point[]) => p.map((p) => ({ time: ts(p.time), value: p.value }));
interface Props {
  candles: Candle[];
  daily?: Candle[];
  interval: Interval;
  period: Period;
  indicators: string[];
  log: boolean;
  scope: string;
  unit: string;
  large?: boolean;
  tool: 'cursor' | 'horizontal' | 'trend';
  onToolDone: () => void;
  onPeriodChange?: (period: Period) => void;
}
export const PriceChart = memo(function PriceChart({
  candles,
  daily = EMPTY,
  interval,
  period,
  indicators,
  log,
  scope,
  unit,
  large = false,
  tool,
  onToolDone,
  onPeriodChange,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const thresholdBands = useRef<ThresholdBands[]>([]);
  const thresholdLines = useRef<IPriceLine[]>([]);
  const [showThresholds, setShowThresholds] = useState(true);
  const toolRef = useRef(tool);
  const doneRef = useRef(onToolDone);
  toolRef.current = tool;
  doneRef.current = onToolDone;
  const settingsRef = useRef({ period, log, showThresholds });
  settingsRef.current = { period, log, showThresholds };
  const [drawings, setDrawings] = useState<Drawing[]>(() =>
    validDrawings(saved('drawings.' + scope, [])),
  );
  const drawingsRef = useRef(drawings);
  const redraw = useRef<((items: Drawing[]) => void) | null>(null);
  const lastView = useRef<{ key: string; from: UTCTimestamp; to: UTCTimestamp } | null>(null);
  const pending = useRef<Point | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [hint, setHint] = useState('');
  const [keyboardValue, setKeyboardValue] = useState('');
  const [linePrice, setLinePrice] = useState('');
  const [drawingList, setDrawingList] = useState(false);
  const navigatorRows = useMemo(
    () => candles.map((c) => ({ time: c.time, value: c.close })),
    [candles],
  );
  const candlesByTime = useMemo(() => new Map(candles.map((c) => [c.time, c])), [candles]);
  useEffect(() => {
    const d = validDrawings(saved('drawings.' + scope, []));
    setDrawings(d);
    drawingsRef.current = d;
    pending.current = null;
    setHover(null);
    setKeyboardValue('');
  }, [scope]);
  const calculated = useMemo(
    () => calculateIndicators(candles, daily, indicators),
    [candles, daily, indicators],
  );
  function updateDrawings(items: Drawing[]) {
    const next = validDrawings(items);
    drawingsRef.current = next;
    setDrawings(next);
    save('drawings.' + scope, next);
    redraw.current?.(next);
  }
  useEffect(() => {
    if (!container.current || !candles.length) return;
    const chart = createChart(container.current, {
      autoSize: true,
      height: large ? 540 : 390,
      layout: {
        background: { type: ColorType.Solid, color: '#111721' },
        textColor: '#8490a2',
        fontFamily: 'Inter, Segoe UI, Malgun Gothic, sans-serif',
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: '#273040', separatorHoverColor: '#414d60' },
      },
      grid: { vertLines: { color: '#1b2431' }, horzLines: { color: '#1b2431' } },
      rightPriceScale: {
        borderVisible: false,
        mode: settingsRef.current.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.1, bottom: 0.12 },
      },
      timeScale: {
        lockVisibleTimeRangeOnResize: true,
        // Keep multi-year history visible even on narrow screens; zoom remains available.
        minBarSpacing: 0.01,
        borderColor: '#273040',
        timeVisible: interval === '1h' || interval === '4h',
        rightOffset: 5,
        tickMarkFormatter: (time: number, type: TickMarkType) =>
          type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds
            ? new Intl.DateTimeFormat('ko-KR', {
                timeZone: 'Asia/Seoul',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }).format(new Date(Number(time) * 1000))
            : null,
      },
      crosshair: {
        vertLine: { color: '#627084', labelBackgroundColor: '#344154' },
        horzLine: { color: '#627084', labelBackgroundColor: '#344154' },
      },
      localization: {
        locale: 'ko-KR',
        timeFormatter: (time: number) =>
          dateLabel(Number(time), interval === '1h' || interval === '4h'),
      },
    });
    chartRef.current = chart;
    const surface = container.current;
    surface.dataset.observationCount = String(candles.length);
    surface.dataset.availableFrom = String(candles[0].time);
    surface.dataset.availableTo = String(candles.at(-1)!.time);
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return;
      surface.dataset.visibleFrom = String(Number(range.from));
      surface.dataset.visibleTo = String(Number(range.to));
    });
    let readyFrame = requestAnimationFrame(() => {
      readyFrame = requestAnimationFrame(() => {
        surface.dataset.chartReadyMs = String(Math.round(performance.now()));
      });
    });
    const priceFormat = {
      type: 'custom' as const,
      formatter: (p: number) => money(p, unit),
      minMove: 10 ** -priceDigits(Math.min(...candles.map((c) => c.low)), unit),
    };
    const main = chart.addSeries(CandlestickSeries, {
      priceFormat,
      upColor: '#39c6a0',
      downColor: '#ec7580',
      borderVisible: false,
      wickUpColor: '#39c6a0',
      wickDownColor: '#ec7580',
      priceLineColor: '#657284',
    });
    candlesRef.current = main;
    main.setData(
      candles.map((c) => ({
        time: ts(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    volume.setData(
      candles.map((c) => ({
        time: ts(c.time),
        value: c.volume,
        color: c.close >= c.open ? '#237d6a80' : '#984f5c80',
      })),
    );
    volume.priceScale().applyOptions({ mode: PriceScaleMode.Normal });
    chart.panes()[1].setHeight(65);
    let nextPane = 2;
    for (const id of indicators) {
      const definition = indicatorSpec(id);
      if (!definition) continue;
      if (definition.kind === 'bb') {
        for (const [key, values] of calculated[id].entries()) {
          chart
            .addSeries(LineSeries, {
              priceFormat,
              color: key === 0 ? '#8895aa' : '#526073',
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
            })
            .setData(lineData(values));
        }
      } else if (definition.kind === 'rsi') {
        const pane = nextPane++;
        const s = chart.addSeries(
          LineSeries,
          {
            color: definition.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat: { type: 'custom', formatter: (v: number) => v.toFixed(1) },
          },
          pane,
        );
        s.setData(lineData(calculated[id][0]));
        s.priceScale().applyOptions({ mode: PriceScaleMode.Normal });
        s.applyOptions({
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        });
        const bands = new ThresholdBands(THRESHOLDS.rsi.bands);
        bands.setVisible(settingsRef.current.showThresholds);
        s.attachPrimitive(bands);
        thresholdBands.current.push(bands);
        for (const boundary of THRESHOLDS.rsi.boundaries)
          thresholdLines.current.push(
            s.createPriceLine({
              price: boundary.value,
              color: boundary.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              lineVisible: settingsRef.current.showThresholds,
              axisLabelVisible: settingsRef.current.showThresholds,
              title: boundary.value === 30 ? '과매도 참고' : '과매수 참고',
            }),
          );
        chart.panes()[pane].setHeight(105);
      } else if (definition.kind === 'macd') {
        const pane = nextPane++;
        for (const [index, points] of calculated[id].entries()) {
          if (index === 2) {
            const histogram = chart.addSeries(
              HistogramSeries,
              { priceLineVisible: false, lastValueVisible: false, priceFormat },
              pane,
            );
            histogram.setData(
              points.map((p) => ({
                time: ts(p.time),
                value: p.value,
                color: p.value >= 0 ? '#39c6a090' : '#ec758090',
              })),
            );
            histogram.priceScale().applyOptions({ mode: PriceScaleMode.Normal });
          } else {
            const line = chart.addSeries(
              LineSeries,
              {
                color: index === 0 ? '#70b8db' : '#efb765',
                lineWidth: 1,
                priceFormat,
                priceLineVisible: false,
                lastValueVisible: false,
              },
              pane,
            );
            line.setData(lineData(points));
            line.priceScale().applyOptions({ mode: PriceScaleMode.Normal });
            if (index === 0)
              thresholdLines.current.push(
                line.createPriceLine({
                  price: 0,
                  color: '#8799af',
                  lineWidth: 1,
                  lineStyle: LineStyle.Dashed,
                  lineVisible: settingsRef.current.showThresholds,
                  axisLabelVisible: settingsRef.current.showThresholds,
                  title: `EMA${definition.period} = EMA${definition.slowPeriod}`,
                }),
              );
          }
        }
        chart.panes()[pane].setHeight(100);
      } else {
        const points = calculated[id][0];
        chart
          .addSeries(LineSeries, {
            priceFormat,
            color: definition.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
          })
          .setData(lineData(points));
      }
    }
    const viewKey = scope + ':' + settingsRef.current.period;
    const prior = lastView.current;
    const visible = candles.filter(
      (c) => c.time >= periodStart(settingsRef.current.period, candles.at(-1)!.time),
    );
    if (prior?.key === viewKey && prior.to >= candles[0].time && prior.from <= candles.at(-1)!.time)
      chart.timeScale().setVisibleRange({ from: prior.from, to: prior.to });
    else if (visible.length)
      chart
        .timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    const drawingCleanup = new Map<string, () => void>();
    const paint = (d: Drawing) => {
      if (d.kind === 'horizontal') {
        const line = main.createPriceLine({
          price: d.points[0].value,
          color: '#edb35f',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '메모',
        });
        drawingCleanup.set(d.id, () => main.removePriceLine(line));
      } else if (d.points.length === 2) {
        const line = chart.addSeries(LineSeries, {
          color: '#edb35f',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        line.setData(lineData(d.points));
        drawingCleanup.set(d.id, () => chart.removeSeries(line));
      }
    };
    redraw.current = (items) => {
      const ids = new Set(items.map((d) => d.id));
      for (const [id, remove] of drawingCleanup)
        if (!ids.has(id)) {
          remove();
          drawingCleanup.delete(id);
        }
      for (const item of items) if (!drawingCleanup.has(item.id)) paint(item);
    };
    const stored = validDrawings(saved('drawings.' + scope, []));
    stored.forEach(paint);
    drawingsRef.current = stored;
    chart.subscribeCrosshairMove((p) => {
      setHover(p.time ? candlesByTime.get(Number(p.time)) || null : null);
    });
    chart.subscribeClick((p) => {
      if (toolRef.current === 'cursor' || !p.point || !p.time || p.paneIndex !== 0) return;
      const value = main.coordinateToPrice(p.point.y);
      if (value === null || value <= 0) return;
      const point = { time: Number(p.time), value };
      let drawing: Drawing;
      if (toolRef.current === 'horizontal')
        drawing = { id: crypto.randomUUID(), kind: 'horizontal', points: [point] };
      else {
        if (!pending.current) {
          pending.current = point;
          setHint('추세선의 끝 지점을 선택하세요.');
          return;
        }
        if (point.time === pending.current.time) {
          setHint('다른 날짜를 선택하세요.');
          return;
        }
        drawing = { id: crypto.randomUUID(), kind: 'trend', points: [pending.current, point] };
        pending.current = null;
      }
      updateDrawings([...drawingsRef.current, drawing]);
      setHint('차트 메모를 이 브라우저에 저장했습니다.');
      doneRef.current();
    });
    return () => {
      const range = chart.timeScale().getVisibleRange();
      if (range)
        lastView.current = {
          key: scope + ':' + settingsRef.current.period,
          from: ts(Number(range.from)),
          to: ts(Number(range.to)),
        };
      cancelAnimationFrame(readyFrame);
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      thresholdBands.current = [];
      thresholdLines.current = [];
      redraw.current = null;
    };
  }, [candles, candlesByTime, calculated, interval, large, scope, unit, indicators]);
  useEffect(() => {
    candlesRef.current
      ?.priceScale()
      .applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);
  useEffect(() => {
    thresholdBands.current.forEach((band) => band.setVisible(showThresholds));
    thresholdLines.current.forEach((line) =>
      line.applyOptions({ lineVisible: showThresholds, axisLabelVisible: showThresholds }),
    );
  }, [showThresholds]);
  useEffect(() => {
    const last = candles.at(-1)?.time;
    if (last === undefined) return;
    const visible = candles.filter((c) => c.time >= periodStart(period, last));
    if (visible.length)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    // Period and market changes intentionally reset the viewport; data refreshes do not.
  }, [period, scope]);
  useEffect(() => {
    pending.current = null;
    setHint(
      tool === 'horizontal'
        ? '가격 차트를 클릭해 수평선을 그리세요.'
        : tool === 'trend'
          ? '가격 차트에서 시작점과 끝점을 선택하세요.'
          : '',
    );
  }, [tool]);
  function clear() {
    updateDrawings([]);
    pending.current = null;
    setHint('저장된 선을 삭제했습니다.');
  }
  function zoom(factor: number) {
    const scale = chartRef.current?.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const next = zoomChartRange(range, factor);
    if (next) scale.setVisibleLogicalRange(next);
  }
  function resetView() {
    const visible = candles.filter((c) => c.time >= periodStart(period, candles.at(-1)!.time));
    if (visible.length)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    else chartRef.current?.timeScale().fitContent();
    setHint('선택한 조회 기간으로 차트를 맞췄습니다.');
  }
  function exportCsv() {
    const range = chartRef.current?.timeScale().getVisibleRange();
    const csv = candlesCsv(
      candles,
      scope,
      range ? Number(range.from) : 0,
      range ? Number(range.to) : Infinity,
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Coin-Desk-' + scope.replace(/[^A-Za-z0-9_-]/g, '-') + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setHint('현재 보이는 구간의 실제 OHLCV를 UTC 시각·확정 여부와 함께 내보냈습니다.');
  }
  const display = (hover ? candlesByTime.get(hover.time) : null) ?? candles.at(-1);
  const missing = indicators
    .filter((id) => !calculated[id]?.length || calculated[id].some((series) => !series.length))
    .map((id) => indicatorSpec(id)?.label);
  return (
    <div className="chart-surface">
      <div className="ohlc-readout" aria-live="off">
        {display ? (
          <>
            <span className="chart-observation-date">
              {dateLabel(display.time, interval === '1h' || interval === '4h')}
            </span>
            <span>
              O <b>{money(display.open, unit)}</b>
            </span>
            <span>
              H <b>{money(display.high, unit)}</b>
            </span>
            <span>
              L <b>{money(display.low, unit)}</b>
            </span>
            <span>
              C <b>{money(display.close, unit)}</b>
            </span>
            <span>
              V <b>{display.volume.toLocaleString('en-US', { maximumFractionDigits: 4 })}</b>
            </span>
            {!display.closed ? <em>진행 중 · 봉 기준 지표는 변동</em> : null}
          </>
        ) : null}
      </div>
      <div className="indicator-readout" aria-live="off">
        {indicators.map((id) => {
          const spec = indicatorSpec(id);
          const current =
            calculated[id]?.map(
              (series) => pointAtOrBefore(series, display?.time ?? Infinity)?.value,
            ) || [];
          const lineLabels =
            spec?.kind === 'macd'
              ? ['MACD', `신호 ${spec.signalPeriod}`, '히스토그램']
              : spec?.kind === 'bb'
                ? ['중심', '상단', '하단']
                : ['값'];
          return (
            <span key={id} className="indicator-observation" style={{ color: spec?.color }}>
              <span>{spec?.label}</span>
              {current.map((v, index) => (
                <b key={index} title={lineLabels[index]}>
                  <small>{current.length > 1 ? lineLabels[index] + ' ' : ''}</small>
                  {v === undefined ? '—' : spec?.kind === 'rsi' ? v.toFixed(1) : money(v, unit)}
                </b>
              ))}
              {spec?.kind === 'rsi' && current[0] !== undefined ? (
                <small style={{ color: thresholdState('rsi', current[0])?.color }}>
                  {thresholdState('rsi', current[0])?.label} · 30 / 70
                </small>
              ) : null}
              {spec?.kind === 'bb' ? <small>변동성 범위 · ±{spec.multiplier}σ</small> : null}
              {spec?.kind === 'macd' ? (
                <small>
                  0 = EMA{spec.period}와 EMA{spec.slowPeriod} 같음
                </small>
              ) : null}
            </span>
          );
        })}
      </div>
      <div
        ref={container}
        className="financial-chart"
        role="group"
        tabIndex={0}
        aria-label="가격, 거래량과 기술지표 차트. 좌우 화살표로 날짜별 값 확인, 더하기·빼기로 확대·축소, Escape로 그리기 취소"
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            const index = display
              ? candles.findIndex((c) => c.time === display.time)
              : candles.length - 1;
            const next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? candles.length - 1
                  : Math.max(
                      0,
                      Math.min(candles.length - 1, index + (e.key === 'ArrowLeft' ? -1 : 1)),
                    );
            const candle = candles[next];
            if (candle && candlesRef.current) {
              setHover(candle);
              setKeyboardValue(
                `${dateLabel(candle.time, interval === '1h' || interval === '4h')} · 종가 ${money(candle.close, unit)} · ${candle.closed ? '확정 봉' : '진행 중인 봉'}`,
              );
              chartRef.current?.setCrosshairPosition(
                candle.close,
                ts(candle.time),
                candlesRef.current,
              );
            }
          } else if (['+', '=', '-'].includes(e.key)) {
            e.preventDefault();
            zoom(e.key === '-' ? 1.4 : 1 / 1.4);
          } else if (e.key === 'Escape') {
            pending.current = null;
            setHover(null);
            chartRef.current?.clearCrosshairPosition();
            setHint('그리기를 취소했습니다.');
            doneRef.current();
          }
        }}
      />
      <span className="chart-keyboard-status" role="status">
        {keyboardValue}
      </span>
      <ChartNavigator rows={navigatorRows} chart={chartRef} label="가격 차트" log={log} />
      <div className="chart-actions" aria-label="차트 조작">
        <button onClick={() => zoom(1 / 1.4)} aria-label="차트 확대">
          ＋ 확대
        </button>
        <button onClick={() => zoom(1.4)} aria-label="차트 축소">
          − 축소
        </button>
        <button onClick={resetView}>화면 맞춤</button>
        <button onClick={exportCsv}>보이는 구간 CSV</button>
        {indicators.some((id) => ['rsi', 'macd'].includes(indicatorSpec(id)?.kind ?? '')) ? (
          <button aria-pressed={showThresholds} onClick={() => setShowThresholds(!showThresholds)}>
            지표 참고 구간 {showThresholds ? '숨기기' : '표시'}
          </button>
        ) : null}
        <button aria-expanded={drawingList} onClick={() => setDrawingList(!drawingList)}>
          그린 선 관리 {drawings.length ? `(${drawings.length})` : ''}
        </button>
      </div>
      {indicators.some((id) => ['rsi', 'bb', 'macd'].includes(indicatorSpec(id)?.kind ?? '')) ? (
        <details className="threshold-technical">
          <summary>기술지표 경계값 읽기 · RSI 30 / 70 · 볼린저밴드 · MACD 0</summary>
          {indicators
            .filter((id) => indicatorSpec(id)?.kind === 'rsi')
            .map((id) => (
              <ThresholdLegend
                key={id}
                id="rsi"
                dataSource={scope.replaceAll('.', ' · ') + ' 거래소 종가'}
                point={pointAtOrBefore(calculated[id]?.[0] ?? [], display?.time ?? Infinity)}
                readingLabel={
                  (indicatorSpec(id)?.label ?? 'RSI') +
                  (display?.closed === false ? ' · 진행 중인 봉' : ' · 관측')
                }
              />
            ))}
          {indicators.some((id) => indicatorSpec(id)?.kind === 'bb') ? (
            <div className="threshold-legend">
              <b>볼린저밴드: 중심선 ± 설정한 표준편차 배수</b>
              <p className="threshold-note">
                기본은 20봉 SMA ± 2σ입니다. 밴드 접촉은 변동성 범위의 위치이며, 과매수·과매도나 추세
                반전을 확정하지 않습니다. 강한 추세에서는 한쪽 밴드를 따라 이동할 수 있습니다.
              </p>
              <div className="threshold-sources">
                <a
                  href="https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/"
                  target="_blank"
                  rel="noreferrer"
                >
                  TradingView 볼린저밴드 원문 ↗
                </a>
              </div>
            </div>
          ) : null}
          {indicators.some((id) => indicatorSpec(id)?.kind === 'macd') ? (
            <div className="threshold-legend">
              <b>MACD 0: 단기 EMA = 장기 EMA</b>
              <p className="threshold-note">
                MACD선의 0 위·아래는 단기·장기 평균의 위치를, 히스토그램의 0 위·아래는 MACD와 신호
                EMA의 위치를 뜻합니다. 고정 과열·과매도 경계는 없습니다.
              </p>
              <div className="threshold-sources">
                <a
                  href="https://www.tradingview.com/support/solutions/43000502344-moving-average-convergence-divergence-macd-indicator/"
                  target="_blank"
                  rel="noreferrer"
                >
                  TradingView MACD 원문 ↗
                </a>
              </div>
            </div>
          ) : null}
        </details>
      ) : null}
      <ChartRangeControl
        rows={candles}
        resetKey={scope + ':' + period}
        hourly={interval === '1h' || interval === '4h'}
        onApply={(selection) => {
          chartRef.current
            ?.timeScale()
            .setVisibleRange({ from: ts(selection.from), to: ts(selection.to) });
        }}
        onReset={() => {
          chartRef.current?.timeScale().fitContent();
          onPeriodChange?.('all');
        }}
      />
      {drawingList ? (
        <section className="drawing-manager" aria-label="저장된 선 관리">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const price = Number(linePrice);
              if (!Number.isFinite(price) || price <= 0 || !candles.length) {
                setHint('수평선 가격은 0보다 큰 숫자로 입력하세요.');
                return;
              }
              updateDrawings([
                ...drawingsRef.current,
                {
                  id: crypto.randomUUID(),
                  kind: 'horizontal',
                  points: [{ time: candles.at(-1)!.time, value: price }],
                },
              ]);
              setLinePrice('');
              setHint('지정한 가격의 수평선을 저장했습니다. 최대 30개를 보관합니다.');
            }}
          >
            <label>
              수평선 가격 ({unit})
              <input
                type="number"
                step="any"
                min="0"
                value={linePrice}
                onChange={(e) => setLinePrice(e.target.value)}
                placeholder={display ? String(display.close) : ''}
                required
              />
            </label>
            <button type="submit">수평선 추가</button>
          </form>
          {drawings.length ? (
            <>
              <div className="chart-actions">
                <button
                  onClick={() => {
                    updateDrawings(drawingsRef.current.slice(0, -1));
                    setHint('마지막에 추가한 선을 삭제했습니다.');
                  }}
                >
                  마지막 선 실행 취소
                </button>
                <button onClick={clear}>모두 삭제</button>
              </div>
              <ul>
                {drawings.map((drawing, index) => (
                  <li key={drawing.id}>
                    <span>
                      {index + 1}. {drawing.kind === 'horizontal' ? '수평선' : '추세선'} ·{' '}
                      {drawing.points.map((p) => money(p.value, unit)).join(' → ')}
                    </span>
                    <button
                      aria-label={`${index + 1}번 ${drawing.kind === 'horizontal' ? '수평선' : '추세선'} 삭제`}
                      onClick={() =>
                        updateDrawings(drawingsRef.current.filter((d) => d.id !== drawing.id))
                      }
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              마우스로 그리거나 가격을 입력해 선을 추가하세요. 이 코인·시장·봉 간격별로 최대 30개를
              브라우저에 저장합니다.
            </p>
          )}
        </section>
      ) : null}
      <div className="chart-bottom">
        <span role="status">
          {hint || '스크롤로 확대 · 드래그로 이동 · 축을 드래그해 배율 조절'}
        </span>
      </div>
      {missing.length ? (
        <div className="indicator-feedback" role="status">
          {missing.join(', ')}: 일부 선을 계산할 봉이 부족합니다. 일·주 기준은 확정된 봉만
          사용합니다.
        </div>
      ) : null}
    </div>
  );
});
