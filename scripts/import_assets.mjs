/** Import collected asset archives into the local adapter, with per-asset transactions. */
import { openDatabase } from './local-db.mjs';
import { readFileSync } from 'node:fs';
const assets = (process.argv[2] || 'DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE').split(',');
if (assets.some((a) => !['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE'].includes(a)))
  throw new Error('Unknown asset');
const db = openDatabase();
try {
  for (const asset of assets) {
    db.sqlite.exec('BEGIN');
    try {
      db.sqlite.exec(readFileSync('work/assets/' + asset + '.sql', 'utf8'));
      db.sqlite.exec('COMMIT');
      console.log(asset + ' imported');
    } catch (error) {
      db.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
} finally {
  db.sqlite.close();
}
