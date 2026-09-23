import { NetworkInfoTabs } from './NetworkInfoTabs';
import { ThresholdMeter } from './ThresholdMeter';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import {
  isNetworkAsset,
  networkMetric,
  networkMetrics,
  networkUnit,
} from '../shared/network-catalog';
import { PERIOD_OPTIONS } from '../shared/ranges';
import type { Asset, Period, SeriesResponse } from '../shared/types';
import { useData } from './hooks';
import { dateLabel } from './lib';
import { PeriodPicker } from './PeriodPicker';
import { NetworkChart, networkValue } from './NetworkChart';
import { AssetLogo } from './AssetLogo';
import './network.css';

export function NetworkPage() {
  const route = useParams();
  const asset = (route.asset || 'DOGE').toUpperCase() as Asset;
  const coin = ASSETS.find((item) => item.id === asset);
  const [params, setParams] = useSearchParams();
  const requested = params.get('metric') || 'mvrv';
  const metric = networkMetric(asset, requested);
  const metrics = networkMetrics(asset);
  const selectedPeriod = params.get('period') || 'all';
  const period: Period = PERIOD_OPTIONS.some((item) => item.id === selectedPeriod)
    ? (selectedPeriod as Period)
    : 'all';
  const supported = isNetworkAsset(asset);
  const result = useData<SeriesResponse>(
    supported && metric ? `/api/v1/network?asset=${asset}&metric=${metric.id}&limit=1000` : null,
    true,
    900000,
  );
  const first = result.data?.data[0];
  const reference = useData<SeriesResponse>(
    supported && metric ? `/api/v1/reference?asset=${asset}&limit=1000` : null,
    true,
    900000,
  );
  const comparedSeries = useMemo(
    () => (result.data ? { ...result.data, price: reference.data?.data ?? [] } : undefined),
    [result.data, reference.data],
  );
  const latest = result.data?.data.at(-1);
  const unit = networkUnit(asset, requested);
  function change(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('period', period);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }
  if (!coin)
    return (
      <div className="empty-state">
        지원하지 않는 코인입니다. <Link to="/onchain/DOGE">DOGE 온체인으로</Link>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">NETWORK & ON-CHAIN</div>
          <h1>{coin.name} 온체인</h1>
          <p>네트워크 활동과 보유 가치의 변화를, 실제 제공되는 첫 관측일부터 살펴보세요.</p>
        </div>
        <Link className="desk-button" to={`/?asset=${asset}&period=all`}>
          {asset} 전체 가격 ↗
        </Link>
      </div>
      <nav className="asset-switcher" aria-label="온체인 코인 선택">
        {ASSETS.map((item) => (
          <Link
            key={item.id}
            aria-current={item.id === asset ? 'page' : undefined}
            className={item.id === asset ? 'selected' : ''}
            to={`/onchain/${item.id}?metric=${networkMetric(item.id, requested) ? requested : 'mvrv'}&period=${period}`}
          >
            <AssetLogo asset={item.id} size={19} />
            <b>{item.id}</b>
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>
      {!supported ? (
        <section className="panel network-unavailable">
          <h2>{asset} 무료 온체인 과거 이력 미제공</h2>
          <p>
            연결한 Coin Metrics Community 원천은 {asset}의 MVRV·주소·거래 수 과거 이력을 무료로
            제공하지 않습니다. 값이 없다는 뜻을 0으로 표시하지 않습니다.
          </p>
          <p>거래소가 제공하는 전체 일봉과 기술지표는 계속 사용할 수 있습니다.</p>
          <Link className="desk-button" to={`/chart/${asset}?period=all`}>
            전체 가격·기술지표 보기
          </Link>
          <a href="https://coverage.coinmetrics.io/" target="_blank" rel="noreferrer">
            원천 제공 범위 ↗
          </a>
        </section>
      ) : (
        <>
          <details className="panel network-picker" aria-label="온체인 지표 선택">
            <summary>
              지표 변경 · {metric?.title || requested} <span>{metrics.length}개 지표</span>
            </summary>
            <div>
              <h2>보고 싶은 지표</h2>
              <span>{metrics.length}개 지표 · Coin Metrics</span>
            </div>
            <div className="network-metrics">
              {metrics.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={item.id === requested}
                  className={item.id === requested ? 'selected' : ''}
                  onClick={() => change('metric', item.id)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </details>
          {!metric ? (
            <div className="error-notice" role="alert">
              {asset}에서 지원하지 않는 지표입니다.
              <button onClick={() => change('metric', 'mvrv')}>MVRV 보기</button>
            </div>
          ) : (
            <>
              <section className="panel network-main">
                <div className="metric-detail-top">
                  <div>
                    <h2>
                      {asset} · {metric.title}
                    </h2>
                    <strong>{networkValue(latest?.value, unit)}</strong>
                    <span>
                      {latest
                        ? `${dateLabel(latest.time)} UTC 관측일`
                        : result.loading
                          ? '전체 이력 불러오는 중'
                          : '관측 없음'}
                    </span>
                    {result.data?.meta.sourceStatus ? (
                      <span>원천 관측 상태: {result.data.meta.sourceStatus}</span>
                    ) : null}
                  </div>
                  <PeriodPicker value={period} onChange={(value) => change('period', value)} />
                </div>
                <ThresholdMeter id={'network_' + metric.id} value={latest?.value} unit={unit} />
                <div className="network-coverage" aria-label="온체인 실제 제공 범위">
                  <div>
                    <span>제공 시작일</span>
                    <b>{dateLabel(first?.time)}</b>
                  </div>
                  <div>
                    <span>최신 관측일</span>
                    <b>{dateLabel(latest?.time)}</b>
                  </div>
                  <div>
                    <span>확보한 일별 관측</span>
                    <b>{result.data?.data.length.toLocaleString() ?? '—'}개</b>
                  </div>
                </div>
                {result.error ? (
                  <div className="error-notice" role="alert">
                    {result.error}
                    <button onClick={result.reload}>다시 불러오기</button>
                  </div>
                ) : null}
                {result.data?.data.length ? (
                  <NetworkChart
                    series={comparedSeries!}
                    asset={asset}
                    metric={metric.id}
                    title={metric.title}
                    unit={unit}
                    period={period}
                    onPeriodChange={(value) => change('period', value)}
                  />
                ) : result.loading ? (
                  <div className="loading" role="status">
                    원천이 제공하는 전체 날짜를 불러오고 있습니다…
                  </div>
                ) : (
                  <div className="empty-state">
                    아직 표시할 관측이 없습니다. <Link to="/status">수집 상태 확인</Link>
                  </div>
                )}
                <div className="coverage-strip">
                  <span>
                    가격 비교: Coin Metrics USD 참조가격{' '}
                    {reference.error
                      ? '· 조회 실패'
                      : reference.data?.meta.stale
                        ? '· 갱신 지연'
                        : ''}{' '}
                    · {dateLabel(reference.data?.data.at(-1)?.time)}
                    {reference.error && (
                      <button onClick={reference.reload}>가격 다시 불러오기</button>
                    )}
                  </span>
                  <span>
                    {metric.derived
                      ? '동일 원천에서 역산한 파생값'
                      : `원천 지표 · ${metric.sourceMetric}`}{' '}
                    · {unit}
                  </span>
                  <span className={result.data?.meta.stale ? 'amber' : ''}>
                    {result.data?.meta.stale ? '갱신 지연 · ' : ''}마지막 수집{' '}
                    {dateLabel(result.data?.meta.fetchedAt, true)}
                  </span>
                </div>
                {result.data?.meta.warning ? (
                  <p className="network-note amber" role="status">
                    {result.data.meta.warning}
                  </p>
                ) : null}
              </section>
              <NetworkInfoTabs
                key={asset + metric.id}
                asset={asset}
                metric={metric}
                series={result.data}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
