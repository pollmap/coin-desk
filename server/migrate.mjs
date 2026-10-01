import { openSqlite, migrate } from './sqlite.mjs';
const db = openSqlite(process.env.COIN_DESK_DB || '/app/data/coin-desk.sqlite');
try {
  console.log(JSON.stringify({ migrations: migrate(db).length }));
} finally {
  db.sqlite.close();
}
