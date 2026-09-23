import { useData } from './hooks';
import { dateLabel, numeric } from './lib';
import type { Provenance } from '../shared/types';
import type { MempoolSnapshot } from '../worker/mempool';
import './analysis-expansion.css';

export function MempoolPanel() {
  const result = useData<{ data: MempoolSnapshot; meta: Provenance }>(
    '/api/v1/network-live?asset=BTC',
    false,
    300000,
  );
  const data = result.data?.data;
  return (
    <section className="panel mempool-panel">
      <div className="panel-title">
        <h2>BTC 네트워크 현황</h2>
        <small>mempool.space · 현재 스냅샷</small>
      </div>
      {data ? (
        <div className="relative-stats">
          <div>
            <small>미확인 거래</small>
            <b>{numeric(data.count, 0)}</b>
            <span>건</span>
          </div>
          <div>
            <small>대기 거래 규모</small>
            <b>{numeric(data.vsize / 1e6, 2)}</b>
            <span>백만 vB</span>
          </div>
          <div>
            <small>빠른 확인 권장</small>
            <b>{numeric(data.fastestFee, 0)}</b>
            <span>sat/vB</span>
          </div>
          <div>
            <small>약 1시간 권장</small>
            <b>{numeric(data.hourFee, 0)}</b>
            <span>sat/vB</span>
          </div>
        </div>
      ) : (
        <p className="empty-state">
          {result.loading ? 'BTC 네트워크를 불러오는 중…' : '첫 서버 수집을 기다리고 있습니다.'}
        </p>
      )}
      {result.error ? (
        <p role="alert">
          {result.error} <button onClick={result.reload}>다시 시도</button>
        </p>
      ) : null}
      <div className="coverage-strip">
        <span>
          관측·수집 {dateLabel(result.data?.meta.dataAsOf, true)} · 과거 이력 차트가 아닌 현재
          상태입니다.
        </span>
        <span className={result.data?.meta.stale ? 'amber' : ''}>
          {result.data?.meta.stale ? '갱신 지연 · 마지막 정상값' : '서버 자동 확인'}
        </span>
      </div>
    </section>
  );
}
