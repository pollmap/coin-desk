import { readFileSync } from 'node:fs';
import { openDatabase } from './local-db.mjs';

// Local SQLite only; no Cloudflare credentials or remote D1 commands.
const supported = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'];
const assets = process.argv[2]?.split(',') || supported;
if (assets.some((asset) => !supported.includes(asset)))
  throw new Error('Unsupported network asset');
const db = openDatabase();
try {
  for (const asset of assets) {
    const sql = readFileSync(`work/network/${asset}.sql`, 'utf8');
    db.sqlite.exec('BEGIN');
    try {
      db.sqlite.exec(sql);
      db.sqlite.exec('COMMIT');
    } catch (error) {
      db.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  console.log(
    db.sqlite
      .prepare(
        'SELECT asset,COUNT(*) AS metrics,MIN(first) AS first,MAX(last) AS last FROM network_coverage GROUP BY asset',
      )
      .all(),
  );
  console.log(
    db.sqlite
      .prepare(
        'SELECT asset,COUNT(*) AS months,SUM(length(payload)) AS bytes FROM network_months GROUP BY asset',
      )
      .all(),
  );
} finally {
  db.sqlite.close();
}
