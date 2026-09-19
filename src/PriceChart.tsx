import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  PriceScaleMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { aggregate, atBarClose, bollinger, rsi, sma, ema, macd } from '../shared/math';
import { indicatorSpec } from '../shared/indicators';
import type { Candle, Drawing, Interval, Period, Point } from '../shared/types';
import { dateLabel, money, priceDigits, periodStart, save, saved } from './lib';
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
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const toolRef = useRef(tool);
  const doneRef = useRef(onToolDone);
  toolRef.current = tool;
  doneRef.current = onToolDone;
  const [drawings, setDrawings] = useState<Drawing[]>(() => saved('drawings.' + scope, []));
  const drawingsRef = useRef(drawings);
  const pending = useRef<Point | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [hint, setHint] = useState('');
  useEffect(() => {
    const d = saved<Drawing[]>('drawings.' + scope, []);
    setDrawings(d);
    drawingsRef.current = d;
    pending.current = null;
  }, [scope]);
  const calculated = useMemo(() => {
    const closes = candles.map((c) => ({ time: c.time, value: c.close }));
    const closedDaily = daily.filter((c) => c.closed);
    const dailyPoints = closedDaily.map((c) => ({ time: c.time, value: c.close }));
    const weekly = aggregate(closedDaily, '1w')
      .filter((c) => c.closed)
      .map((c) => ({ time: c.time, value: c.close }));
    const out: Record<string, Point[][]> = {};
    for (const id of indicators) {
      const spec = indicatorSpec(id);
      if (!spec) continue;
      if (spec.kind === 'bb') {
        const b = bollinger(closes, spec.period, spec.multiplier);
        out[id] = [b.middle, b.upper, b.lower];
      } else if (spec.kind === 'rsi') out[id] = [rsi(closes, spec.period)];
      else if (spec.kind === 'macd') {
        const m = macd(closes);
        out[id] = [m.line, m.signal, m.histogram];
      } else {
        const input = spec.basis === 'w' ? weekly : spec.basis === 'd' ? dailyPoints : closes;
        const points = (spec.kind === 'ema' ? ema : sma)(input, spec.period);
        out[id] = [
          spec.basis === 'bar'
            ? points
            : atBarClose(points, spec.basis === 'd' ? '1d' : '1w', candles),
        ];
      }
    }
    return out;
  }, [candles, daily, indicators]);
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
        mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.1, bottom: 0.12 },
      },
      timeScale: {
        lockVisibleTimeRangeOnResize: true,
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
    main.setData(candles.map((c) => ({ ...c, time: ts(c.time) })));
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
        for (const price of [30, 70])
          s.createPriceLine({
            price,
            color: '#66517a',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: '',
          });
        chart.panes()[pane].setHeight(90);
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
    const visible = candles.filter((c) => c.time >= periodStart(period, candles.at(-1)!.time));
    if (visible.length > 1)
      chart
        .timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    const paint = (d: Drawing) => {
      if (d.kind === 'horizontal')
        main.createPriceLine({
          price: d.points[0].value,
          color: '#edb35f',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '메모',
        });
      else if (d.points.length === 2)
        chart
          .addSeries(LineSeries, {
            color: '#edb35f',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          })
          .setData(lineData([...d.points].sort((a, b) => a.time - b.time)));
    };
    const stored = saved<Drawing[]>('drawings.' + scope, []);
    stored.forEach(paint);
    drawingsRef.current = stored;
    chart.subscribeCrosshairMove((p) => {
      const c = p.seriesData.get(main);
      if (c && 'open' in c) setHover(c as unknown as Candle);
      else setHover(null);
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
      const next = [...drawingsRef.current, drawing].slice(-30);
      drawingsRef.current = next;
      setDrawings(next);
      save('drawings.' + scope, next);
      paint(drawing);
      setHint('차트 메모를 이 브라우저에 저장했습니다.');
      doneRef.current();
    });
    const empty = indicators.filter((id) => !calculated[id]?.[0]?.length);
    if (empty.length)
      setHint(
        empty.map((id) => indicatorSpec(id)?.label).join(', ') +
          ' 계산에 필요한 확정 봉이 부족합니다.',
      );
    return () => {
      cancelAnimationFrame(readyFrame);
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
    };
  }, [candles, calculated, interval, large, log, period, scope, unit, indicators]);
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
  const [reset, setReset] = useState(0);
  function clear() {
    save('drawings.' + scope, []);
    drawingsRef.current = [];
    setDrawings([]);
    pending.current = null;
    setReset((v) => v + 1);
    setHint('저장된 선을 삭제했습니다.');
  }
  // A reset remount clears chart-owned price lines and custom drawing series.
  useEffect(() => {
    if (reset) window.dispatchEvent(new CustomEvent('btc-drawings-reset', { detail: scope }));
  }, [reset, scope]);
  const display = hover ?? candles.at(-1);
  const missing = indicators
    .filter((id) => !calculated[id]?.[0]?.length)
    .map((id) => indicatorSpec(id)?.label);
  return (
    <div className="chart-surface">
      <div className="ohlc-readout" aria-live="off">
        {display ? (
          <>
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
            {!display.closed && !hover ? <em>진행 중인 봉</em> : null}
          </>
        ) : null}
      </div>
      <div className="indicator-readout" aria-live="off">
        {indicators.map((id) => {
          const spec = indicatorSpec(id);
          const current =
            calculated[id]?.map((series) => {
              let lo = 0,
                hi = series.length;
              const t = display?.time ?? Infinity;
              while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (series[mid].time <= t) lo = mid + 1;
                else hi = mid;
              }
              return series[lo - 1]?.value;
            }) || [];
          return (
            <span key={id} style={{ color: spec?.color }}>
              {spec?.label}
              <b>
                {current
                  .map((v) =>
                    v === undefined ? '—' : spec?.kind === 'rsi' ? v.toFixed(1) : money(v, unit),
                  )
                  .join(' / ')}
              </b>
            </span>
          );
        })}
      </div>
      <div
        ref={container}
        className="financial-chart"
        role="img"
        aria-label="가격, 거래량과 선택한 기술지표 차트"
      />
      <div className="chart-bottom">
        <span>
          {hint ||
            (missing.length ? missing.join(', ') + ' 계산에 필요한 확정 봉이 부족합니다.' : null) ||
            '스크롤로 확대 · 드래그로 이동 · 축을 드래그해 배율 조절'}
        </span>
        {drawings.length ? <button onClick={clear}>그린 선 {drawings.length}개 삭제</button> : null}
      </div>
    </div>
  );
});
