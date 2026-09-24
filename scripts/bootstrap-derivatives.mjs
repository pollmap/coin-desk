import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { openDatabase } from './local-db.mjs';

// Retains raw pages and cursors locally. Only the two daily metrics are exported.
const server = await createServer({ server: { middlewareMode: true } });
const DB = openDatabase('work/derivatives-history.sqlite');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const { updateDerivatives } = await server.ssrLoadModule('/worker/derivatives.ts');
  for (const asset of ['BTC', 'DOGE', 'ETH']) {
    for (const metric of ['open_interest_daily', 'long_account_ratio_daily']) {
      const cursorKey = 'cursor:derivatives:' + asset + ':' + metric;
      for (let page = 0; page < 40; page++) {
        for (let attempt = 0; ; attempt++) {
          try {
            await updateDerivatives({ DB }, asset, metric);
            break;
          } catch (error) {
            if (attempt >= 3) throw error;
            await sleep(2000 * 2 ** attempt);
          }
        }
        const extent = DB.sqlite
          .prepare(
            'SELECT COUNT(*) n,MIN(time) first,MAX(time) last FROM derivative_series WHERE asset=? AND metric=?',
          )
          .get(asset, metric);
        console.log(asset, metric, page + 1, JSON.stringify(extent));
        if (!DB.sqlite.prepare('SELECT value FROM state WHERE key=?').get(cursorKey)) break;
        if (page === 39) throw new Error('History page cap reached');
        await sleep(300);
      }
    }
  }
  const rows = DB.sqlite
    .prepare(
      "SELECT * FROM derivative_series WHERE metric IN ('open_interest_daily','long_account_ratio_daily') ORDER BY asset,metric,time",
    )
    .all();
  const sql = rows.map((row) => {
    if (
      !['BTC', 'DOGE', 'ETH'].includes(row.asset) ||
      !Number.isFinite(row.value) ||
      !Number.isSafeInteger(row.time)
    )
      throw new Error('Invalid export');
    return `INSERT INTO derivative_series(asset,metric,time,value,fetched_at) VALUES('${row.asset}','${row.metric}',${row.time},${row.value},${row.fetched_at}) ON CONFLICT(asset,metric,time) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at;`;
  });
  for (const row of DB.sqlite.prepare('SELECT * FROM ingestion').all()) {
    if (
      !/^derivatives:(BTC|DOGE|ETH):(open_interest_daily|long_account_ratio_daily)$/.test(row.key)
    )
      throw new Error('Unexpected ingestion key');
    sql.push(
      `INSERT INTO ingestion(key,last_attempt,last_success,data_as_of,failures,error,next_attempt) VALUES('${row.key}',${row.last_attempt},${row.last_success},${row.data_as_of},0,NULL,0) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,data_as_of=excluded.data_as_of,failures=0,error=NULL,next_attempt=0;`,
    );
    sql.push(`DELETE FROM state WHERE key='cursor:${row.key}';`);
  }
  writeFileSync('work/derivatives-history.sql', sql.join('\n'));
  const summary = DB.sqlite
    .prepare(
      'SELECT asset,metric,COUNT(*) points,MIN(time) first,MAX(time) last FROM derivative_series GROUP BY asset,metric',
    )
    .all();
  writeFileSync('work/derivatives-history-summary.json', JSON.stringify(summary, null, 2));
  console.log('Export ready:', rows.length, 'observations');
} finally {
  DB.sqlite.close();
  await server.close();
}
