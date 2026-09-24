import { NetworkInfoTabs } from './NetworkInfoTabs';
import { useMemo, useRef, useState } from 'react';
import { AssetHeader } from './AssetHeader';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import {
  isNetworkAsset,
  networkMetric,
  networkMetrics,
  networkUnit,
  NETWORK_GROUPS,
} from '../shared/network-catalog';
import { PERIOD_OPTIONS } from '../shared/ranges';
import type { Asset, Period, SeriesResponse } from '../shared/types';
import { useData } from './hooks';
import { dateLabel } from './lib';
import { PeriodPicker } from './PeriodPicker';
import { NetworkChart } from './NetworkChart';
import './network.css';

export function NetworkPage() {
  const route = useParams();
  const asset = (route.asset || 'DOGE').toUpperCase() as Asset;
  const coin = ASSETS.find((item) => item.id === asset);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const picker = useRef<HTMLDetailsElement>(null);
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
    if (key === 'metric' && picker.current) {
      picker.current.open = false;
      picker.current.querySelector('summary')?.focus();
      setQuery('');
    }
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
      <AssetHeader
        asset={asset}
        current="onchain"
        subtitle="온체인 · Coin Metrics 일별 관측"
        assets={ASSETS.filter((item) => item.id === asset || isNetworkAsset(item.id)).map(
          (item) => item.id,
        )}
        href={(next) =>
          `/onchain/${next}?metric=${networkMetric(next, requested) ? requested : 'mvrv'}&period=all`
        }
      />
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
          <div className="network-selector-row">
            <details
              onKeyDown={(event) => {
                if (event.key === 'Escape' && picker.current) {
                  picker.current.open = false;
                  picker.current.querySelector('summary')?.focus();
                }
              }}
              ref={picker}
              className="panel network-picker"
              aria-label="온체인 지표 선택"
            >
              <summary>
                지표 변경 · {metric?.title || requested} <span>{metrics.length}개 지표</span>
              </summary>
              <input
                className="metric-filter"
                aria-label="이 코인의 온체인 지표 검색"
                placeholder="지표 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {NETWORK_GROUPS.map((group) => {
                const items = metrics.filter(
                  (item) =>
                    group.ids.includes(item.id) &&
                    (item.title + item.id).toLowerCase().includes(query.trim().toLowerCase()),
                );
                return items.length ? (
                  <section className="network-metric-group" key={group.title}>
                    <h3>{group.title}</h3>
                    <div className="network-metrics">
                      {items.map((item) => (
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
                  </section>
                ) : null;
              })}
              {!metrics.some((item) =>
                (item.title + item.id).toLowerCase().includes(query.trim().toLowerCase()),
              ) && <p role="status">일치하는 지표가 없습니다.</p>}
            </details>
            <PeriodPicker value={period} onChange={(value) => change('period', value)} />
          </div>
          {!metric ? (
            <div className="error-notice" role="alert">
              {asset}에서 지원하지 않는 지표입니다.
              <button onClick={() => change('metric', 'mvrv')}>MVRV 보기</button>
            </div>
          ) : (
            <>
              <section className="panel network-main">
                <h2 className="sr-only">
                  {asset} · {metric.title}
                </h2>
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
              <details className="network-explanation">
                <summary>{metric.title} 읽는 방법 · 산식 · 출처</summary>
                <NetworkInfoTabs
                  key={asset + metric.id}
                  asset={asset}
                  metric={metric}
                  series={result.data}
                />
              </details>
            </>
          )}
        </>
      )}
    </>
  );
}
