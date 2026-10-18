import type {
  PublishedReport,
  ReportSummary,
  ReportsResponse,
  ReportScope,
  ResearchState,
  ResearchCoverage,
  ResearchMarket,
} from '../../shared/report-types';

export class ResearchReadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const REPORT_SCHEDULE = {
  timezone: 'Asia/Seoul',
  daily: '09:10',
  weekly: '월요일 09:20',
} as const;
const allowed = (q: URLSearchParams, keys: string[]) => {
  for (const key of q.keys())
    if (!keys.includes(key) || q.getAll(key).length !== 1)
      throw new ResearchReadError('Invalid report query');
};
const selection = (q: URLSearchParams, key: string, values: string[], fallback?: string) => {
  const value = q.get(key) ?? fallback;
  if (value !== undefined && !values.includes(value)) throw new ResearchReadError('Invalid ' + key);
  return value;
};
const integer = (q: URLSearchParams, key: string, fallback: number, max: number) => {
  const text = q.get(key);
  if (text !== null && !/^\d{1,12}$/.test(text)) throw new ResearchReadError('Invalid ' + key);
  const value = text === null ? fallback : Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new ResearchReadError('Invalid ' + key);
  return value;
};
export async function researchSchemaReady(db: D1Database) {
  return !!(await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='onchain_reports'")
    .first());
}
async function state(db: D1Database, hasData = false): Promise<ResearchState> {
  if (hasData) return 'ready';
  const runtime = await db
    .prepare(
      "SELECT checkpoint FROM onchain_provider_state WHERE provider='runtime' AND scope='research'",
    )
    .first<{ checkpoint: string | null }>();
  if (!runtime?.checkpoint) return 'pending';
  return JSON.parse(runtime.checkpoint).enabled === false ? 'disabled' : 'pending';
}
export function reportSummary(
  report: PublishedReport,
  supersededBy: string | null = null,
): ReportSummary {
  return {
    reportId: report.reportId,
    reportType: report.reportType,
    scopeId: report.scopeId,
    title: report.title,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    publishedAt: report.publishedAt,
    revision: report.revision,
    publicationStatus: supersededBy ? 'superseded' : 'published',
    dataQuality: report.dataQuality,
    highlights: report.highlights,
  };
}
export async function listReports(db: D1Database, q: URLSearchParams): Promise<ReportsResponse> {
  allowed(q, ['type', 'scope', 'cursor', 'limit']);
  const type = selection(q, 'type', ['daily', 'weekly']),
    scope = selection(q, 'scope', ['global', 'injective']);
  const limit = integer(q, 'limit', 20, 50);
  if (!limit) throw new ResearchReadError('Invalid limit');
  const cursor = q.get('cursor');
  let at = Number.MAX_SAFE_INTEGER,
    id = '';
  if (cursor) {
    const match = /^(\d{1,12})\|([a-z0-9_-]{1,160})$/.exec(cursor);
    if (!match) throw new ResearchReadError('Invalid cursor');
    at = Number(match[1]);
    id = match[2];
  }
  if (!(await researchSchemaReady(db)))
    return { data: [], nextCursor: null, status: 'disabled', schedule: REPORT_SCHEDULE };
  const rows = (
    await db
      .prepare(
        `SELECT id,published_at,body,superseded_by FROM onchain_reports
    WHERE superseded_by IS NULL AND (? IS NULL OR type=?) AND (? IS NULL OR scope=?)
    AND (published_at<? OR (published_at=? AND id>?)) ORDER BY published_at DESC,id LIMIT ?`,
      )
      .bind(type ?? null, type ?? null, scope ?? null, scope ?? null, at, at, id, limit + 1)
      .all<{ id: string; published_at: number; body: string; superseded_by: string | null }>()
  ).results;
  const page = rows.slice(0, limit),
    last = page.at(-1);
  return {
    data: page.map((r) => reportSummary(JSON.parse(r.body), r.superseded_by)),
    nextCursor: rows.length > limit && last ? `${last.published_at}|${last.id}` : null,
    status: await state(db, page.length > 0),
    schedule: REPORT_SCHEDULE,
  };
}
export async function latestReport(db: D1Database, q: URLSearchParams) {
  allowed(q, ['type', 'scope']);
  const normalized = new URLSearchParams(q);
  normalized.set('limit', '1');
  const result = await listReports(db, normalized);
  return { data: result.data[0] ?? null, status: result.status };
}
export async function reportDetail(db: D1Database, id: string) {
  if (!/^[a-z0-9_-]{1,160}$/.test(id)) throw new ResearchReadError('Invalid report ID');
  if (!(await researchSchemaReady(db)))
    throw new ResearchReadError('보고서를 찾을 수 없습니다.', 404);
  const row = await db
    .prepare('SELECT body,superseded_by FROM onchain_reports WHERE id=?')
    .bind(id)
    .first<{ body: string; superseded_by: string | null }>();
  if (!row) throw new ResearchReadError('보고서를 찾을 수 없습니다.', 404);
  const report = JSON.parse(row.body) as PublishedReport;
  return {
    data: {
      ...report,
      publicationStatus: row.superseded_by ? 'superseded' : 'published',
      supersededByReportId: row.superseded_by,
    } as PublishedReport,
  };
}
export async function researchMarkets(db: D1Database, q: URLSearchParams) {
  allowed(q, ['kind', 'limit', 'cursor']);
  const kind = selection(q, 'kind', ['spot', 'perpetual', 'expiry_future', 'other_derivative']);
  const limit = integer(q, 'limit', 30, 100);
  if (!limit) throw new ResearchReadError('Invalid limit');
  const cursor = q.get('cursor') ?? '';
  if (cursor && !/^0x[0-9a-f]{64}$/.test(cursor)) throw new ResearchReadError('Invalid cursor');
  if (!(await researchSchemaReady(db))) return { data: [], nextCursor: null, status: 'disabled' };
  const rows = (
    await db
      .prepare(
        "SELECT id,payload FROM onchain_markets WHERE json_extract(payload,'$.status')='active' AND (? IS NULL OR kind=?) AND id>? ORDER BY id LIMIT ?",
      )
      .bind(kind ?? null, kind ?? null, cursor, limit + 1)
      .all<{ id: string; payload: string }>()
  ).results;
  return {
    data: rows.slice(0, limit).map((r) => JSON.parse(r.payload) as ResearchMarket),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    status: await state(db, rows.length > 0),
  };
}
export async function researchCoverage(
  db: D1Database,
  q: URLSearchParams,
): Promise<ResearchCoverage> {
  allowed(q, ['scope']);
  const scope = selection(q, 'scope', ['global', 'injective'], 'global') as ReportScope;
  if (!(await researchSchemaReady(db)))
    return { scope, state: 'disabled', providers: [], marketCount: 0, series: [] };
  const providers = (
    await db
      .prepare(
        "SELECT provider,scope,last_success,data_as_of,error_code FROM onchain_provider_state WHERE provider NOT IN ('runtime','collector') AND (scope=? OR scope='both') ORDER BY provider,scope LIMIT 30",
      )
      .bind(scope)
      .all<{
        provider: string;
        scope: string;
        last_success: number | null;
        data_as_of: number | null;
        error_code: string | null;
      }>()
  ).results;
  const series = (
    await db
      .prepare(
        'SELECT entity_id,metric,unit,MIN(observed_at) first,MAX(observed_at) last,COUNT(*) n FROM onchain_observations WHERE scope=? GROUP BY entity_id,metric,unit ORDER BY entity_id,metric LIMIT 200',
      )
      .bind(scope)
      .all<{
        entity_id: string;
        metric: string;
        unit: string;
        first: number;
        last: number;
        n: number;
      }>()
  ).results;
  const time = (n: number | null) => (n === null ? null : new Date(n * 1000).toISOString());
  const marketCount =
    (await db
      .prepare(
        "SELECT COUNT(*) n FROM onchain_markets WHERE json_extract(payload,'$.status')='active'",
      )
      .first<number>('n')) ?? 0;
  return {
    scope,
    state: await state(db, series.length > 0),
    providers: providers.map((r) => ({
      provider: r.provider,
      scope: r.scope,
      lastSuccess: time(r.last_success),
      dataAsOf: time(r.data_as_of),
      errorCode: r.error_code,
    })),
    marketCount,
    series: series.map((r) => ({
      entityId: r.entity_id,
      metric: r.metric,
      unit: r.unit,
      first: time(r.first)!,
      last: time(r.last)!,
      observations: r.n,
    })),
  };
}
export async function researchSeries(db: D1Database, q: URLSearchParams) {
  allowed(q, ['scope', 'entity', 'metric', 'from', 'to', 'limit', 'cursor']);
  const scope = selection(q, 'scope', ['global', 'injective'], 'global');
  const entity = q.get('entity') ?? '',
    metric = q.get('metric') ?? '';
  if (!/^[A-Za-z0-9:_-]{1,100}$/.test(entity) || !/^[a-z][a-z0-9_]{1,60}$/.test(metric))
    throw new ResearchReadError('Invalid series');
  const to = integer(q, 'to', Math.floor(Date.now() / 1000) + 1, 9999999999),
    from = integer(q, 'from', Math.max(0, to - 100 * 86400), 9999999999),
    limit = integer(q, 'limit', 500, 2000);
  if (!limit || to <= from || to - from > 366 * 86400) throw new ResearchReadError('Invalid range');
  let after = from - 1,
    afterId = '';
  const cursor = q.get('cursor');
  if (cursor) {
    const match = /^(\d{1,12})\|(obs-[0-9a-f]{32})$/.exec(cursor);
    if (!match) throw new ResearchReadError('Invalid cursor');
    after = Number(match[1]);
    afterId = match[2];
    if (after < from || after >= to) throw new ResearchReadError('Invalid cursor range');
  }
  if (!(await researchSchemaReady(db))) return { data: [], nextCursor: null, status: 'disabled' };
  const rows = (
    await db
      .prepare(
        'SELECT payload,observed_at,id FROM onchain_observations WHERE scope=? AND entity_id=? AND metric=? AND observed_at>=? AND observed_at<? AND (observed_at>? OR (observed_at=? AND id>?)) ORDER BY observed_at,id LIMIT ?',
      )
      .bind(scope, entity, metric, from, to, after, after, afterId, limit + 1)
      .all<{ payload: string; observed_at: number; id: string }>()
  ).results;
  // Provider and unit stay on each point; callers must not concatenate distinct definitions.
  const page = rows.slice(0, limit),
    last = page.at(-1);
  return {
    data: page.map((r) => JSON.parse(r.payload)),
    nextCursor: rows.length > limit && last ? `${last.observed_at}|${last.id}` : null,
    status: await state(db, page.length > 0),
  };
}
