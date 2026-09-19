import { memo, useEffect, useRef, useState } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  PriceScaleMode,
  LineStyle,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Metric, Period, SeriesResponse } from '../shared/types';
import { dateLabel, metricValue, periodStart } from './lib';
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
  const [hover, setHover] = useState<{ time: number; value: number } | null>(null);
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
        visible: large,
        borderVisible: false,
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: { borderVisible: false, lockVisibleTimeRangeOnResize: true },
      localization: { locale: 'ko-KR' },
    });
    const price = chart.addSeries(LineSeries, {
      color: large ? '#8090a880' : '#69778c65',
      lineWidth: 1,
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
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
    if (visible.length > 1)
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
    return () => chart.remove();
  }, [series, metric, period, large]);
  return (
    <>
      <div
        ref={container}
        role="img"
        aria-label={metric.title + ' 및 Bitview 추정 USD 가격 차트'}
      />
      {large ? (
        <div className="metric-hover">
          {hover
            ? dateLabel(hover.time) +
              ' · ' +
              metric.title +
              ' ' +
              metricValue(hover.value, metric.unit)
            : '차트 위에 마우스를 올리면 날짜별 값을 볼 수 있습니다.'}
        </div>
      ) : null}
    </>
  );
});
