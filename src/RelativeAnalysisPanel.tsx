import { useEffect, useMemo, useRef, useState } from 'react';
import { LineSeries, type UTCTimestamp } from 'lightweight-charts';
import { createDeskChart } from './chart-theme';
import { relativeAnalysis } from '../shared/relative-analysis';
import type { Asset, SeriesResponse } from '../shared/types';
import { useData } from './hooks';
import { dateLabel, numeric } from './lib';
import './analysis-expansion.css';

export function RelativeAnalysisPanel({ asset }: { asset: 'DOGE' | 'ETH' }) {
  const selected = useData<SeriesResponse>(
    `/api/v1/reference?asset=${asset}&limit=1000`,
    true,
    900000,
  );
  const btc = useData<SeriesResponse>('/api/v1/reference?asset=BTC&limit=1000', true, 900000);
  const result = useMemo(
    () => (selected.data && btc.data ? relativeAnalysis(selected.data.data, btc.data.data) : null),
    [selected.data, btc.data],
  );
  const [mode, setMode] = useState<'relative' | 'ratio'>('relative');
  const surface = useRef<HTMLDivElement>(null);
  const points = mode === 'relative' ? result?.relative : result?.ratio;
  useEffect(() => {
    if (!surface.current || !points?.length) return;
    const chart = createDeskChart(surface.current, {
      autoSize: true,
      height: 260,
      layout: { attributionLogo: true },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const line = chart.addSeries(LineSeries, {
      color: '#55cbb8',
      lineWidth: 2,
      priceLineVisible: false,
    });
    line.setData(points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  const last = points?.at(-1)?.value;
  return (
    <section className="panel relative-panel">
      <div className="panel-title">
        <h2>{asset} / BTC 상대 분석</h2>
        <span>Coin Metrics PriceUSD · 동일 UTC 종가</span>
      </div>
      <p>
        두 자산의 USD 참조가격으로 계산합니다. 실제 거래소 {asset}/BTC 체결 가격이나 거래량은
        아닙니다.
      </p>
      <div className="relative-stats">
        <div>
          <small>BTC 대비 성과 지수</small>
          <b>{numeric(result?.relative.at(-1)?.value, 2)}</b>
          <span>공통 시작일 = 100</span>
        </div>
        <div>
          <small>고점 대비 낙폭</small>
          <b>{result?.drawdown == null ? '—' : `${numeric(result.drawdown, 1)}%`}</b>
          <span>{asset} USD 종가</span>
        </div>
        <div>
          <small>30일 수익률 상관</small>
          <b>{numeric(result?.correlation30, 2)}</b>
          <span>연속 UTC 일별 로그수익률</span>
        </div>
        <div>
          <small>90일 수익률 상관</small>
          <b>{numeric(result?.correlation90, 2)}</b>
          <span>연속 UTC 일별 로그수익률</span>
        </div>
      </div>
      <div className="segments" aria-label="상대 차트 선택">
        <button
          className={mode === 'relative' ? 'selected' : ''}
          aria-pressed={mode === 'relative'}
          onClick={() => setMode('relative')}
        >
          BTC 대비 성과
        </button>
        <button
          className={mode === 'ratio' ? 'selected' : ''}
          aria-pressed={mode === 'ratio'}
          onClick={() => setMode('ratio')}
        >
          {asset}/BTC 계산 비율
        </button>
      </div>
      {selected.error || btc.error ? (
        <p role="alert">참조가격 조회가 지연됩니다. 마지막 정상 관측만 사용합니다.</p>
      ) : null}
      {points?.length ? (
        <div
          ref={surface}
          className="relative-chart"
          role="img"
          aria-label={`${asset} BTC 대비 ${mode === 'relative' ? '성과' : '가격 비율'} 차트`}
        />
      ) : (
        <div className="loading">공통 날짜의 가격을 불러오고 있습니다…</div>
      )}
      <div className="coverage-strip">
        <span>
          공통 관측 {dateLabel(result?.first)}–{dateLabel(result?.last)} · 최신{' '}
          {last == null
            ? '—'
            : mode === 'ratio'
              ? last.toExponential(4) + ' BTC'
              : numeric(last, 2)}
        </span>
        <span>결측일 보간 없음</span>
      </div>
    </section>
  );
}
