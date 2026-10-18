import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  LatestReportResponse,
  PublishedReport,
  ReportDetailResponse,
  ReportEvidence,
  ReportFact,
  ReportScope,
  ReportSection,
  ReportSummary,
  ReportsResponse,
  ReportType,
} from '../shared/report-types';
import { useData } from './hooks';
import './reports.css';

const scopes: Record<ReportScope, string> = { global: '전체 시장', injective: 'Injective' };
const types: Record<ReportType, string> = { daily: '일간', weekly: '주간' };
const REFRESH = 5 * 60 * 1000;

const DisplayDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN });
/** Round only for reading; the exact stored decimal remains in the evidence panel. */
function valueLabel(fact: Pick<ReportFact, 'value' | 'unit'>, exact = false) {
  if (fact.value === null) return '—';
  let display: string,
    suffix = '';
  try {
    let number = new DisplayDecimal(fact.value);
    if (!number.isFinite()) return '—';
    const currency = ['USD', 'USDT', 'USDC', 'KRW'].includes(fact.unit);
    if (!exact && currency) {
      const scale = number.abs().gte('1e12')
        ? ['1e12', '조']
        : number.abs().gte('1e8')
          ? ['1e8', '억']
          : number.abs().gte('1e4')
            ? ['1e4', '만']
            : null;
      if (scale) {
        number = number.div(scale[0]);
        suffix = scale[1];
      }
    }
    const decimals =
      fact.unit === '%'
        ? 2
        : currency && number.abs().lt(1) && !number.isZero()
          ? Math.min(8, Math.max(2, 2 - number.e))
          : 2;
    display = exact
      ? number.toFixed()
      : !number.isZero() && number.abs().lt('1e-8')
        ? number.toSignificantDigits(3).toString()
        : number.toDecimalPlaces(decimals).toFixed();
  } catch {
    return '—';
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(display);
  const fraction = match?.[3]?.replace(/0+$/, '');
  const value = match
    ? match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '')
    : display;
  return value + suffix + (fact.unit ? ' ' + fact.unit : '');
}

function evidenceLabel(evidence: ReportEvidence, report: PublishedReport) {
  const metrics: Record<string, string> = {
    market_cap: '시가총액',
    volume_24h: '24시간 거래대금',
    btc_share: 'BTC 비중',
    eth_share: 'ETH 비중',
    price: '가격',
    fdv: '완전희석가치',
    circulating_supply: '유통량',
    total_supply: '총공급량',
    max_supply: '최대 공급량',
    tvl: 'TVL',
    taker_notional: '관측 taker 거래대금',
    observed_taker_notional: '관측 taker 체결 거래대금',
    dex_spot_volume: '현물 DEX 거래대금',
    last_trade_price: '마지막 체결가',
    active_spot_markets: '활성 현물 시장',
    active_derivative_markets: '활성 파생 시장',
    spread_bps: '호가 간격',
    open_interest: '미결제약정',
  };
  const entities: Record<string, string> = {
    global: '전체 시장',
    'chain:injective': 'Injective',
    'chain:ethereum': 'Ethereum',
    'chain:solana': 'Solana',
  };
  const row = report.sections
    .flatMap((section) => (section.kind === 'table' ? section.rows : []))
    .find((row) => row.facts.some((fact) => fact.evidenceIds.includes(evidence.id)));
  const entity =
    entities[evidence.entityId] ??
    (evidence.entityType === 'market' ? (row?.label ?? 'Injective 시장') : evidence.entityId);
  return entity + ' · ' + (metrics[evidence.metric] ?? evidence.metric);
}

function periodLabel(start: string, end: string) {
  const from = new Date(start),
    to = new Date(end);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return '';
  const format = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return format.format(from) + ' – ' + format.format(to) + ' KST';
}

function internalHref(value?: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null;
  try {
    const url = new URL(value, 'https://bori.invalid');
    return url.origin === 'https://bori.invalid' &&
      /^\/(?:coins(?:\/[^/]+)?|compare|learn(?:\/[^/]+)?|reports(?:\/[^/]+)?)$/.test(url.pathname)
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}

function externalHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function ReportPeriod({ report }: { report: ReportSummary }) {
  return <p className="report-period">{periodLabel(report.periodStart, report.periodEnd)}</p>;
}

function EmptyReport({ failed, retry }: { failed?: boolean; retry?: () => void }) {
  return (
    <div className="reports-empty" role={failed ? 'alert' : 'status'}>
      <p>{failed ? '보고서를 불러오지 못했습니다.' : '아직 발행된 보고서가 없습니다.'}</p>
      {failed && retry && <button onClick={retry}>다시 시도</button>}
      <Link to="/">시장으로</Link>
    </div>
  );
}

function ReportsList() {
  const [params, setParams] = useSearchParams();
  const scope: ReportScope = params.get('scope') === 'injective' ? 'injective' : 'global';
  const type: ReportType = params.get('type') === 'weekly' ? 'weekly' : 'daily';
  const cursor = params.get('cursor');
  const query = new URLSearchParams({ scope, type, limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const result = useData<ReportsResponse>('/api/v1/reports?' + query, false, REFRESH);
  const entries = result.data?.data ?? [];
  const base = new URLSearchParams({ scope, type });
  const change = (key: 'scope' | 'type', value: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      next.delete('cursor');
      return next;
    });
  };
  return (
    <section className="reports-page" aria-labelledby="reports-title">
      <header className="reports-heading">
        <h1 id="reports-title" tabIndex={-1} data-route-focus>
          시장 보고서
        </h1>
        {entries.length > 0 && <Link to={'/reports/latest?' + base}>최신 보고서</Link>}
      </header>
      <div className="reports-filters">
        <div className="reports-scope" role="group" aria-label="보고서 범위">
          {(Object.entries(scopes) as [ReportScope, string][]).map(([id, title]) => (
            <button key={id} aria-pressed={scope === id} onClick={() => change('scope', id)}>
              {title}
            </button>
          ))}
        </div>
        <label>
          기간
          <select
            aria-label="보고서 주기"
            value={type}
            onChange={(event) => change('type', event.target.value)}
          >
            <option value="daily">일간</option>
            <option value="weekly">주간</option>
          </select>
        </label>
      </div>
      {result.loading && !result.data ? (
        <p className="reports-loading" role="status">
          보고서를 불러오는 중…
        </p>
      ) : null}
      {result.error ? <EmptyReport failed retry={result.reload} /> : null}
      {!result.loading && !result.error && !entries.length ? <EmptyReport /> : null}
      {entries.length > 0 && (
        <ol className="reports-list" aria-label="발행된 보고서">
          {entries.map((report) => (
            <li key={report.reportId}>
              <Link to={'/reports/' + encodeURIComponent(report.reportId) + '?' + base}>
                <div className="report-list-labels">
                  <span>
                    {scopes[report.scopeId]} · {types[report.reportType]}
                  </span>
                  {report.dataQuality === 'partial' && <span>일부 항목 제외</span>}
                </div>
                <h2>{report.title}</h2>
                <ReportPeriod report={report} />
              </Link>
            </li>
          ))}
        </ol>
      )}
      {(cursor || result.data?.nextCursor) && !result.error && (
        <nav className="reports-pagination" aria-label="보고서 페이지">
          {cursor && <Link to={'/reports?' + base}>처음으로</Link>}
          {result.data?.nextCursor && (
            <Link
              to={
                '/reports?' + new URLSearchParams({ scope, type, cursor: result.data.nextCursor })
              }
            >
              이전 보고서
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}

function Fact({ fact }: { fact: ReportFact }) {
  const href = internalHref(fact.href);
  return (
    <div className="report-fact">
      <dt>{href ? <Link to={href}>{fact.label}</Link> : fact.label}</dt>
      <dd>
        {valueLabel(fact)}
        {fact.note && <small>{fact.note}</small>}
      </dd>
    </div>
  );
}

function Section({ section }: { section: ReportSection }) {
  if (section.kind === 'note')
    return (
      <section className="report-section">
        <h2>{section.title}</h2>
        <p>{section.text}</p>
      </section>
    );
  if (section.kind === 'facts')
    return (
      <section className="report-section">
        <h2>{section.title}</h2>
        <dl className="report-facts">
          {section.items.map((fact, index) => (
            <Fact key={index} fact={fact} />
          ))}
        </dl>
      </section>
    );
  const columns = [...new Set(section.rows.flatMap((row) => row.facts.map((fact) => fact.label)))];
  return (
    <section className="report-section">
      <h2>{section.title}</h2>
      <div
        className="report-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={section.title + ' 표'}
      >
        <table className="report-table">
          <caption className="sr-only">{section.title}</caption>
          <thead>
            <tr>
              <th scope="col">대상</th>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, index) => {
              const href = internalHref(row.href);
              return (
                <tr key={index}>
                  <th scope="row">{href ? <Link to={href}>{row.label}</Link> : row.label}</th>
                  {columns.map((column) => {
                    const fact = row.facts.find((candidate) => candidate.label === column);
                    return (
                      <td key={column}>
                        {fact ? valueLabel(fact) : '—'}
                        {fact?.note && <small>{fact.note}</small>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportContents({ report }: { report: PublishedReport }) {
  useEffect(() => {
    document.title = report.title + ' | 보리차트';
  }, [report.title]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      // Focus and the entry position must settle together when returning from a chart.
      // The shell's later frame must not briefly leave the focused heading off screen.
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById('report-title')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [report.reportId]);
  const params = new URLSearchParams({ scope: report.scopeId, type: report.reportType });
  const newer = report.supersededByReportId;
  return (
    <article className="reports-page report-detail" aria-labelledby="report-title">
      <Link className="report-back" to={'/reports?' + params}>
        보고서 목록
      </Link>
      <header className="report-heading">
        <p className="report-category">
          {scopes[report.scopeId]} · {types[report.reportType]}
          {report.revision > 1 ? ' · 정정본' : ''}
        </p>
        <h1 id="report-title" tabIndex={-1} data-route-focus>
          {report.title}
        </h1>
        <ReportPeriod report={report} />
      </header>
      {newer ? (
        <p className="report-correction" role="status">
          내용이 정정되었습니다.{' '}
          <Link to={'/reports/' + encodeURIComponent(newer)}>정정된 보고서 보기</Link>
        </p>
      ) : null}
      {report.highlights.length > 0 && (
        <ul className="report-highlights" aria-label="주요 변화">
          {report.highlights.slice(0, 3).map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {report.dataQuality === 'partial' && (
        <aside className="report-coverage" aria-label="비교 범위">
          {report.coverageNotes.length ? (
            report.coverageNotes.map((note, index) => <p key={index}>{note}</p>)
          ) : (
            <p>비교에 필요한 자료가 없는 항목은 제외했습니다.</p>
          )}
        </aside>
      )}
      {report.sections.map((section, index) => (
        <Section key={index} section={section} />
      ))}
      <Link
        className="report-chart-link"
        to={report.scopeId === 'injective' ? '/coins/INJ' : '/coins/BTC'}
      >
        {report.scopeId === 'injective' ? 'INJ' : 'BTC'} 차트 보기
      </Link>
      <details
        className="report-evidence"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}
      >
        <summary
          onFocus={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (box.bottom > window.innerHeight - 90 || box.top < 76)
              event.currentTarget.scrollIntoView({ block: 'center' });
          }}
        >
          근거 보기
        </summary>
        {report.evidence.length ? (
          <ol>
            {report.evidence.map((evidence) => {
              const href = externalHref(evidence.sourceUrl);
              return (
                <li key={evidence.id}>
                  <strong>{evidenceLabel(evidence, report)}</strong>
                  <p>{valueLabel(evidence, true)}</p>
                  <p>{evidence.scope}</p>
                  {evidence.periodStart && evidence.periodEnd && (
                    <p>{periodLabel(evidence.periodStart, evidence.periodEnd)}</p>
                  )}
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {evidence.source} 원문
                    </a>
                  ) : (
                    <span>{evidence.source}</span>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p>이 보고서에 연결된 근거가 없습니다.</p>
        )}
      </details>
    </article>
  );
}

function ReportDetail({ reportId }: { reportId: string }) {
  const [missingId, setMissingId] = useState<string | null>(null);
  const result = useData<ReportDetailResponse>(
    missingId === reportId ? null : '/api/v1/reports/' + encodeURIComponent(reportId),
    false,
    REFRESH,
  );
  useEffect(() => {
    if (result.errorCode === 'NOT_FOUND') setMissingId(reportId);
  }, [reportId, result.errorCode]);
  if (missingId === reportId)
    return (
      <section className="reports-page">
        <h1>보고서를 찾을 수 없습니다.</h1>
        <Link className="report-back" to="/reports">
          보고서 목록
        </Link>
      </section>
    );
  if (result.data) return <ReportContents report={result.data.data} />;
  return (
    <section className="reports-page">
      <Link className="report-back" to="/reports">
        보고서 목록
      </Link>
      {result.error ? (
        <EmptyReport failed retry={result.reload} />
      ) : (
        <p role="status">보고서를 불러오는 중…</p>
      )}
    </section>
  );
}

function LatestReport() {
  const [params] = useSearchParams();
  const query = new URLSearchParams({
    scope: params.get('scope') === 'injective' ? 'injective' : 'global',
    type: params.get('type') === 'weekly' ? 'weekly' : 'daily',
  });
  const result = useData<LatestReportResponse>('/api/v1/reports/latest?' + query, false, REFRESH);
  if (result.data?.data)
    return (
      <Navigate
        replace
        to={'/reports/' + encodeURIComponent(result.data.data.reportId) + '?' + query}
      />
    );
  return (
    <section className="reports-page">
      <Link className="report-back" to={'/reports?' + query}>
        보고서 목록
      </Link>
      {result.loading ? (
        <p role="status">최신 보고서를 불러오는 중…</p>
      ) : (
        <EmptyReport failed={!!result.error} retry={result.reload} />
      )}
    </section>
  );
}

export default function ReportsPage() {
  const { reportId } = useParams();
  if (reportId === 'latest') return <LatestReport />;
  return reportId ? <ReportDetail reportId={reportId} /> : <ReportsList />;
}
