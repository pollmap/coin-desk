import type { ReportScope, ReportType } from '../../shared/report-types';
import { DAY, RESEARCH_VERSION, iso } from './core';
export interface ReportJob {
  key: string;
  revision: number;
  type: ReportType;
  scope: ReportScope;
  start: number;
  end: number;
  scheduledAt: number;
}
/** Daily 09:10 KST / Monday 09:20 KST, completed UTC windows. Catch up only latest due period. */
export function dueReportJobs(now: number): ReportJob[] {
  const midnight = Math.floor(now / DAY) * DAY;
  const dailyEnd = now >= midnight + 600 ? midnight : midnight - DAY;
  const weekday = new Date(midnight * 1000).getUTCDay();
  let monday = midnight - ((weekday + 6) % 7) * DAY;
  if (now < monday + 1200) monday -= 7 * DAY;
  const jobs: ReportJob[] = [];
  for (const scope of ['global', 'injective'] as const)
    for (const [type, end, length, delay] of [
      ['daily', dailyEnd, DAY, 600],
      ['weekly', monday, 7 * DAY, 1200],
    ] as const) {
      const start = end - length;
      jobs.push({
        key: [type, scope, start, end, RESEARCH_VERSION].join('|'),
        revision: 1,
        type,
        scope,
        start,
        end,
        scheduledAt: end + delay,
      });
    }
  return jobs.sort((a, b) => b.scheduledAt - a.scheduledAt || a.scope.localeCompare(b.scope));
}
export const reportId = (job: ReportJob) =>
  `${job.scope}-${job.type}-${iso(job.end).slice(0, 10)}-r${job.revision}`;
