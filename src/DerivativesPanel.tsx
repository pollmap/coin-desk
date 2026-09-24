import { useEffect, useMemo, useRef, useState } from 'react';
import { LineSeries, type UTCTimestamp } from 'lightweight-charts';
import { createDeskChart } from './chart-theme';
import type { CandleResponse, SeriesResponse } from '../shared/types';
import { useData } from './hooks';
import { dateLabel, numeric } from './lib';
import './analysis-expansion.css';

type Featured = 'BTC' | 'DOGE' | 'ETH';
type Metric = 'funding' | 'open_interest' | 'long_account_ratio';
const DAY = 86400;

export function DerivativesPanel({ asset }: { asset: Featured }) {
  const [metric, setMetric] = useState<Metric>('funding');
  const [windowDays, setWindowDays] = useState(0);
  const [showPrice, setShowPrice] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const funding = useData<SeriesResponse>(
    `/api/v1/derivatives?asset=${asset}&metric=funding&limit=1000`, true, 3600000,
  );
  const interest = useData<SeriesResponse>(
    `/api/v1/derivatives?asset=${asset}&metric=open_interest&limit=1000`, true, 3600000,
  );
  const longAccounts = useData<SeriesResponse>(
    `/api/v1/derivatives?asset=${asset}&metric=long_account_ratio&limit=1000`, true, 3600000,
  );
  const result = metric === 'funding' ? funding : metric === 'open_interest' ? interest : longAccounts;
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
      height: 300,
      layout: { attributionLogo: true },
      rightPriceScale: { borderVisible: false },
      leftPriceScale: { visible: spotPoints.length > 0, borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const line = chart.addSeries(LineSeries, {
      color: metric === 'funding' ? '#6bd7bb' : metric === 'open_interest' ? '#a9a4f0' : '#e8ad65',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: {
        type: 'custom',
        formatter: (value: number) =>
          metric === 'funding' ? numeric(value, 4) + '%' : metric === 'open_interest' ? numeric(value, 3) + ' ' + asset : numeric(value, 2) + '%',
      },
    });
    line.setData(data.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
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
    return () => chart.remove();
  }, [data, spotPoints, metric]);
  const latest = result.data?.data.at(-1);
  const unit = metric === 'open_interest' ? asset : '%';
  function csv() {
    const text =
      '\uFEFF' +
      [
        'asset,contract,metric,time_utc,value,unit,source',
        ...data.map(
          (point) =>
            `${asset},${asset}USDT_PERPETUAL,${metric},${new Date(point.time * 1000).toISOString()},${point.value},${unit},Bybit V5 public market data`,
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
      <div className="panel-title">
        <h2>{asset} · Bybit USDT 무기한 선물</h2>
        <small>실제 확보한 첫 관측부터 · 한 거래소</small>
      </div>
      <div className="derivatives-overview" role="group" aria-label={`${asset} 선물 지표 선택`}>
        <button className={metric === 'funding' ? 'selected' : ''} aria-pressed={metric === 'funding'} onClick={() => setMetric('funding')}>
          <span>펀딩비</span><strong>{funding.data?.data.length ? numeric(funding.data.data.at(-1)!.value, 4) + '%' : '—'}</strong>
          <small>{dateLabel(funding.data?.meta.dataAsOf, true)}</small>
        </button>
        <button className={metric === 'open_interest' ? 'selected' : ''} aria-pressed={metric === 'open_interest'} onClick={() => setMetric('open_interest')}>
          <span>미결제약정</span><strong>{interest.data?.data.length ? numeric(interest.data.data.at(-1)!.value, 3) + ' ' + asset : '—'}</strong>
          <small>{dateLabel(interest.data?.meta.dataAsOf, true)}</small>
        </button>
        <button className={metric === 'long_account_ratio' ? 'selected' : ''} aria-pressed={metric === 'long_account_ratio'} onClick={() => setMetric('long_account_ratio')}>
          <span>롱 보유 계정</span><strong>{longAccounts.data?.data.length ? numeric(longAccounts.data.data.at(-1)!.value, 2) + '%' : '—'}</strong>
          <small>{dateLabel(longAccounts.data?.meta.dataAsOf, true)}</small>
        </button>
      </div>
      <div className="derivatives-toolbar">
        <div className="segments" aria-label="선물 기간">
          {[
            [30, '1개월'],
            [90, '3개월'],
            [365, '1년'],
            [0, '전체 확보'],
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
        <button className="desk-button" disabled={!data.length} onClick={csv}>
          CSV
        </button>
      </div>
      <div className="derivatives-latest">
        <strong>
          {latest
            ? metric === 'funding'
              ? numeric(latest.value, 4) + '%'
              : metric === 'open_interest' ? numeric(latest.value, 3) + ' ' + asset : numeric(latest.value, 2) + '%'
            : '—'}
        </strong>
        <span>
          {dateLabel(latest?.time, true)} 관측 ·{' '}
          {metric === 'funding' ? '정산 비율' : metric === 'open_interest' ? '미결제약정 수량' : '롱 보유 계정 비중'}
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
          role="img"
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
      <div className="coverage-strip">
        <span>
          실제 확보 {dateLabel(result.data?.meta.historyStart)}–
          {dateLabel(result.data?.meta.dataAsOf)} ·{' '}
          {result.data?.data.length.toLocaleString() ?? '0'}개 관측
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
            ? '미결제약정은 Bybit 한 거래소의 코인 수량이며 최근 30일을 먼저 확보합니다.'
            : '펀딩비는 정산 시각의 실제 비율입니다. 롱·숏 계정 비율과는 다른 지표입니다.')}
      </p>
    </section>
  );
}
