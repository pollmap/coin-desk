import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type AutoscaleInfo,
} from 'lightweight-charts';
import { createDeskChart } from './chart-theme';
import type { CandleResponse, SeriesResponse } from '../shared/types';
import { useData } from './hooks';
import { dateLabel, numeric } from './lib';
import './analysis-expansion.css';
import { useSearchParams } from 'react-router-dom';
import { ChartTools } from './ChartNavigator';
import { zoomChartRange } from './chart-range';

type Featured = import('../shared/types').Asset;
type Metric = 'funding' | 'open_interest' | 'long_account_ratio';
const DAY = 86400;
const quantity = (value: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);

export function DerivativesPanel({
  asset,
  dedicated = false,
}: {
  asset: Featured;
  dedicated?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [localMetric, setLocalMetric] = useState<Metric>('funding');
  const requested = dedicated ? params.get('metric') : localMetric;
  const metric: Metric =
    requested === 'open_interest' || requested === 'long_account_ratio' ? requested : 'funding';
  const [localInterval, setLocalInterval] = useState('1d');
  const interval = (dedicated ? params.get('interval') : localInterval) === '1h' ? '1h' : '1d';
  function setMetric(value: Metric) {
    setLocalMetric(value);
    if (dedicated)
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set('metric', value);
          return next;
        },
        { replace: true },
      );
  }
  function setInterval(value: string) {
    setLocalInterval(value);
    if (dedicated)
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set('interval', value);
          return next;
        },
        { replace: true },
      );
  }
  const [windowDays, setWindowDays] = useState(0);
  const [showPrice, setShowPrice] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [keyboardNotice, setKeyboardNotice] = useState('');
  useEffect(() => {
    setHoverTime(null);
    setKeyboardNotice('');
  }, [asset, metric, interval, windowDays]);
  const funding = useData<SeriesResponse>(
    `/api/v1/derivatives?asset=${asset}&metric=funding&limit=1000`,
    true,
    3600000,
  );
  const interest = useData<SeriesResponse>(
    `/api/v1/derivatives?asset=${asset}&metric=open_interest&limit=1000`,
    true,
    3600000,
  );
  const longAccounts = useData<SeriesResponse>(
    `/api/v1/derivatives?asset=${asset}&metric=long_account_ratio&limit=1000`,
    true,
    3600000,
  );
  const daily = useData<SeriesResponse>(
    metric !== 'funding' && interval === '1d'
      ? `/api/v1/derivatives?asset=${asset}&metric=${metric}_daily&limit=1000`
      : null,
    true,
    3600000,
  );
  const result =
    metric === 'funding'
      ? funding
      : interval === '1d'
        ? daily
        : metric === 'open_interest'
          ? interest
          : longAccounts;
  const spot = useData<CandleResponse>(
    showPrice ? `/api/v1/candles?asset=${asset}&market=binance&interval=1d&limit=1000` : null,
    true,
    900000,
  );
  const data = useMemo(() => {
    const rows = result.data?.data ?? [];
    const end = rows.at(-1)?.time ?? 0;
    return windowDays ? rows.filter((point) => point.time >= end - windowDays * DAY) : rows;
  }, [result.data, windowDays]);
  const spotPoints = useMemo(() => {
    if (!showPrice || !data.length) return [];
    return (spot.data?.data ?? [])
      .filter(
        (candle) =>
          candle.closed && candle.time >= data[0].time && candle.time <= data.at(-1)!.time,
      )
      .map((candle) => ({ time: candle.time, value: candle.close }));
  }, [spot.data, showPrice, data]);
  useEffect(() => {
    if (!ref.current || !data.length) return;
    const chart = createDeskChart(ref.current, {
      autoSize: true,
      height: dedicated ? 430 : 300,
      layout: { attributionLogo: true },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins:
          metric === 'long_account_ratio' ? { top: 0, bottom: 0 } : { top: 0.1, bottom: 0.1 },
      },
      leftPriceScale: { visible: spotPoints.length > 0, borderVisible: false },
      timeScale: { borderVisible: false, minBarSpacing: 0.01 },
      localization: {
        locale: 'ko-KR',
        timeFormatter: (time: number) => dateLabel(Number(time), true),
      },
    });
    chartRef.current = chart;
    setHoverTime(null);
    const line = chart.addSeries(LineSeries, {
      color: metric === 'funding' ? '#6bd7bb' : metric === 'open_interest' ? '#a9a4f0' : '#e8ad65',
      lineWidth: 2,
      priceLineVisible: false,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const range = original();
        if (!range?.priceRange || metric === 'open_interest') return range;
        return {
          ...range,
          priceRange:
            metric === 'long_account_ratio'
              ? { minValue: 0, maxValue: 100 }
              : {
                  minValue: Math.min(0, range.priceRange.minValue),
                  maxValue: Math.max(0, range.priceRange.maxValue),
                },
        };
      },
      priceFormat: {
        type: 'custom',
        formatter: (value: number) =>
          metric === 'funding'
            ? numeric(value, 4) + '%'
            : metric === 'open_interest'
              ? quantity(value) + ' ' + asset
              : numeric(value, 2) + '%',
      },
    });
    lineRef.current = line;
    line.setData(data.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    if (metric !== 'open_interest')
      line.createPriceLine({
        price: metric === 'funding' ? 0 : 50,
        color: '#8394a3',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: metric === 'funding' ? '0%' : '50%',
      });
    if (spotPoints.length) {
      const price = chart.addSeries(LineSeries, {
        color: '#8394a3',
        lineWidth: 1,
        priceScaleId: 'left',
        priceLineVisible: false,
        lastValueVisible: false,
      });
      price.setData(
        spotPoints.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
      );
    }
    chart.timeScale().fitContent();
    ref.current.dataset.availableFrom = String(data[0].time);
    ref.current.dataset.availableTo = String(data.at(-1)!.time);
    chart.subscribeCrosshairMove((event) => setHoverTime(event.time ? Number(event.time) : null));
    return () => {
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
    };
  }, [data, spotPoints, metric, asset]);
  const latest = data.find((point) => point.time === hoverTime) ?? data.at(-1);
  function zoom(factor: number) {
    const range = chartRef.current?.timeScale().getVisibleLogicalRange();
    const next = range ? zoomChartRange(range, factor) : null;
    if (next) chartRef.current?.timeScale().setVisibleLogicalRange(next);
  }
  const unit = metric === 'open_interest' ? asset : '%';
  function csv() {
    const text =
      '\uFEFF' +
      [
        'asset,contract,metric,interval,time_utc,value,unit,source',
        ...data.map(
          (point) =>
            `${asset},${asset}USDT_PERPETUAL,${metric},${metric === 'funding' ? 'settlement' : interval},${new Date(point.time * 1000).toISOString()},${point.value},${unit},Bybit V5 public market data`,
        ),
      ].join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Coin-Desk-${asset}-${metric}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      id="derivatives"
      className="panel derivatives-panel"
      aria-label={`${asset} Bybit 선물 분석`}
    >
      <h2 className="derivatives-source">{asset} · Bybit USDT 무기한 선물</h2>
      <div className="derivatives-overview" role="group" aria-label={`${asset} 선물 지표 선택`}>
        <button
          className={metric === 'funding' ? 'selected' : ''}
          aria-pressed={metric === 'funding'}
          onClick={() => setMetric('funding')}
        >
          <span>펀딩비</span>
          <strong>
            {funding.data?.data.length ? numeric(funding.data.data.at(-1)!.value, 4) + '%' : '—'}
          </strong>
          <small>{dateLabel(funding.data?.meta.dataAsOf, true)}</small>
        </button>
        <button
          className={metric === 'open_interest' ? 'selected' : ''}
          aria-pressed={metric === 'open_interest'}
          onClick={() => setMetric('open_interest')}
        >
          <span>미결제약정</span>
          <strong>
            {interest.data?.data.length
              ? quantity(interest.data.data.at(-1)!.value) + ' ' + asset
              : '—'}
          </strong>
          <small>시간별 최신 · {dateLabel(interest.data?.meta.dataAsOf, true)}</small>
        </button>
        <button
          className={metric === 'long_account_ratio' ? 'selected' : ''}
          aria-pressed={metric === 'long_account_ratio'}
          onClick={() => setMetric('long_account_ratio')}
        >
          <span>롱 계정 비중</span>
          <strong>
            {longAccounts.data?.data.length
              ? numeric(longAccounts.data.data.at(-1)!.value, 2) + '%'
              : '—'}
          </strong>
          <small>시간별 최신 · {dateLabel(longAccounts.data?.meta.dataAsOf, true)}</small>
        </button>
      </div>
      <div className="derivatives-toolbar">
        {metric !== 'funding' && (
          <label>
            관측 간격{' '}
            <select
              aria-label="선물 관측 간격"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            >
              <option value="1d">일별 · 장기 이력</option>
              <option value="1h">시간별 · 최근 이력</option>
            </select>
          </label>
        )}
        <div className="segments" aria-label="선물 기간">
          {[
            [30, '1개월'],
            [90, '3개월'],
            [365, '1년'],
            [0, '전체'],
          ].map(([days, label]) => (
            <button
              key={days}
              aria-pressed={windowDays === days}
              className={windowDays === days ? 'selected' : ''}
              onClick={() => setWindowDays(Number(days))}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={showPrice}
            onChange={(event) => setShowPrice(event.target.checked)}
          />{' '}
          Binance 현물 가격 비교
        </label>
      </div>
      <div className="derivatives-latest">
        <strong>
          {latest
            ? metric === 'funding'
              ? numeric(latest.value, 4) + '%'
              : metric === 'open_interest'
                ? quantity(latest.value) + ' ' + asset
                : numeric(latest.value, 2) + '%'
            : '—'}
        </strong>
        <span>
          {hoverTime !== null ? '선택 관측 · ' : ''}
          {metric !== 'funding'
            ? interval === '1d'
              ? '일별 차트 · '
              : '시간별 차트 · '
            : hoverTime !== null
              ? '정산 이력 · '
              : '최근 정산 · '}
          {dateLabel(latest?.time, true)} ·{' '}
          {metric === 'funding'
            ? '정산 비율'
            : metric === 'open_interest'
              ? '미결제약정 수량'
              : '롱 보유 계정 비중'}
        </span>
      </div>
      {result.error ? (
        <p className="error-notice" role="alert">
          {result.error} <button onClick={result.reload}>다시 시도</button>
        </p>
      ) : null}
      {data.length ? (
        <div
          className="derivatives-chart"
          ref={ref}
          role="group"
          tabIndex={0}
          onKeyDown={(event) => {
            if (
              !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
              event.target !== event.currentTarget ||
              !data.length
            )
              return;
            event.preventDefault();
            const index = data.findIndex((point) => point.time === latest?.time);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? data.length - 1
                  : Math.max(
                      0,
                      Math.min(data.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)),
                    );
            const point = data[next];
            setHoverTime(point.time);
            setKeyboardNotice(
              dateLabel(point.time, true) +
                ' · ' +
                numeric(point.value, metric === 'funding' ? 4 : 2) +
                unit,
            );
            if (lineRef.current)
              chartRef.current?.setCrosshairPosition(
                point.value,
                point.time as UTCTimestamp,
                lineRef.current,
              );
          }}
          aria-label={`${asset} ${metric === 'funding' ? '펀딩비' : metric === 'open_interest' ? '미결제약정' : '롱 보유 계정 비율'} 이력`}
        />
      ) : (
        <div className="empty-state" role="status">
          {result.loading
            ? '선물 이력을 불러오고 있습니다…'
            : result.data?.meta.warning?.includes('연결에 실패')
              ? result.data.meta.warning
              : '원천 연결 또는 첫 자동 수집을 기다리고 있습니다.'}
        </div>
      )}
      <span className="sr-only" role="status">
        {keyboardNotice}
      </span>
      {data.length > 0 && (
        <ChartTools
          chart={chartRef}
          rows={data}
          label={asset + ' 선물'}
          unit={unit}
          source="Bybit"
          onExport={csv}
          exportLabel="선택 기간 CSV"
          onZoom={zoom}
          onReset={() => {
            setWindowDays(0);
            chartRef.current?.timeScale().fitContent();
          }}
        />
      )}
      <div className="coverage-strip">
        <span>
          실제 확보 {dateLabel(result.data?.meta.historyStart)}–
          {dateLabel(result.data?.meta.dataAsOf)} ·{' '}
          {result.data?.data.length.toLocaleString() ?? '0'}개 관측
          {result.data?.meta.sourceStatus === 'backfilling' ? ' · 과거 이력 추가 수집 중' : ''}
        </span>
        <span className={result.data?.meta.stale ? 'amber' : ''}>
          {result.data?.meta.stale ? '갱신 지연 · ' : ''}수집{' '}
          {dateLabel(result.data?.meta.fetchedAt, true)}
        </span>
      </div>
      {showPrice && (
        <p className="muted">
          회색선은 Binance 현물 일봉 종가(USDT)입니다. 선물 계약의 시장가격과 다른 자료이며 별도
          축으로 표시합니다. {spot.error ? '현물 가격 조회 지연' : ''}
        </p>
      )}
      <p className="muted">
        {result.data?.meta.warning ||
          (metric === 'long_account_ratio'
            ? '롱 포지션 보유 계정 수의 비중입니다. 포지션 규모 비중은 아닙니다.'
            : metric === 'open_interest'
              ? '미결제약정은 Bybit 한 거래소의 코인 수량입니다.'
              : '펀딩비는 정산 시각의 실제 비율입니다. 롱·숏 계정 비율과는 다른 지표입니다.')}
      </p>
    </section>
  );
}
