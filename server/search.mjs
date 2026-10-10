import { DatabaseSync } from 'node:sqlite';
import { Worker, isMainThread } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
let index;
export async function executeSearch(params) {
  const started = performance.now();
  const catalog = await import('../server-dist/search.mjs');
  const request = catalog.validateSearch(params);
  if (!index) {
    const db = new DatabaseSync(':memory:');
    db.exec(
      "CREATE VIRTUAL TABLE search_fts USING fts5(document_id UNINDEXED, text, tokenize='trigram')",
    );
    const prepared = JSON.parse(
      await readFile(new URL('../server-dist/search-index.json', import.meta.url), 'utf8'),
    );
    const documents = prepared.documents;
    const put = db.prepare('INSERT INTO search_fts VALUES (?, ?)');
    db.exec('BEGIN');
    for (const d of documents) {
      put.run(d.id, `${d.title} ${d.aliases}`);
    }
    for (const chunk of prepared.chunks) put.run(chunk.documentId, chunk.text);
    db.exec('COMMIT');
    index = { db, documents };
  }
  const terms = request.q.split(/\s+/).filter((t) => [...t].length >= 3);
  const expression = terms.map((t) => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
  const matches = expression
    ? index.db
        .prepare(
          'SELECT document_id, bm25(search_fts) AS score FROM search_fts WHERE search_fts MATCH ? ORDER BY score LIMIT 120',
        )
        .all(expression)
        .map((r) => r.document_id)
    : [];
  return {
    hits: catalog.rankSearch(params, index.documents, [...new Set(matches)]),
    indexVersion: catalog.SEARCH_CATALOG_VERSION,
    mode: 'fts5-trigram-bm25',
    elapsedMs: Math.round((performance.now() - started) * 100) / 100,
  };
}
let thread;
let sequence = 0;
const pending = new Map();
function resetThread(worker) {
  if (thread !== worker) return;
  thread = undefined;
  for (const task of pending.values()) {
    clearTimeout(task.timer);
    task.reject(new Error('Search index unavailable'));
  }
  pending.clear();
  void worker.terminate();
}
/** Indexing and MATCH execute outside the API event loop; queue and deadlines are bounded. */
export async function searchResponse(params) {
  const catalog = await import('../server-dist/search.mjs');
  catalog.validateSearch(params);
  if (!isMainThread) return executeSearch(params);
  if (pending.size >= 16) {
    const error = new Error('Search busy');
    error.code = 'SEARCH_BUSY';
    throw error;
  }
  if (!thread) {
    thread = new Worker(new URL('./search-worker.mjs', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const worker = thread;
    thread.on('message', ({ id, result, error }) => {
      const task = pending.get(id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(id);
      if (error) task.reject(new Error('Search index unavailable'));
      else task.resolve(result);
      if (!pending.size) thread?.unref();
    });
    thread.on('error', () => resetThread(worker));
    thread.on('exit', () => resetThread(worker));
    thread.unref();
  }
  try {
    return await new Promise((resolve, reject) => {
      const id = ++sequence;
      const worker = thread;
      const timer = setTimeout(() => {
        resetThread(worker);
      }, 3000);
      pending.set(id, { resolve, reject, timer });
      thread.ref();
      thread.postMessage({ id, params: params.toString() });
    });
  } catch {
    return {
      hits: catalog.rankSearch(params),
      indexVersion: catalog.SEARCH_CATALOG_VERSION,
      mode: 'catalog-fallback',
    };
  }
}
