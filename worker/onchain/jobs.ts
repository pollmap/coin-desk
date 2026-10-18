import type { PublishedReport } from '../../shared/report-types';
import type { ReportJob } from './schedule';
import { iso } from './core';
export interface ReportClaim {
  job: ReportJob;
  owner: string;
  generation: number;
}
export async function claimReport(
  db: D1Database,
  job: ReportJob,
  owner: string,
  now: number,
): Promise<ReportClaim | null> {
  const result = await db
    .prepare(
      `INSERT INTO onchain_report_runs(job_key,revision,kind,scope,period_start,period_end,scheduled_at,status,attempts,owner,generation,lease_until,heartbeat_at,started_at)
    VALUES(?,?,?,?,?,?,?,'running',1,?,1,?,?,?) ON CONFLICT(job_key,revision) DO UPDATE SET
    status='running',attempts=attempts+1,owner=excluded.owner,generation=generation+1,lease_until=excluded.lease_until,heartbeat_at=excluded.heartbeat_at,started_at=excluded.started_at
    WHERE onchain_report_runs.status NOT IN ('succeeded','partial') AND onchain_report_runs.attempts<3 AND onchain_report_runs.next_attempt<=? AND onchain_report_runs.lease_until<=?`,
    )
    .bind(
      job.key,
      job.revision,
      job.type,
      job.scope,
      job.start,
      job.end,
      job.scheduledAt,
      owner,
      now + 180,
      now,
      now,
      now,
      now,
    )
    .run();
  if (!result.meta.changes) return null;
  const row = await db
    .prepare('SELECT generation,owner FROM onchain_report_runs WHERE job_key=? AND revision=?')
    .bind(job.key, job.revision)
    .first<{ generation: number; owner: string }>();
  return row?.owner === owner ? { job, owner, generation: row.generation } : null;
}
export async function renewReport(db: D1Database, claim: ReportClaim, now: number) {
  const result = await db
    .prepare(
      "UPDATE onchain_report_runs SET lease_until=?,heartbeat_at=? WHERE job_key=? AND revision=? AND owner=? AND generation=? AND status='running' AND lease_until>=?",
    )
    .bind(now + 180, now, claim.job.key, claim.job.revision, claim.owner, claim.generation, now)
    .run();
  return result.meta.changes > 0;
}
export async function failReport(db: D1Database, claim: ReportClaim, now: number, code: string) {
  await db
    .prepare(
      "UPDATE onchain_report_runs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'retry_wait' END,next_attempt=?,lease_until=0,error_code=?,completed_at=? WHERE job_key=? AND revision=? AND owner=? AND generation=? AND status='running'",
    )
    .bind(now + 300, code, now, claim.job.key, claim.job.revision, claim.owner, claim.generation)
    .run();
}
export async function publishReport(
  db: D1Database,
  claim: ReportClaim,
  report: PublishedReport,
  now: number,
) {
  if (
    report.revision !== claim.job.revision ||
    report.scopeId !== claim.job.scope ||
    report.reportType !== claim.job.type ||
    report.periodStart !== iso(claim.job.start) ||
    report.periodEnd !== iso(claim.job.end)
  )
    throw new Error('INVALID_REPORT_CLAIM');
  if (
    report.supersedesReportId &&
    !(await db
      .prepare(
        'SELECT 1 FROM onchain_reports WHERE id=? AND publication_key=? AND revision<? AND superseded_by IS NULL',
      )
      .bind(report.supersedesReportId, claim.job.key, report.revision)
      .first())
  )
    throw new Error('INVALID_REPORT_REVISION');
  const guard =
    "EXISTS(SELECT 1 FROM onchain_report_runs WHERE job_key=? AND revision=? AND owner=? AND generation=? AND status='running' AND lease_until>=?)";
  const args = [claim.job.key, claim.job.revision, claim.owner, claim.generation, now];
  const writes = [
    db
      .prepare(
        `INSERT INTO onchain_reports(id,publication_key,revision,type,scope,period_start,period_end,published_at,quality,body,evidence_hash)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(
        report.reportId,
        claim.job.key,
        report.revision,
        report.reportType,
        report.scopeId,
        claim.job.start,
        claim.job.end,
        now,
        report.dataQuality,
        JSON.stringify(report),
        report.evidenceHash,
        ...args,
      ),
  ];
  writes.push(
    db
      .prepare(
        `INSERT INTO onchain_report_evidence(report_id,evidence_id,payload)
    SELECT ?,json_extract(value,'$.id'),value FROM json_each(?) WHERE ${guard}`,
      )
      .bind(report.reportId, JSON.stringify(report.evidence), ...args),
  );
  if (report.supersedesReportId)
    writes.push(
      db
        .prepare(
          `UPDATE onchain_reports SET superseded_by=? WHERE id=? AND publication_key=? AND revision<? AND superseded_by IS NULL AND ${guard}`,
        )
        .bind(report.reportId, report.supersedesReportId, claim.job.key, report.revision, ...args),
    );
  writes.push(
    db
      .prepare(
        `UPDATE onchain_report_runs SET status=?,report_id=?,completed_at=?,lease_until=0,error_code=NULL WHERE job_key=? AND revision=? AND owner=? AND generation=? AND status='running' AND lease_until>=?`,
      )
      .bind(
        report.dataQuality === 'complete' ? 'succeeded' : 'partial',
        report.reportId,
        now,
        ...args,
      ),
  );
  const result = await db.batch(writes);
  if (!result[0].meta.changes) throw new Error('REPORT_LEASE_LOST');
}
