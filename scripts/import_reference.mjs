import { readFileSync } from 'node:fs';
import { openDatabase } from './local-db.mjs';
const db = openDatabase();
try {
  for (const asset of ['BTC', 'DOGE', 'ETH']) {
    db.sqlite.exec('BEGIN');
    try {
      db.sqlite.exec(readFileSync(`work/reference/${asset}.sql`, 'utf8'));
      db.sqlite.exec('COMMIT');
    } catch (error) {
      db.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  console.log(
    db.sqlite
      .prepare(
        'SELECT asset,COUNT(*) rows,MIN(time) first,MAX(time) last FROM reference_prices GROUP BY asset',
      )
      .all(),
  );
} finally {
  db.sqlite.close();
}
