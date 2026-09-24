import { ChartNavigator, ChartTools } from './ChartNavigator';
import { createDeskChart as createChart } from './chart-theme';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  LineSeries,
  PriceScaleMode,
  TickMarkType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Asset, Period, Point, SeriesResponse } from '../shared/types';
import { ChartRangeControl } from './ChartRangeControl';
import { dateLabel, numeric, money, periodStart } from './lib';
import { zoomChartRange } from './chart-range';
import { THRESHOLDS } from '../shared/thresholds';
import { ThresholdBands } from './ThresholdBands';
import { ThresholdSummary } from './ThresholdSummary';
import { ThresholdLegend } from './ThresholdLegend';

export function networkValue(value: number | undefined, unit: string) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'USD') return money(value, 'USD');
  if (unit === '%' || unit === '비율') return numeric(value * 100, 2) + '%';
  if (unit === '배' || unit === 'ratio') return numeric(value, 3) + '×';
  return numeric(value, Math.abs(value) >= 1000 ? 0 : 3) + (unit ? ' ' + unit : '');
}

/** Only a source-backed line: address counts are not unique people and no OHLC is invented. */
export function NetworkChart({
  series,
  asset,
  metric,
  title,
  unit,
  period,
  onPeriodChange,
}: {
  series: SeriesResponse;
  asset: Asset;
  metric: string;
  title: string;
  unit: string;
  period: Period;
  onPeriodChange: (period: Period) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const line = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLine = useRef<ISeriesApi<'Line'> | null>(null);
  const [showPrice, setShowPrice] = useState(false);
  const bands = useRef<ThresholdBands | null>(null);
  const boundaries = useRef<IPriceLine[]>([]);
  const lastView = useRef<{ key: string; from: UTCTimestamp; to: UTCTimestamp } | null>(null);
  const [log, setLog] = useState(false);
  const [showThresholds, setShowThresholds] = useState(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const points: readonly Point[] = series.data;
  const index = useMemo(() => new Map(points.map((point) => [point.time, point])), [points]);
  const selected = index.get(hoverTime ?? 0) ?? points.at(-1);
  const positive = useMemo(
    () =>
      points.length > 0 && points.every((point) => Number.isFinite(point.value) && point.value > 0),
    [points],
  );
  const thresholdId = 'network_' + metric;
  const definition = THRESHOLDS[thresholdId];
  const logAllowed = positive && metric !== 'nupl';
  const logReason =
    metric === 'nupl'
      ? '0 손익분기 기준선을 보존하기 위해 선형 축을 사용합니다.'
      : !positive
        ? '0·음수 또는 관측 없음으로 선형 축을 사용합니다.'
        : '';
  const current = useRef({ period, log: log && logAllowed, showThresholds });
  current.current = { period, log: log && logAllowed, showThresholds };
  const ts = (time: number) => time as UTCTimestamp;
  useEffect(() => {
    const element = surface.current;
    if (!element || !points.length) return;
    const api = createChart(element, {
      autoSize: true,
      height: 410,
      layout: {
        background: { type: ColorType.Solid, color: '#111721' },
        textColor: '#a4b0c0',
        attributionLogo: true,
        fontFamily: 'Segoe UI, Malgun Gothic, sans-serif',
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1c2633' }, horzLines: { color: '#1c2633' } },
      timeScale: {
        minBarSpacing: 0.01,
        borderVisible: false,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const date = new Date((Number(time) + 9 * 3600) * 1000);
          return type === TickMarkType.Year
            ? String(date.getUTCFullYear())
            : type === TickMarkType.Month
              ? `${date.getUTCMonth() + 1}월`
              : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
        },
      },
      rightPriceScale: {
        borderVisible: false,
        mode: current.current.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      localization: { locale: 'ko-KR', timeFormatter: (time: number) => dateLabel(Number(time)) },
    });
    chart.current = api;
    priceLine.current = api.addSeries(LineSeries, {
      color: '#93a4b3',
      lineWidth: 1,
      priceScaleId: unit === 'USD' ? 'right' : 'left',
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => money(v, 'USD') },
    });
    const plot = api.addSeries(LineSeries, {
      color: '#70d4c4',
      lineWidth: 2,
      pointMarkersVisible: points.length === 1,
      priceLineVisible: false,
      priceFormat: {
        type: 'custom',
        formatter: (v: number) => networkValue(v, unit),
        minMove: 0.000001,
      },
    });
    line.current = plot;
    plot.setData(points.map((point) => ({ time: ts(point.time), value: point.value })));
    boundaries.current = (definition?.boundaries ?? []).map((boundary) =>
      plot.createPriceLine({
        price: boundary.value,
        color: boundary.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineVisible: current.current.showThresholds,
        axisLabelVisible: current.current.showThresholds,
        title: boundary.label,
      }),
    );
    if (definition) {
      const background = new ThresholdBands(definition.bands);
      background.setVisible(current.current.showThresholds);
      plot.attachPrimitive(background);
      bands.current = background;
    }
    element.dataset.availableFrom = String(points[0].time);
    element.dataset.availableTo = String(points.at(-1)!.time);
    element.dataset.observationCount = String(points.length);
    element.dataset.chartGeneration = String(Number(element.dataset.chartGeneration || 0) + 1);
    element.dataset.metricAxis = current.current.log ? 'log' : 'linear';
    element.dataset.thresholdsVisible = String(current.current.showThresholds);
    api.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return;
      element.dataset.visibleFrom = String(Number(range.from));
      element.dataset.visibleTo = String(Number(range.to));
    });
    const visible = points.filter(
      (point) => point.time >= periodStart(current.current.period, points.at(-1)!.time),
    );
    const key = `${asset}:${metric}:${current.current.period}`;
    const prior = lastView.current;
    if (prior?.key === key && prior.to >= points[0].time && prior.from <= points.at(-1)!.time)
      api.timeScale().setVisibleRange({ from: prior.from, to: prior.to });
    else if (visible.length)
      api.timeScale().setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    api.subscribeCrosshairMove((event) => setHoverTime(event.time ? Number(event.time) : null));
    return () => {
      const view = api.timeScale().getVisibleRange();
      if (view)
        lastView.current = {
          key: `${asset}:${metric}:${current.current.period}`,
          from: ts(Number(view.from)),
          to: ts(Number(view.to)),
        };
      api.remove();
      chart.current = null;
      line.current = null;
      bands.current = null;
      boundaries.current = [];
    };
  }, [points, asset, metric, unit, definition]);
  useEffect(() => {
    priceLine.current?.setData(series.price.map((p) => ({ time: ts(p.time), value: p.value })));
    priceLine.current?.applyOptions({ visible: showPrice });
    if (unit !== 'USD')
      chart.current?.priceScale('left').applyOptions({
        visible: showPrice && !!series.price.length,
        mode: PriceScaleMode.Logarithmic,
        borderVisible: false,
      });
  }, [series.price, showPrice, points, asset, metric, unit]);
  useEffect(() => {
    const visible = points.filter(
      (point) => point.time >= periodStart(period, points.at(-1)?.time),
    );
    if (visible.length)
      chart.current
        ?.timeScale()
        .setVisibleRange({ from: ts(visible[0].time), to: ts(visible.at(-1)!.time) });
    setHoverTime(null);
    setNotice('');
  }, [period, asset, metric]);
  useEffect(() => {
    line.current?.priceScale().applyOptions({
      mode: log && logAllowed ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      autoScale: true,
    });
    if (surface.current) surface.current.dataset.metricAxis = log && logAllowed ? 'log' : 'linear';
  }, [log, logAllowed]);
  useEffect(() => {
    bands.current?.setVisible(showThresholds);
    boundaries.current.forEach((boundary) =>
      boundary.applyOptions({ lineVisible: showThresholds, axisLabelVisible: showThresholds }),
    );
    if (surface.current) surface.current.dataset.thresholdsVisible = String(showThresholds);
  }, [showThresholds]);
  function all() {
    if (points.length)
      chart.current
        ?.timeScale()
        .setVisibleRange({ from: ts(points[0].time), to: ts(points.at(-1)!.time) });
    onPeriodChange('all');
  }
  function zoom(factor: number) {
    const range = chart.current?.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const next = zoomChartRange(range, factor);
    if (next) chart.current?.timeScale().setVisibleLogicalRange(next);
  }
  function download() {
    const csv =
      '\uFEFF' +
      [
        'asset,metric,date_utc,value,unit,source',
        ...points.map(
          (p) =>
            `${asset},${metric},${new Date(p.time * 1000).toISOString()},${p.value},${unit === '비율' || unit === '%' ? 'ratio' : unit},CoinMetrics`,
        ),
      ].join('\r\n');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `Coin-Desk-${asset}-${metric}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    setNotice(`${points.length.toLocaleString()}개 실제 관측과 출처를 내보냈습니다.`);
  }
  return (
    <>
      <div className="chart-actions">
        <button
          aria-pressed={showPrice}
          disabled={!series.price.length}
          onClick={() => setShowPrice((v) => !v)}
        >
          USD 가격 {showPrice ? '숨기기' : '표시'}
        </button>
        <button
          aria-pressed={log && logAllowed}
          disabled={!logAllowed}
          title={logReason || undefined}
          onClick={() => setLog((v) => !v)}
        >
          로그축 {log && logAllowed ? '켜짐' : '꺼짐'}
        </button>
        {definition ? (
          <button
            aria-pressed={showThresholds}
            onClick={() => setShowThresholds((value) => !value)}
          >
            손익 구간 {showThresholds ? '숨기기' : '표시'}
          </button>
        ) : null}
        {logReason ? <small className="muted">{logReason}</small> : null}
      </div>
      {definition ? (
        <ThresholdSummary
          id={thresholdId}
          unit={unit}
          point={selected}
          selected={hoverTime !== null}
          stale={series.meta.stale}
        />
      ) : (
        <div className="network-chart-readout">
          <span>
            {title} · {selected ? dateLabel(selected.time) : '관측 없음'}
          </span>
          <b>{networkValue(selected?.value, unit)}</b>
        </div>
      )}
      <div
        ref={surface}
        className="financial-chart"
        data-chart-kind="network"
        data-asset={asset}
        data-metric={metric}
        role="group"
        tabIndex={0}
        aria-label={`${asset} ${title} 전체 이력. 좌우 방향키로 날짜별 값 확인`}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !points.length ||
            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
          )
            return;
          event.preventDefault();
          const cursor = points.findIndex((p) => p.time === selected?.time);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? points.length - 1
                : Math.min(
                    points.length - 1,
                    Math.max(0, cursor + (event.key === 'ArrowLeft' ? -1 : 1)),
                  );
          setHoverTime(points[next].time);
          setNotice(
            `${dateLabel(points[next].time)} · ${title} ${networkValue(points[next].value, unit)}`,
          );
          if (line.current)
            chart.current?.setCrosshairPosition(
              points[next].value,
              ts(points[next].time),
              line.current,
            );
        }}
      />
      <ChartNavigator rows={series.data} chart={chart} label={title} log={log && logAllowed} />
      <ChartTools
        chart={chart}
        rows={series.data}
        label={title}
        unit={unit}
        source={series.meta.source}
        onZoom={zoom}
        onReset={all}
        onExport={download}
        exportLabel="전체 CSV"
      />
      {definition ? (
        <ThresholdLegend
          id={thresholdId}
          unit={unit}
          showReading={false}
          dataSource={series.meta.source}
          compact
        />
      ) : null}
      <ChartRangeControl
        rows={points}
        resetKey={`${asset}:${metric}:${period}`}
        onApply={(range) =>
          chart.current?.timeScale().setVisibleRange({ from: ts(range.from), to: ts(range.to) })
        }
        onReset={all}
      />
      {notice ? (
        <p role="status" className="network-note">
          {notice}
        </p>
      ) : null}
    </>
  );
}
