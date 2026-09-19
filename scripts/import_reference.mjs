import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './local-db.mjs';
const args = process.argv.slice(2);
const supported = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'];
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const assets = arg('--assets', supported.join(',')).split(',');
if (!assets.length || assets.some((asset) => !supported.includes(asset)))
  throw new Error('Unsupported reference asset');
const directory = arg('--directory', 'work/reference');
const db = openDatabase();
try {
  for (const asset of assets) {
    db.sqlite.exec('BEGIN');
    try {
      db.sqlite.exec(readFileSync(resolve(directory, `${asset}.sql`), 'utf8'));
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
