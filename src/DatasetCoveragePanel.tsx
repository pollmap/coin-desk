import { useEffect, useState } from 'react';
import type { Asset } from '../shared/types';
import type { DatasetCoverage } from '../shared/dataset-coverage';
import { dateLabel, json } from './lib';
export function DatasetCoveragePanel({ asset }: { asset: Asset }) {
  const [state, setState] = useState<{ asset: Asset; data?: DatasetCoverage; error?: string }>({
    asset,
  });
  useEffect(() => {
    const controller = new AbortController();
    setState({ asset });
    json<DatasetCoverage>('/api/v1/coverage?asset=' + asset, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ asset, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ asset, error: e.message });
      });
    return () => controller.abort();
  }, [asset]);
  if (state.asset !== asset || (!state.data && !state.error))
    return <p role="status">데이터 기간을 확인하는 중…</p>;
  if (state.error) return <p role="alert">{state.error}</p>;
  return (
    <section className="dataset-coverage" aria-label={asset + ' 데이터 기간과 공백'}>
      <h3>데이터 기간</h3>
      <p>{state.data!.warning}</p>
      <div className="dataset-coverage-table">
        <table>
          <thead>
            <tr>
              <th>원천·지표</th>
              <th>첫 관측</th>
              <th>최근 관측</th>
              <th>관측 수</th>
              <th>관측 공백</th>
            </tr>
          </thead>
          <tbody>
            {state.data!.sources.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.source} · {s.title}
                  <small>
                    {s.unit} · {s.cadence}
                    {s.status === 'collection-error' ? ' · 최근 수집 실패' : ''}
                  </small>
                </td>
                <td>{dateLabel(s.first)}</td>
                <td>{dateLabel(s.last)}</td>
                <td>{s.observations.toLocaleString()}</td>
                <td>
                  {s.gaps.slots === null ? (
                    '정산별 확인'
                  ) : s.gaps.slots === 0 ? (
                    '0'
                  ) : (
                    <>
                      {s.gaps.slots} · 원천 없음 {s.gaps.checkedMissingSlots ?? 0}
                      {(s.gaps.checkedMissingSlots ?? 0) < s.gaps.slots && (
                        <small>미확인 {s.gaps.slots - (s.gaps.checkedMissingSlots ?? 0)}</small>
                      )}
                      {s.gaps.evidence?.[0] && (
                        <small>
                          <a href={s.gaps.evidence[0].url} target="_blank" rel="noreferrer">
                            원천 확인
                          </a>{' '}
                          · {dateLabel(s.gaps.evidence[0].checkedAt)}
                        </small>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.data!.quoteStates.map((s) => (
        <p key={s.source}>
          {s.source} ·{' '}
          {s.condition === 'old-trade'
            ? '최근 거래가 오래됨'
            : s.condition === 'collection-error'
              ? '최근 시세 확인 실패'
              : s.condition === 'unknown-trade-time'
                ? '체결 시각 미확인'
                : s.condition === 'pending'
                  ? '시세 수집 대기'
                  : '최근 거래 확인'}{' '}
          {s.tradedAt ? ` · 실제 체결 ${dateLabel(s.tradedAt, true)}` : ''}
        </p>
      ))}
    </section>
  );
}
