import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';

/** Local-only adapter. Production uses Cloudflare D1, never this module. */
export function openDatabase(path = 'work/local.sqlite') {
  mkdirSync('work', { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  for (const file of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  const executions = new WeakMap();
  function prepare(sql, params = []) {
    const execute = () => {
      const result = sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    };
    const statement = {
      bind(...values) {
        return prepare(sql, values);
      },
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
      sqlite.exec('BEGIN');
      try {
        const results = [];
        // Keep the synchronous SQLite transaction uninterrupted, matching D1's
        // atomic batch. Awaiting each statement allowed another batch to BEGIN.
        for (const stmt of statements) {
          const execute = executions.get(stmt);
          if (!execute) throw new Error('Batch statement belongs to another database');
          results.push(execute());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export function memoryCache() {
  const entries = new Map();
  return {
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      const entry = entries.get(key);
      if (!entry || entry.until < Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.response.clone();
    },
    async put(req, res) {
      const age = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 0);
      if (entries.size > 200) entries.delete(entries.keys().next().value);
      entries.set(req.url, { response: res.clone(), until: Date.now() + age * 1000 });
    },
    clear() {
      entries.clear();
    },
  };
}
