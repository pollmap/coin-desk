import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { schedulerState } from './runtime.mjs';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
export function createHttpServer({
  worker,
  env,
  database,
  staticRoot = 'dist',
  backupStatusPath,
  release = 'development',
}) {
  const pending = new Set();
  const ctx = {
    waitUntil(p) {
      pending.add(p);
      p.catch(() => {}).finally(() => pending.delete(p));
    },
  };
  const root = resolve(staticRoot);
  const server = createServer(async (req, res) => {
    let out;
    try {
      if (
        !req.url ||
        req.url.length > 2048 ||
        !req.url.startsWith('/') ||
        req.url.startsWith('//')
      ) {
        out = json({ error: 'Invalid request' }, 400);
      } else {
        // Never trust Host / forwarded headers for internal fetch URLs or redirects.
        const url = new URL(req.url, 'http://coin-desk.internal');
        if (!['GET', 'HEAD'].includes(req.method)) out = json({ error: 'Read-only API' }, 405);
        else if (url.pathname === '/healthz') {
          const integrity = database.sqlite.prepare('PRAGMA quick_check(1)').get();
          const schema = database.sqlite
            .prepare(
              "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name IN ('candles','reference_prices','network_months','observation_signals')",
            )
            .get().n;
          out = json(
            {
              ok: Object.values(integrity)[0] === 'ok' && schema === 4,
              kind: 'process-and-database-only',
              release,
            },
            schema === 4 && Object.values(integrity)[0] === 'ok' ? 200 : 503,
          );
        } else if (url.pathname === '/api/v1/runtime') {
          let backup = { ok: false, reason: 'no_verified_backup' };
          if (backupStatusPath) {
            try {
              const saved = JSON.parse(await readFile(backupStatusPath, 'utf8'));
              backup = {
                ok:
                  saved.ok === true &&
                  saved.verified === true &&
                  Date.now() / 1000 - saved.completedAt <= 90000,
                lastCompletedAt: saved.completedAt,
                verified: saved.verified === true,
                reason: saved.reason,
              };
            } catch {
              /* pending/failure stays visible */
            }
          }
          out = json({ kind: 'vps', release, scheduler: schedulerState(database), backup });
        } else if (url.pathname.startsWith('/api/')) {
          out = await worker.fetch(new Request(url, { method: 'GET' }), env, ctx);
        } else {
          let path;
          try {
            path = decodeURIComponent(url.pathname);
          } catch {
            throw new Error('Invalid path');
          }
          if (
            path.includes('\0') ||
            path.includes('\\') ||
            path.split('/').some((p) => p.startsWith('.'))
          )
            out = json({ error: 'Not found' }, 404);
          else {
            let file = resolve(root, '.' + path);
            let exists = false;
            try {
              const canonical = await realpath(file);
              if (!canonical.startsWith(root + sep)) throw new Error('Unsafe asset path');
              exists = (await stat(canonical)).isFile();
              file = canonical;
            } catch {
              exists = false;
            }
            if (!exists && extname(path)) out = json({ error: 'Not found' }, 404);
            else {
              if (!exists) file = resolve(root, 'index.html');
              const data = await readFile(file);
              out = new Response(data, {
                headers: {
                  'content-type': mime[extname(file)] || 'application/octet-stream',
                  'cache-control': path.startsWith('/assets/')
                    ? 'public, max-age=31536000, immutable'
                    : 'no-cache',
                },
              });
            }
          }
        }
      }
    } catch {
      out = json({ error: 'Service temporarily unavailable' }, 503);
    }
    out.headers.set('X-Content-Type-Options', 'nosniff');
    out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.writeHead(out.status, Object.fromEntries(out.headers));
    if (req.method === 'HEAD') {
      await out.body?.cancel();
      res.end();
    } else if (out.body)
      Readable.fromWeb(out.body)
        .on('error', () => res.destroy())
        .pipe(res);
    else res.end();
    req.resume();
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  return {
    server,
    async drain() {
      const timer = setTimeout(() => server.closeAllConnections(), 10000);
      await new Promise((resolve) => server.close(resolve));
      clearTimeout(timer);
      await Promise.allSettled([...pending]);
    },
  };
}
