import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Asset, Period, SeriesResponse } from '../shared/types';
import { ASSETS } from '../shared/catalog';
import { ChartRangeControl } from './ChartRangeControl';
import { zoomChartRange } from './chart-range';
import { dateLabel, money, periodStart, priceDigits } from './lib';
import './chart-improvements.css';

const ts = (time: number) => time as UTCTimestamp;

/** CoinMetrics PriceUSD stays a separate series with its own provenance and unit. */
export const LongHistoryChart = memo(function LongHistoryChart({
  series,
  asset,
  period,
  log,
  onPeriodChange,
}: {
  series: SeriesResponse;
  asset: Asset;
  period: Period;
  log: boolean;
  onPeriodChange?: (period: Period) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const settings = useRef({ period, log });
  settings.current = { period, log };
  const previous = useRef<{ key: string; from: number; to: number } | null>(null);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [keyboardMessage, setKeyboardMessage] = useState('');
  const [message, setMessage] = useState('');
  const points = series.data;
  const byTime = useMemo(() => new Map(points.map((point) => [point.time, point])), [points]);
  const display = (selectedTime === null ? undefined : byTime.get(selectedTime)) ?? points.at(-1);
  const color = ASSETS.find((coin) => coin.id === asset)?.color || '#eeb66d';

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !points.length) return;
    const chart = createChart(surface, {
      autoSize: true,
      height: 410,
      layout: {
        background: { type: ColorType.Solid, color: '#111721' },
        textColor: '#91a0b5',
        attributionLogo: true,
        fontFamily: 'Inter, Segoe UI, Malgun Gothic, sans-serif',
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1b2431' }, horzLines: { color: '#1b2431' } },
      timeScale: { minBarSpacing: 0.01, borderVisible: false, lockVisibleTimeRangeOnResize: true },
      rightPriceScale: {
        borderVisible: false,
        mode: settings.current.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      localization: { locale: 'ko-KR', timeFormatter: (time: number) => dateLabel(Number(time)) },
      crosshair: {
        vertLine: { color: '#5e6d81', labelBackgroundColor: '#344154' },
        horzLine: { color: '#5e6d81', labelBackgroundColor: '#344154' },
      },
    });
    chartRef.current = chart;
    const line = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      pointMarkersVisible: points.length === 1,
      priceFormat: {
        type: 'custom',
        formatter: (value: number) => money(value, 'USD'),
        minMove: 10 ** -priceDigits(Math.min(...points.map((point) => point.value)), 'USD'),
      },
    });
    lineRef.current = line;
    line.setData(points.map((point) => ({ time: ts(point.time), value: point.value })));
    surface.dataset.chartGeneration = String(Number(surface.dataset.chartGeneration || 0) + 1);
    surface.dataset.observationCount = String(points.length);
    surface.dataset.availableFrom = String(points[0].time);
    surface.dataset.availableTo = String(points.at(-1)!.time);
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return;
      surface.dataset.visibleFrom = String(Number(range.from));
      surface.dataset.visibleTo = String(Number(range.to));
    });
    const prior = previous.current;
    const key = asset + ':' + settings.current.period;
    const visible = points.filter(
      (point) => point.time >= periodStart(settings.current.period, points.at(-1)!.time),
    );
    if (prior?.key === key && prior.to >= points[0].time && prior.from <= points.at(-1)!.time)
      chart.timeScale().setVisibleRange({ from: ts(prior.from), to: ts(prior.to) });
    else if (visible.length)
      chart
        .timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    chart.subscribeCrosshairMove((event) =>
      setSelectedTime(event.time ? Number(event.time) : null),
    );
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        surface.dataset.chartReadyMs = String(Math.round(performance.now()));
      });
    });
    return () => {
      const range = chart.timeScale().getVisibleRange();
      if (range)
        previous.current = {
          key: asset + ':' + settings.current.period,
          from: Number(range.from),
          to: Number(range.to),
        };
      cancelAnimationFrame(frame);
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
    };
  }, [points, asset, color]);

  useEffect(() => {
    lineRef.current
      ?.priceScale()
      .applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);
  useEffect(() => {
    const last = points.at(-1)?.time;
    if (last === undefined) return;
    const visible = points.filter((point) => point.time >= periodStart(period, last));
    if (visible.length)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    setSelectedTime(null);
    setKeyboardMessage('');
    setMessage('');
    // A chosen period resets the view. Refreshing the same source retains user zoom.
  }, [period, asset]);

  function zoom(factor: number) {
    const scale = chartRef.current?.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const next = zoomChartRange(range, factor);
    if (next) scale.setVisibleLogicalRange(next);
  }
  function allHistory() {
    if (points.length)
      chartRef.current
        ?.timeScale()
        .setVisibleRange({ from: ts(points[0].time), to: ts(points.at(-1)!.time) });
    onPeriodChange?.('all');
  }
  function exportCsv() {
    const range = chartRef.current?.timeScale().getVisibleRange();
    const visible = points.filter(
      (point) => !range || (point.time >= Number(range.from) && point.time <= Number(range.to)),
    );
    const csv =
      '\uFEFF' +
      [
        'asset,date_utc,price_usd,source',
        ...visible.map(
          (point) =>
            `${asset},${new Date(point.time * 1000).toISOString()},${point.value},CoinMetrics PriceUSD`,
        ),
      ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Coin-Desk-${asset}-CoinMetrics-USD.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      `${visible.length.toLocaleString()}개 실제 USD 가격 관측을 UTC 시각·원천과 함께 내보냈습니다.`,
    );
  }

  return (
    <div className="long-history-chart">
      <div className="long-history-heading">
        <div>
          <strong>{asset} 장기 USD 가격</strong>
          <span>CoinMetrics PriceUSD · 일별 관측</span>
        </div>
        <div className="long-history-observation">
          <span>{display ? dateLabel(display.time) : '관측 대기'}</span>
          <b>{money(display?.value, 'USD')}</b>
        </div>
      </div>
      {!points.length ? (
        <div className="empty-state">이 자산의 장기 USD 가격 관측을 아직 확보하지 못했습니다.</div>
      ) : null}
      <div
        ref={surfaceRef}
        className="financial-chart"
        data-chart-kind="long-history"
        data-asset={asset}
        role="group"
        tabIndex={0}
        aria-label={`${asset} CoinMetrics 장기 USD 가격 차트. 좌우 화살표로 날짜별 가격, 더하기·빼기로 확대·축소`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (['+', '=', '-'].includes(event.key)) {
            event.preventDefault();
            zoom(event.key === '-' ? 1.4 : 1 / 1.4);
            return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !points.length)
            return;
          event.preventDefault();
          const index = display
            ? points.findIndex((point) => point.time === display.time)
            : points.length - 1;
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? points.length - 1
                : Math.max(
                    0,
                    Math.min(points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)),
                  );
          const point = points[next];
          setSelectedTime(point.time);
          setKeyboardMessage(
            `${dateLabel(point.time)} · ${asset} ${money(point.value, 'USD')} · CoinMetrics USD 가격`,
          );
          if (lineRef.current)
            chartRef.current?.setCrosshairPosition(point.value, ts(point.time), lineRef.current);
        }}
      />
      <span className="chart-keyboard-status" role="status">
        {keyboardMessage}
      </span>
      <div className="chart-actions" aria-label="장기 가격 차트 조작">
        <button onClick={() => zoom(1 / 1.4)} aria-label="장기 가격 차트 확대">
          ＋ 확대
        </button>
        <button onClick={() => zoom(1.4)} aria-label="장기 가격 차트 축소">
          − 축소
        </button>
        <button onClick={allHistory}>전체 이력 보기</button>
        <button onClick={exportCsv} disabled={!points.length}>
          보이는 구간 CSV
        </button>
      </div>
      <ChartRangeControl
        rows={points}
        resetKey={asset + ':' + period}
        onApply={(selection) =>
          chartRef.current
            ?.timeScale()
            .setVisibleRange({ from: ts(selection.from), to: ts(selection.to) })
        }
        onReset={allHistory}
      />
      {message ? (
        <p className="long-history-notice" role="status">
          {message}
        </p>
      ) : null}
      {series.meta.warning ? (
        <p className="long-history-notice amber" role="status">
          {series.meta.warning}
        </p>
      ) : null}
      <div className="source-line">
        <span>
          출처 CoinMetrics · 단위 USD · {dateLabel(points[0]?.time)} ~{' '}
          {dateLabel(points.at(-1)?.time)}
        </span>
        <span className={series.meta.stale ? 'amber' : ''}>
          {series.meta.stale ? '갱신 지연 · ' : ''}수집 {dateLabel(series.meta.fetchedAt, true)}
        </span>
      </div>
    </div>
  );
});
