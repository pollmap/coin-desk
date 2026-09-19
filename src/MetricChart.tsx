import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  PriceScaleMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Metric, Period, SeriesResponse } from '../shared/types';
import { dateLabel, metricValue, money, periodStart } from './lib';
import './chart-improvements.css';
export const MetricChart = memo(function MetricChart({
  series,
  metric,
  period = 'all',
  large = false,
}: {
  series: SeriesResponse;
  metric: Metric;
  period?: Period;
  large?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const metricRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lastView = useRef<{ key: string; from: UTCTimestamp; to: UTCTimestamp } | null>(null);
  const [showPrice, setShowPrice] = useState(true);
  const [keyboardValue, setKeyboardValue] = useState('');
  const [hover, setHover] = useState<{ time: number; value: number } | null>(null);
  const priceByTime = useMemo(
    () => new Map(series.price.map((p) => [p.time, p.value])),
    [series.price],
  );
  const dataByTime = useMemo(() => new Map(series.data.map((p) => [p.time, p])), [series.data]);
  const display = (hover ? dataByTime.get(hover.time) : null) ?? series.data.at(-1);
  useEffect(() => {
    if (!container.current || !series.data.length) return;
    const factor = metric.unit === '비율' ? 100 : 1;
    const chart = createChart(container.current, {
      autoSize: true,
      height: large ? 440 : 170,
      layout: {
        background: { type: ColorType.Solid, color: '#111721' },
        textColor: '#7b889b',
        fontSize: large ? 11 : 10,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: large, color: '#1d2532' }, horzLines: { color: '#1d2532' } },
      leftPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.13, bottom: 0.1 },
      },
      rightPriceScale: {
        visible: large && showPrice,
        borderVisible: false,
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: { borderVisible: false, lockVisibleTimeRangeOnResize: true },
      localization: { locale: 'ko-KR', timeFormatter: (time: number) => dateLabel(Number(time)) },
    });
    chartRef.current = chart;
    const price = chart.addSeries(LineSeries, {
      color: large ? '#8090a880' : '#69778c65',
      lineWidth: 1,
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
      visible: showPrice,
      priceFormat: { type: 'custom', formatter: (v: number) => money(v, 'USD') },
    });
    price.setData(series.price.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    const line = chart.addSeries(LineSeries, {
      color: metric.color,
      lineWidth: large ? 2 : 1,
      priceScaleId: 'left',
      priceLineVisible: false,
      lastValueVisible: large,
      priceFormat: {
        type: 'custom',
        formatter: (v: number) =>
          metric.unit === '비율'
            ? v.toFixed(1) + '%'
            : v.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      },
    });
    metricRef.current = line;
    line.setData(
      series.data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value * factor })),
    );
    if (metric.reference !== undefined)
      line.createPriceLine({
        price: metric.reference * factor,
        color: '#6c7886',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: large,
        title: '',
      });
    const visible = series.data.filter(
      (p) => p.time >= periodStart(period, series.data.at(-1)!.time),
    );
    const viewKey = metric.id + ':' + period;
    const prior = lastView.current;
    if (
      prior?.key === viewKey &&
      prior.to >= series.data[0].time &&
      prior.from <= series.data.at(-1)!.time
    )
      chart.timeScale().setVisibleRange({ from: prior.from, to: prior.to });
    else if (visible.length > 1)
      chart.timeScale().setVisibleRange({
        from: visible[0].time as UTCTimestamp,
        to: visible.at(-1)!.time as UTCTimestamp,
      });
    chart.subscribeCrosshairMove((p) => {
      const row = p.seriesData.get(line);
      setHover(
        row && 'value' in row ? { time: Number(row.time), value: row.value / factor } : null,
      );
    });
    return () => {
      const range = chart.timeScale().getVisibleRange();
      if (range)
        lastView.current = {
          key: viewKey,
          from: Number(range.from) as UTCTimestamp,
          to: Number(range.to) as UTCTimestamp,
        };
      chart.remove();
      chartRef.current = null;
      metricRef.current = null;
    };
  }, [series, metric, period, large, showPrice]);
  function zoom(factor: number) {
    const scale = chartRef.current?.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const center = (range.from + range.to) / 2;
    const half = Math.max(5, ((range.to - range.from) * factor) / 2);
    scale.setVisibleLogicalRange({ from: center - half, to: center + half });
  }
  return (
    <>
      <div
        ref={container}
        role={large ? 'group' : 'img'}
        tabIndex={large ? 0 : undefined}
        className="financial-chart"
        aria-label={
          metric.title +
          ' 및 Bitview 추정 USD 가격 차트' +
          (large ? '. 좌우 화살표로 날짜별 값 확인' : '')
        }
        onKeyDown={
          large
            ? (e) => {
                if (
                  e.target !== e.currentTarget ||
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
                )
                  return;
                e.preventDefault();
                const index = display
                  ? series.data.findIndex((p) => p.time === display.time)
                  : series.data.length - 1;
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? series.data.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            series.data.length - 1,
                            index + (e.key === 'ArrowLeft' ? -1 : 1),
                          ),
                        );
                const point = series.data[next];
                if (point && metricRef.current) {
                  setHover(point);
                  setKeyboardValue(
                    `${dateLabel(point.time)} · ${metric.title} ${metricValue(point.value, metric.unit)} · 추정 USD 가격 ${money(priceByTime.get(point.time), 'USD')}`,
                  );
                  chartRef.current?.setCrosshairPosition(
                    point.value * (metric.unit === '비율' ? 100 : 1),
                    point.time as UTCTimestamp,
                    metricRef.current,
                  );
                }
              }
            : undefined
        }
      />
      {large ? (
        <span className="chart-keyboard-status" role="status">
          {keyboardValue}
        </span>
      ) : null}
      {large ? (
        <>
          <div className="metric-hover metric-observation" aria-live="off">
            <span>{display ? dateLabel(display.time) : '데이터 대기'}</span>
            <span>
              {metric.title} <b>{metricValue(display?.value, metric.unit)}</b>
            </span>
            {showPrice ? (
              <span>
                추정 USD 가격 <b>{display ? money(priceByTime.get(display.time), 'USD') : '—'}</b>
              </span>
            ) : null}
          </div>
          <div className="chart-actions" aria-label="온체인 차트 조작">
            <button onClick={() => zoom(1 / 1.4)} aria-label="온체인 차트 확대">
              ＋ 확대
            </button>
            <button onClick={() => zoom(1.4)} aria-label="온체인 차트 축소">
              − 축소
            </button>
            <button
              onClick={() => {
                const points = series.data.filter(
                  (p) => p.time >= periodStart(period, series.data.at(-1)!.time),
                );
                if (points.length > 1)
                  chartRef.current?.timeScale().setVisibleRange({
                    from: points[0].time as UTCTimestamp,
                    to: points.at(-1)!.time as UTCTimestamp,
                  });
              }}
            >
              화면 맞춤
            </button>
            <button aria-pressed={showPrice} onClick={() => setShowPrice(!showPrice)}>
              BTC 추정 가격 {showPrice ? '숨기기' : '표시'}
            </button>
          </div>
        </>
      ) : null}
    </>
  );
});
