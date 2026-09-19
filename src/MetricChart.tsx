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
import { ChartRangeControl } from './ChartRangeControl';
import { zoomChartRange } from './chart-range';
import './chart-improvements.css';
export const MetricChart = memo(function MetricChart({
  series,
  metric,
  period = 'all',
  large = false,
  onPeriodChange,
}: {
  series: SeriesResponse;
  metric: Metric;
  period?: Period;
  large?: boolean;
  onPeriodChange?: (period: Period) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const metricRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lastView = useRef<{ key: string; from: UTCTimestamp; to: UTCTimestamp } | null>(null);
  const [showPrice, setShowPrice] = useState(true);
  const [axisChoice, setAxisChoice] = useState<{ metric: string; log: boolean } | null>(null);
  const positiveHistory = useMemo(
    () =>
      series.data.length > 0 && series.data.every((p) => Number.isFinite(p.value) && p.value > 0),
    [series.data],
  );
  const logUnavailable = !series.data.length
    ? '관측 데이터가 없어 로그축을 사용할 수 없습니다.'
    : !positiveHistory
      ? '전체 이력에 0 또는 음수가 있어 선형축으로 표시합니다.'
      : metric.reference !== undefined && metric.reference <= 0
        ? '0 또는 음수 기준선을 보존하기 위해 선형축으로 표시합니다.'
        : '';
  const defaultLog = ['mvrv', 'sth_mvrv', 'lth_mvrv'].includes(metric.id);
  const metricLog =
    !logUnavailable && (axisChoice?.metric === metric.id ? axisChoice.log : defaultLog);
  const settingsRef = useRef({ period, showPrice, metricLog });
  settingsRef.current = { period, showPrice, metricLog };
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
        mode: settingsRef.current.metricLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.13, bottom: 0.1 },
      },
      rightPriceScale: {
        visible: large && settingsRef.current.showPrice,
        borderVisible: false,
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        lockVisibleTimeRangeOnResize: true,
        // The default 0.5px clips 5,880 daily observations to ~900 on a 450px chart.
        // A full cycle overview must fit the actual history before the user zooms in.
        minBarSpacing: 0.01,
      },
      localization: { locale: 'ko-KR', timeFormatter: (time: number) => dateLabel(Number(time)) },
    });
    chartRef.current = chart;
    const surface = container.current;
    surface.dataset.chartGeneration = String(Number(surface.dataset.chartGeneration || 0) + 1);
    surface.dataset.observationCount = String(series.data.length);
    surface.dataset.metricAxis = settingsRef.current.metricLog ? 'log' : 'linear';
    surface.dataset.availableFrom = String(series.data[0].time);
    surface.dataset.availableTo = String(series.data.at(-1)!.time);
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return;
      surface.dataset.visibleFrom = String(Number(range.from));
      surface.dataset.visibleTo = String(Number(range.to));
    });
    const price = chart.addSeries(LineSeries, {
      color: large ? '#8090a880' : '#69778c65',
      lineWidth: 1,
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
      visible: settingsRef.current.showPrice,
      priceFormat: { type: 'custom', formatter: (v: number) => money(v, 'USD') },
    });
    priceRef.current = price;
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
      (p) => p.time >= periodStart(settingsRef.current.period, series.data.at(-1)!.time),
    );
    const viewKey = metric.id + ':' + settingsRef.current.period;
    const prior = lastView.current;
    if (
      prior?.key === viewKey &&
      prior.to >= series.data[0].time &&
      prior.from <= series.data.at(-1)!.time
    )
      chart.timeScale().setVisibleRange({ from: prior.from, to: prior.to });
    else if (visible.length)
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
          key: metric.id + ':' + settingsRef.current.period,
          from: Number(range.from) as UTCTimestamp,
          to: Number(range.to) as UTCTimestamp,
        };
      chart.remove();
      chartRef.current = null;
      metricRef.current = null;
      priceRef.current = null;
    };
  }, [series.data, series.price, metric, large]);
  useEffect(() => {
    priceRef.current?.applyOptions({ visible: showPrice });
    chartRef.current?.priceScale('right').applyOptions({ visible: large && showPrice });
  }, [showPrice, large]);
  useEffect(() => {
    // Change only the vertical scale: retain every observation, reference line,
    // crosshair series, and the user's current horizontal viewing range.
    chartRef.current?.priceScale('left').applyOptions({
      mode: metricLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      autoScale: true,
    });
    if (container.current) container.current.dataset.metricAxis = metricLog ? 'log' : 'linear';
  }, [metricLog]);
  useEffect(() => {
    const last = series.data.at(-1)?.time;
    if (last === undefined) return;
    const points = series.data.filter((p) => p.time >= periodStart(period, last));
    if (points.length)
      chartRef.current?.timeScale().setVisibleRange({
        from: points[0].time as UTCTimestamp,
        to: points.at(-1)!.time as UTCTimestamp,
      });
    // Refreshing observations keeps the user's viewport; changing the chosen period resets it.
  }, [period, metric.id]);
  function zoom(factor: number) {
    const scale = chartRef.current?.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const next = zoomChartRange(range, factor);
    if (next) scale.setVisibleLogicalRange(next);
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
          `, 왼쪽 지표축 ${metricLog ? '로그' : '선형'}, Bitview 추정 USD 가격 차트` +
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
      <div className="chart-actions" aria-label={metric.title + ' 지표축 설정'}>
        <span className="muted">왼쪽 지표축 · {metricLog ? '로그' : '선형'}</span>
        <button
          aria-pressed={metricLog}
          disabled={!!logUnavailable}
          title={
            logUnavailable ||
            '같은 배율의 변화가 같은 높이로 보입니다. 원래 지표 값은 그대로입니다.'
          }
          style={metricLog ? { borderColor: metric.color } : undefined}
          onClick={() => setAxisChoice({ metric: metric.id, log: true })}
        >
          로그
        </button>
        <button
          aria-pressed={!metricLog}
          title="같은 수치의 차이가 같은 높이로 보입니다."
          style={!metricLog ? { borderColor: metric.color } : undefined}
          onClick={() => setAxisChoice({ metric: metric.id, log: false })}
        >
          선형
        </button>
        {logUnavailable ? (
          <small className="muted">{logUnavailable}</small>
        ) : large ? (
          <small className="muted">
            {metricLog
              ? '동일 배율 = 동일 높이 · 초기 큰 값도 모두 포함'
              : '동일 수치 차이 = 동일 높이'}
          </small>
        ) : null}
      </div>
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
                if (points.length)
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
          <ChartRangeControl
            rows={series.data}
            resetKey={metric.id + ':' + period}
            onApply={(selection) => {
              chartRef.current?.timeScale().setVisibleRange({
                from: selection.from as UTCTimestamp,
                to: selection.to as UTCTimestamp,
              });
            }}
            onReset={() => {
              if (series.data.length)
                chartRef.current?.timeScale().setVisibleRange({
                  from: series.data[0].time as UTCTimestamp,
                  to: series.data.at(-1)!.time as UTCTimestamp,
                });
              onPeriodChange?.('all');
            }}
          />
        </>
      ) : null}
    </>
  );
});
