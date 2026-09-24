// First recent page only; the scheduled Worker resumes reverse history from its cursor.
import { createServer } from 'vite';
import { openDatabase } from './local-db.mjs';
import { writeFileSync } from 'node:fs';
const vite = await createServer({
  configFile: false,
  publicDir: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const DB = openDatabase('work/release13.sqlite');
const { updateDerivatives, DERIVATIVE_METRICS } =
  await vite.ssrLoadModule('/worker/derivatives.ts');
try {
  for (const asset of ['SOL', 'XRP', 'LINK', 'ONDO', 'PEPE']) {
    for (const metric of DERIVATIVE_METRICS) {
      try {
        await updateDerivatives({ DB }, asset, metric);
        console.log(asset, metric, 'stored');
      } catch {
        console.log(asset, metric, 'source unavailable');
      }
    }
  }
  const quote = (v) =>
    v == null
      ? 'NULL'
      : typeof v === 'number'
        ? String(v)
        : "'" + String(v).replaceAll("'", "''") + "'";
  const statements = [];
  for (const row of DB.sqlite.prepare('SELECT * FROM derivative_series').all())
    statements.push(
      `INSERT OR IGNORE INTO derivative_series(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`,
    );
  for (const row of DB.sqlite
    .prepare("SELECT * FROM state WHERE key LIKE 'cursor:derivatives:%'")
    .all())
    statements.push(
      `INSERT OR IGNORE INTO state(key,value) VALUES(${quote(row.key)},${quote(row.value)});`,
    );
  for (const row of DB.sqlite
    .prepare("SELECT * FROM ingestion WHERE key LIKE 'derivatives:%'")
    .all())
    statements.push(
      `INSERT OR IGNORE INTO ingestion(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`,
    );
  writeFileSync('work/derivatives13-seed.sql', statements.join('\n'));
  console.log(
    'Verified source rows',
    DB.sqlite.prepare('SELECT count(*) n FROM derivative_series').get().n,
  );
} finally {
  DB.sqlite.close();
  await vite.close();
}
