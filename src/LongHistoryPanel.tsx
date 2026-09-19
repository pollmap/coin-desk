import type { Asset, Period, SeriesResponse } from '../shared/types';
import { ASSETS } from '../shared/catalog';
import { useData } from './hooks';
import { dateLabel, money } from './lib';
import { PeriodPicker } from './PeriodPicker';
import { LongHistoryChart } from './LongHistoryChart';
export function LongHistoryPanel({
  asset,
  period,
  log,
  onPeriodChange,
  onLogChange,
}: {
  asset: Asset;
  period: Period;
  log: boolean;
  onPeriodChange: (p: Period) => void;
  onLogChange: () => void;
}) {
  const result = useData<SeriesResponse>(
    '/api/v1/reference?asset=' + asset + '&limit=1000',
    true,
    900000,
  );
  const latest = result.data?.data.at(-1),
    first = result.data?.data[0];
  return (
    <section className="panel detail-panel long-history-panel">
      <div className="metric-detail-top">
        <div>
          <h2>{ASSETS.find((a) => a.id === asset)?.name} · 전체 가격 흐름</h2>
          <strong>{money(latest?.value, 'USD')}</strong>
          <span>{dateLabel(latest?.time)} 일별 종가 · USD</span>
        </div>
        <div className="long-period-actions">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <button
            className={'text-button ' + (log ? 'active' : '')}
            aria-pressed={log}
            onClick={onLogChange}
          >
            로그축
          </button>
        </div>
      </div>
      <p className="history-origin">
        {first
          ? `${dateLabel(first.time)}부터 ${dateLabel(latest?.time)}까지 · ${result.data!.data.length.toLocaleString()}일`
          : '초기 USD 가격 이력을 불러오고 있습니다.'}{' '}
        · Coin Metrics 참조가격
      </p>
      {result.error ? (
        <div role="alert" className="error-notice">
          {result.error}
          <button onClick={result.reload}>다시 시도</button>
        </div>
      ) : null}
      {result.data?.data.length ? (
        <LongHistoryChart
          series={result.data}
          asset={asset}
          period={period}
          log={log}
          onPeriodChange={onPeriodChange}
        />
      ) : result.loading ? (
        <div className="loading" role="status">
          장기 가격 이력을 확인하고 있습니다…
        </div>
      ) : (
        <div className="empty-state">
          표시할 장기 가격이 없습니다. 수집 상태를 확인하거나 다시 시도해 주세요.
          <button className="desk-button" onClick={result.reload}>
            다시 시도
          </button>
        </div>
      )}
      <div className="coverage-strip">
        <span>USD 일별 참조가격입니다. 거래소 캔들·거래량과 구분합니다.</span>
        <span className={result.data?.meta.stale ? 'amber' : ''}>
          {result.data?.meta.stale ? '갱신 지연 · ' : ''}수집{' '}
          {dateLabel(result.data?.meta.fetchedAt, true)}
        </span>
      </div>
      <div className="coverage-strip">
        <a
          href="https://docs.coinmetrics.io/network-data/network-data-overview/market/price"
          target="_blank"
          rel="noreferrer"
        >
          Coin Metrics · PriceUSD 정의 ↗
        </a>
        <a
          href="https://github.com/coinmetrics/data/blob/master/LICENSE"
          target="_blank"
          rel="noreferrer"
        >
          CC BY-NC 4.0 · 비상업 이용
        </a>
      </div>
    </section>
  );
}
