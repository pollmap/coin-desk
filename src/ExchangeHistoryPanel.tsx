import { useMemo } from 'react';
import type { Asset, Market, Period, CandleResponse } from '../shared/types';
import { closeHistory } from '../shared/price-history';
import { useData } from './hooks';
import { LongHistoryChart } from './LongHistoryChart';
import { PeriodPicker } from './PeriodPicker';
import { dateLabel } from './lib';

export function ExchangeHistoryPanel({
  asset,
  market,
  period,
  log,
  onPeriodChange,
  onLogChange,
}: {
  asset: Asset;
  market: Market;
  period: Period;
  log: boolean;
  onPeriodChange: (value: Period) => void;
  onLogChange: () => void;
}) {
  const result = useData<CandleResponse>(
    `/api/v1/candles?asset=${asset}&market=${market}&interval=1d&limit=1000`,
    true,
  );
  const series = useMemo(() => (result.data ? closeHistory(result.data) : null), [result.data]);
  const currency = market === 'upbit' ? 'KRW' : 'USDT';
  return (
    <section className="panel exchange-history-panel">
      <div className="history-toolbar">
        <div>
          <h2>전체 가격</h2>
          <small>
            {series?.data.length
              ? `${dateLabel(series.data[0].time)}부터 · 확정 일봉 종가`
              : '거래소 최초 이력부터'}
          </small>
          {['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'].includes(asset) ? (
            <a
              className="earliest-link"
              href="#reference-history"
              onClick={() => {
                const archive = document.getElementById(
                  'reference-history',
                ) as HTMLDetailsElement | null;
                if (archive) archive.open = true;
              }}
            >
              상장 전 최초 USD 이력 ↗
            </a>
          ) : null}
        </div>
        <PeriodPicker value={period} onChange={onPeriodChange} />
        <button
          className={'axis-control ' + (log ? 'active' : '')}
          aria-pressed={log}
          onClick={onLogChange}
        >
          가격축 · {log ? '로그' : '일반'}
        </button>
      </div>
      {result.error ? (
        <div role="status" className={series?.data.length ? 'refresh-notice' : 'error-notice'}>
          {series?.data.length
            ? '갱신이 지연되어 마지막 정상 차트를 표시합니다. 자동으로 다시 확인합니다.'
            : result.error}
          <button onClick={result.reload}>다시 시도</button>
        </div>
      ) : null}
      {series?.data.length ? (
        <LongHistoryChart
          series={series}
          asset={asset}
          currency={currency}
          period={period}
          log={log}
          onPeriodChange={onPeriodChange}
        />
      ) : (
        <div className={result.loading ? 'loading' : 'empty-state'} role="status">
          {result.loading
            ? '최초 거래일부터 가격을 불러오고 있습니다…'
            : '이 거래소의 가격 이력이 없습니다.'}
        </div>
      )}
    </section>
  );
}
