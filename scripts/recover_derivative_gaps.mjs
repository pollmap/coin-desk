/** Explicit operator job, dry-run by default. No HTTP write route is added. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openSqlite } from '../server/sqlite.mjs';
import { createEnvironment } from '../server/environment.mjs';
import { recoverDerivativeGap } from '../server-dist/history-recovery.mjs';
const [database, matrix, output, option] = process.argv.slice(2);
if (!database || !matrix || !output || (option && option !== '--apply'))
  throw new Error('Pass database, coverage matrix, output and optional --apply');
if ([resolve(matrix), resolve(output)].includes(resolve(database)))
  throw new Error('Audit files must be separate from the DB');
const apply = option === '--apply';
process.env.COIN_DESK_DB = resolve(database);
const db = openSqlite(database, { readOnly: !apply });
const report = {
  startedAt: new Date().toISOString(),
  apply,
  rows: [],
  errors: [],
  collectorStateWritePolicy: 'This tool never writes recent success or historical cursors',
};
try {
  const env = await createEnvironment(db),
    input = JSON.parse(readFileSync(matrix, 'utf8'));
  const jobs = input.rows
    .filter((r) => r.kind === 'derivatives' && r.gaps?.length)
    .flatMap((r) =>
      r.gaps.map((g) => ({ asset: r.asset, metric: r.metric, from: g.from, to: g.to })),
    );
  if (jobs.length > 100) throw new Error('Recovery job limit exceeded');
  for (const job of jobs) {
    try {
      report.rows.push(
        await recoverDerivativeGap(env, job.asset, job.metric, job.from, job.to, apply),
      );
    } catch {
      report.errors.push({ ...job, code: 'SOURCE_OR_VALIDATION' });
    }
    writeFileSync(output, JSON.stringify(report, null, 2));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  report.completedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (report.errors.length) process.exitCode = 1;
} finally {
  db.sqlite.close();
}
