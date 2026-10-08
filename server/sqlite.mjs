import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const migrationHash = (text) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

/** D1-compatible statements; batches never yield inside a SQLite transaction. */
export function openSqlite(path, { readOnly = false } = {}) {
  if (!readOnly && path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new DatabaseSync(path, { timeout: 10000, readOnly });
  if (!readOnly) sqlite.exec('PRAGMA journal_mode=WAL;');
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
  const executions = new WeakMap();
  function prepare(sql, params = []) {
    const execute = () => {
      const query = sqlite.prepare(sql);
      const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
      const results = query.columns().length ? query.all(...params) : (query.run(...params), []);
      const changes = sqlite.prepare('SELECT total_changes() AS n').get().n - before;
      return { success: true, results, meta: { changes: Number(changes) } };
    };
    const statement = {
      bind: (...values) => prepare(sql, values),
      async first(column) {
        const row = sqlite.prepare(sql).get(...params);
        return row ? (column ? row[column] : row) : null;
      },
      async all() {
        return { success: true, results: sqlite.prepare(sql).all(...params), meta: {} };
      },
      async run() {
        return execute();
      },
    };
    executions.set(statement, execute);
    return statement;
  }
  return {
    sqlite,
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => {
          const execute = executions.get(statement);
          if (!execute) throw new Error('Statement belongs to another database');
          return execute();
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        // SQLITE_FULL and RAISE(ROLLBACK) can already have ended the transaction.
        // Never mask the actual storage/validation failure with a second error.
        try {
          sqlite.exec('ROLLBACK');
        } catch {
          /* Original error is authoritative. */
        }
        throw error;
      }
    },
  };
}

/** Only an empty DB may bootstrap without a validated import ledger. */
export function migrate(database, folder = 'migrations') {
  const db = database.sqlite;
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  if (tables.length && !tables.some((row) => row.name === '_coin_desk_migrations'))
    throw new Error(
      'Existing DB requires the validated export import; refusing to rerun historical migrations',
    );
  db.exec(
    'CREATE TABLE IF NOT EXISTS _coin_desk_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at INTEGER NOT NULL)',
  );
  for (const name of readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const text = readFileSync(resolve(folder, name), 'utf8');
    const checksum = migrationHash(text);
    const applied = db.prepare('SELECT sha256 FROM _coin_desk_migrations WHERE name=?').get(name);
    if (applied) {
      if (applied.sha256 !== checksum)
        throw new Error('Previously applied migration changed: ' + name);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(text);
      db.prepare('INSERT INTO _coin_desk_migrations VALUES(?,?,?)').run(
        name,
        checksum,
        Math.floor(Date.now() / 1000),
      );
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* Preserve the migration failure. */
      }
      throw error;
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS _coin_desk_runtime_runs (
    lane TEXT NOT NULL, slot INTEGER NOT NULL, scheduled_at INTEGER NOT NULL,
    started_at INTEGER NOT NULL, completed_at INTEGER, outcome TEXT NOT NULL,
    PRIMARY KEY(lane,slot));`);
  return db.prepare('SELECT name,sha256 FROM _coin_desk_migrations ORDER BY name').all();
}
