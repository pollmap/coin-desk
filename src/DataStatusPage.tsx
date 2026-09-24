import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { operationStatus } from '../worker/health';
import { useData } from './hooks';
import { dateLabel } from './lib';
import './data-status.css';
type OperationStatus = Awaited<ReturnType<typeof operationStatus>>;
const statusName: Record<string, string> = {
  ok: '정상',
  delayed: '지연',
  missing: '수집 대기',
  error: '재시도',
  inactive: '사용 안 함',
};
const priorityRank = (key: string) =>
  key === 'automation'
    ? -1
    : key.includes('BTC') || key === 'bitview'
    ? 0
    : key.includes('DOGE')
      ? 1
      : key.includes('ETH')
        ? 2
        : ['coinlore', 'defillama', 'maintenance'].includes(key)
          ? 3
          : 4;
function ago(seconds: number | null | undefined) {
  return seconds == null
    ? '미확인'
    : seconds < 60
      ? '1분 이내'
      : seconds < 3600
        ? Math.floor(seconds / 60) + '분 전'
        : seconds < 86400
          ? Math.floor(seconds / 3600) + '시간 전'
          : Math.floor(seconds / 86400) + '일 전';
}
export function sourceLabel(key: string) {
  if (key === 'bitview') return 'BTC 온체인 · Bitview';
  if (key === 'coinlore') return '코인 시가총액 · CoinLore';
  if (key === 'defillama') return '스테이블코인 · DefiLlama';
  if (key === 'maintenance') return '이력 정리';
  if (key === 'mempool:BTC') return 'BTC 수수료·미확인 거래 · mempool.space';
  if (key.startsWith('derivatives:')) {
    const [, asset, metric] = key.split(':');
    return asset + ' · Bybit ' + (metric === 'funding' ? '펀딩비' : '미결제약정');
  }
  if (key.startsWith('network:')) return key.split(':')[1] + ' 온체인 · Coin Metrics';
  if (key.startsWith('reference:')) return key.split(':')[1] + ' 장기 USD · Coin Metrics';
  if (key.startsWith('quote:')) {
    const [, asset, market] = key.split(':');
    return asset + ' · ' + (market === 'binance' ? 'Binance' : 'Upbit') + ' 현재가';
  }
  if (key.startsWith('quotes:')) {
    const [, market, batch] = key.split(':');
    return (market === 'binance' ? 'Binance' : 'Upbit') + ' 시세 묶음 ' + (Number(batch) + 1);
  }
  const [asset, market, interval] = key.split(':');
  return market
    ? asset +
        ' · ' +
        (market === 'binance' ? 'Binance' : 'Upbit') +
        ' ' +
        (interval === '1h' ? '시간봉' : '일봉')
    : key;
}
export function AutomationSummary({ compact = false }: { compact?: boolean }) {
  const { data, error, reload } = useData<OperationStatus>('/api/v1/status', false, 60000);
  const a = data?.automation;
  return (
    <div className="automation-summary">
      <div className="automation-state">
        <b>서버 자동 갱신</b>
        <span className={!a || a.stalled ? 'amber' : 'server-ok'}>
          {a ? (a.stalled ? '실행 확인 필요' : '서버 실행 확인') : '상태 확인 중'}
        </span>
      </div>
      <p>
        {a?.stalled
          ? '현재 서버 실행을 확인하지 못했습니다. 표시 중인 데이터의 실제 시각을 확인해 주세요.'
          : '사이트를 닫아도 Cloudflare 서버에서 수집을 실행합니다.'}
      </p>
      {error ? (
        <p role="alert" className="amber">
          {error}
          <button onClick={reload}>다시 확인</button>
        </p>
      ) : null}
      <dl className="automation-facts">
        <div>
          <dt>마지막 서버 실행</dt>
          <dd>{dateLabel(a?.lastStartedAt, true)}</dd>
        </div>
        <div>
          <dt>마지막 완료 작업</dt>
          <dd>{a?.lastJob ? sourceLabel(a.lastJob) : '확인 대기'}</dd>
        </div>
        <div>
          <dt>데이터 원천 상태</dt>
          <dd>
            {data?.coverage
              ? `${data.coverage.healthySources} / ${data.coverage.expectedSources} 정상`
              : '확인 대기'}
          </dd>
        </div>
        {!compact && (
          <div>
            <dt>48시간 자동 수집 관찰</dt>
            <dd>
              {a?.observation48h.ready
                ? `${a.observation48h.ticks}회 기록 · 실패 ${a.observation48h.failures}회`
                : `${a?.observation48h.ticks ?? 0}회 기록 · 관찰 기간 누적 중`}
            </dd>
          </div>
        )}
      </dl>
      {compact ? (
        <Link className="desk-button" to="/status">
          전체 수집 상태·제공 기간 확인 ↗
        </Link>
      ) : null}
    </div>
  );
}
export function DataStatusPage() {
  const { data, error, reload } = useData<OperationStatus>('/api/v1/status', false, 60000);
  const [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [coreOnly, setCoreOnly] = useState(true);
  const active = data?.sources.filter((s) => s.active) ?? [];
  const matchingRows = active.filter(
    (s) =>
      (filter === 'all' ||
        (filter === 'attention'
          ? s.status !== 'ok'
          : filter === 'quotes'
            ? s.key.startsWith('quote:')
            : filter === 'history'
              ? /:(1d|1h)$/.test(s.key)
              : !s.key.startsWith('quote:') && !/:(1d|1h)$/.test(s.key))) &&
      sourceLabel(s.key).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const rows = matchingRows
    .filter((s) => !coreOnly || priorityRank(s.key) < 4)
    .sort((a, b) => priorityRank(a.key) - priorityRank(b.key));
  const importantIssues = (data?.health.reasons ?? [])
    .filter((r) => priorityRank(r.key) < 4 || r.key === 'automation')
    .sort((a, b) => priorityRank(a.key) - priorityRank(b.key));
  const extraIssues = (data?.health.reasons ?? []).filter(
    (r) => !importantIssues.some((item) => item.key === r.key && item.code === r.code),
  );
  const a = data?.automation;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DATA & AUTOMATION</div>
          <h1>데이터·자동 갱신</h1>
          <p>서버가 언제 실행됐는지, 어떤 기간의 자료가 실제로 있는지 확인하세요.</p>
        </div>
        <button className="desk-button" onClick={reload}>
          상태 다시 확인
        </button>
      </div>
      {error ? (
        <div className="error-notice" role="alert">
          {error}
        </div>
      ) : null}
      <AutomationSummary />
      {data?.health && !data.health.ok ? (
        <div className="server-issues" role="status">
          <h2>확인이 필요한 원천 {data.health.reasons.length}개</h2>
          <ul>
            {importantIssues.slice(0, 5).map((r, i) => (
              <li key={r.code + r.key + i}>
                <b>{sourceLabel(r.key)}</b> · {r.message}
              </li>
            ))}
          </ul>
          {importantIssues.length > 5 || extraIssues.length ? (
            <details>
              <summary>나머지 {Math.max(0, importantIssues.length - 5) + extraIssues.length}개 보기</summary>
              <ul>
                {[...importantIssues.slice(5), ...extraIssues].map((r, i) => (
                  <li key={r.code + r.key + i}>
                    <b>{sourceLabel(r.key)}</b> · {r.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <section className="panel server-schedule">
        <h2>서버 수집 주기</h2>
        <details>
          <summary>목표 주기와 운영 기준</summary>
          <div className="schedule-grid">
            <div>
              <b>매분 작업 확인</b>
              <p>대기 작업을 하나씩 처리하고, 중단된 작업은 잠금 만료 뒤 다시 예약합니다.</p>
            </div>
            <div>
              <b>BTC · DOGE · ETH 시세 · 1분</b>
              <p>핵심 3개 코인은 1분, 보조 코인은 5분마다 서버 갱신을 시도합니다.</p>
            </div>
            <div>
              <b>봉·온체인 · 정기 수집</b>
              <p>시간봉·BTC 온체인은 약 1시간, 일봉·장기 USD·스테이블코인은 약 6시간입니다.</p>
            </div>
          </div>
          <p className="watch-note">
            목표 주기는 성공 보장이 아닙니다. 실제 자료 시각과 마지막 수집 시각은 위 상태표에서
            확인하세요.
          </p>
        </details>
      </section>
      <div className="status-filters">
        <label>
          원천 검색
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="DOGE, 장기 USD, Bitview…"
          />
        </label>
        <label>
          종류
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">전체</option>
            <option value="attention">확인 필요</option>
            <option value="quotes">현재가</option>
            <option value="history">거래소 이력</option>
            <option value="other">온체인·장기 USD·시장 비중</option>
          </select>
        </label>
        <label className="status-scope">
          <input
            type="checkbox"
            checked={coreOnly}
            onChange={(e) => setCoreOnly(e.target.checked)}
          />
          BTC · DOGE · ETH 우선
        </label>
        <span>
          {rows.length}개 표시{coreOnly ? ` · 전체 ${matchingRows.length}개` : ''}
        </span>
      </div>
      <section
        className="panel status-table-wrap"
        tabIndex={0}
        aria-label="원천 상태 표, 좁은 화면에서는 가로로 이동할 수 있습니다"
      >
        <table className="status-table">
          <thead>
            <tr>
              <th scope="col">원천</th>
              <th scope="col">수집 상태</th>
              <th scope="col">실제 자료 시각</th>
              <th scope="col">마지막 정상 수집</th>
              <th scope="col">저장 범위·재시도</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key}>
                <th scope="row">
                  {sourceLabel(s.key)}
                  <small>
                    {s.expectedCadenceSeconds ? '목표 ' + s.expectedCadenceSeconds / 60 + '분' : ''}
                  </small>
                </th>
                <td className={s.status === 'ok' ? 'server-ok' : 'amber'}>
                  {statusName[s.status] || s.status}
                  {s.liveStale ? <small>현재 시세는 5분 이상 경과</small> : null}
                </td>
                <td>
                  {dateLabel(s.data_as_of, true)}
                  <small>{ago(s.dataAgeSeconds)}</small>
                </td>
                <td>
                  {dateLabel(s.last_success, true)}
                  <small>{ago(s.collectorAgeSeconds)}</small>
                </td>
                <td>
                  {s.coverage ? (
                    <>
                      {dateLabel(s.coverage.first)} ~<br />
                      {dateLabel(s.coverage.last)}
                      <small>
                        {s.coverage.rows === null
                          ? '행 수 별도 집계 안 함'
                          : s.coverage.rows.toLocaleString() + '개'}
                      </small>
                    </>
                  ) : s.key.startsWith('reference:') ? (
                    <Link to={'/?asset=' + s.key.split(':')[1] + '&period=all'}>
                      전체 USD 이력 보기 ↗
                    </Link>
                  ) : s.status === 'ok' ? (
                    '갱신 대기'
                  ) : (
                    '확인 중'
                  )}
                  {s.retryAt ? (
                    <small className="amber">재시도 {dateLabel(s.retryAt, true)}</small>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !rows.length ? (
          <div className="empty-state">해당 조건의 원천이 없습니다.</div>
        ) : null}
      </section>
      <section className="panel server-runs">
        <h2>최근 서버 실행 기록</h2>
        <p>자동 실행의 DB 기록입니다. PC에서 조회한 시각을 서버 실행 시각으로 대신하지 않습니다.</p>
        <ol>
          {a?.recentRuns.map((r) => (
            <li key={r.runId}>
              <span>{dateLabel(r.startedAt, true)}</span>
              <b>{r.job ? sourceLabel(r.job) : '대기 작업 확인'}</b>
              <span className={r.outcome === 'error' ? 'amber' : ''}>
                {(
                  {
                    success: '완료',
                    ok: '완료',
                    partial: '일부 실패·재시도 예정',
                    interrupted: '중단 후 재예약',
                    error: '실패·재시도 예정',
                    idle: '대기',
                    running: '실행 중',
                    abandoned: '중단 후 회복',
                  } as Record<string, string>
                )[r.outcome] || r.outcome}
              </span>
              {r.error ? <small>{r.error}</small> : null}
            </li>
          ))}
        </ol>
        {!a?.recentRuns.length ? <p>저장된 서버 실행 기록을 기다리고 있습니다.</p> : null}
      </section>
      <div className="onchain-note">
        <span>
          거래소 캔들은 각 거래소 상장 이후, Coin Metrics 장기 USD는 최초 유효 가격 이후, 도미넌스는
          실제 수집을 시작한 시점 이후입니다. 없는 구간을 생성하거나 서로 다른 가격을 이어 붙이지
          않습니다.
        </span>
      </div>
    </>
  );
}
