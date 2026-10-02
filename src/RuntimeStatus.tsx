import { useData } from './hooks';
import { dateLabel } from './lib';

interface RuntimeReport {
  kind: 'vps';
  scheduler: { lane: string; healthy: boolean; reason: string | null; completed_at?: number }[];
  backup: { ok: boolean; verified?: boolean; lastCompletedAt?: number };
}
const names: Record<string, string> = {
  quotes: '현재가',
  background: '봉·온체인',
  recent: '최근 선물',
  analysis: '분석·브리핑',
};
const reasons: Record<string, string> = {
  no_execution_ledger: '실행 기록 없음',
  not_started: '시작 대기',
  running: '실행 중',
  error: '작업 실패',
  execution_delayed: '실행 지연',
  skipped_overlap: '이전 작업 처리 중',
};
export function RuntimeStatus() {
  const { data, error, reload } = useData<RuntimeReport>('/api/v1/runtime', false, 60000);
  return (
    <section className="automation-summary" aria-label="VPS 수집·백업 실행 기록">
      <div className="automation-state">
        <h2>수집·백업 실행 기록</h2>
        <button className="desk-button" onClick={reload}>
          실행 기록 확인
        </button>
      </div>
      <p>
        수집 작업의 실행과 원천 데이터의 최신 여부는 다릅니다. 관측 시각은 아래 원천 상태에서
        확인하세요.
      </p>
      {error ? (
        <p role="alert" className="amber">
          실행 기록을 가져오지 못했습니다. 다시 확인해 주세요.
        </p>
      ) : !data ? (
        <p>실행 기록을 확인하고 있습니다.</p>
      ) : (
        <>
          <dl className="automation-facts">
            {Object.entries(names).map(([lane, label]) => {
              const record = data.scheduler.find((row) => row.lane === lane);
              return (
                <div key={lane}>
                  <dt>{label}</dt>
                  <dd>
                    <span className={record?.healthy ? 'server-ok' : 'amber'}>
                      {record?.healthy
                        ? '최근 실행 완료'
                        : (reasons[record?.reason ?? ''] ?? '실행 확인 필요')}
                    </span>
                    <br />
                    {dateLabel(record?.completed_at, true)}
                  </dd>
                </div>
              );
            })}
            <div>
              <dt>백업·복원 검사</dt>
              <dd>
                <span className={data.backup.ok ? 'server-ok' : 'amber'}>
                  {data.backup.ok
                    ? '최근 백업 복원 확인'
                    : data.backup.verified
                      ? '검증된 백업의 갱신 확인 필요'
                      : '검증된 백업 없음'}
                </span>
                <br />
                {dateLabel(data.backup.lastCompletedAt, true)}
              </dd>
            </div>
          </dl>
          <p>
            백업은 같은 서버에 보관합니다. 서버 전체 장애에 대비한 외부 백업은 아직 연결하지
            않았습니다.
          </p>
        </>
      )}
    </section>
  );
}
