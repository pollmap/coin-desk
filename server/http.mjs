import { monitorEventLoopDelay } from 'node:perf_hooks';
import { securityHeaders, requestBudget } from './security.mjs';
import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { schedulerState } from './runtime.mjs';
import { searchResponse } from './search.mjs';
import { staticResponder } from './static-response.mjs';
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
  retainedAssetRoot,
  publicOrigin,
  quoteHubUrl = process.env.COIN_DESK_QUOTE_HUB,
  backupStatusPath,
  release = 'development',
}) {
  if (publicOrigin) {
    const origin = new URL(publicOrigin);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error('Invalid public HTTPS origin');
    publicOrigin = origin.origin;
  }
  const cspMode = process.env.COIN_DESK_CSP_MODE ?? 'report-only';
  if (!['report-only', 'enforce'].includes(cspMode)) throw new Error('Invalid CSP mode');
  const allow = requestBudget({ perClient: 900 }),
    searchAllow = requestBudget({ perClient: 120, global: 600 });
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const telemetry = { requests: 0, responseBytes: 0, maxRequestMs: 0 };
  const pending = new Set();
  const ctx = {
    waitUntil(p) {
      pending.add(p);
      p.catch(() => {}).finally(() => pending.delete(p));
    },
  };
  const root = resolve(staticRoot);
  const serveStatic = staticResponder();
  const server = createServer(async (req, res) => {
    const started = performance.now();
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
        if (
          url.pathname.startsWith('/api/') &&
          (!allow(req.socket.remoteAddress ?? 'unknown') ||
            (url.pathname === '/api/v1/search' &&
              !searchAllow(req.socket.remoteAddress ?? 'unknown')))
        ) {
          out = json({ error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMIT' }, 429);
          out.headers.set('Retry-After', '60');
        } else if (!['GET', 'HEAD'].includes(req.method))
          out = json({ error: 'Read-only API' }, 405);
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
          out = json({
            kind: 'vps',
            release,
            performance: {
              ...telemetry,
              eventLoopP95Ms: Math.round(loop.percentile(95) / 1e6),
              rssMiB: Math.round(process.memoryUsage().rss / 1048576),
            },
            scheduler: schedulerState(database),
            backup,
            historyCollection: env.HISTORY_ALLOWED?.() === false ? 'paused_low_space' : 'enabled',
          });
        } else if (url.pathname === '/api/v1/quotes/stream' && req.method === 'GET') {
          const market = url.searchParams.get('market');
          if (
            !['upbit', 'binance'].includes(market) ||
            [...url.searchParams.keys()].some((k) => !['market', 'assets'].includes(k)) ||
            url.searchParams.getAll('market').length !== 1 ||
            url.searchParams.getAll('assets').length > 1 ||
            (url.searchParams.get('assets')?.length ?? 0) > 2500
          ) {
            out = json({ error: 'Invalid market' }, 400);
          } else if (!quoteHubUrl) {
            out = json({ error: 'Live stream unavailable; use minute snapshots' }, 503);
          } else {
            const controller = new AbortController();
            res.on('close', () => controller.abort());
            const deadline = setTimeout(() => controller.abort(), 5000);
            try {
              out = await fetch(`${quoteHubUrl}/stream?${url.searchParams}`, {
                signal: controller.signal,
              });
            } finally {
              clearTimeout(deadline);
            }
          }
        } else if (url.pathname === '/api/v1/search') {
          try {
            out = json(await searchResponse(url.searchParams));
          } catch (error) {
            out =
              error.code === 'SEARCH_BUSY'
                ? json({ error: 'Search temporarily busy', code: 'SEARCH_BUSY' }, 503)
                : json({ error: 'Invalid search request' }, 400);
          }
        } else if (url.pathname.startsWith('/api/')) {
          out = await worker.fetch(new Request(url, { method: 'GET' }), env, ctx);
          if (url.pathname === '/api/v1/market' && out.ok) {
            const collection = schedulerState(database).find((lane) => lane.lane === 'quotes');
            out = json({ ...(await out.json()), collection });
          }
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
            if (!exists && retainedAssetRoot && /^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) {
              const retained = resolve(retainedAssetRoot);
              try {
                const candidate = await realpath(resolve(retained, path.slice('/assets/'.length)));
                if (candidate.startsWith(retained + sep) && (await stat(candidate)).isFile()) {
                  file = candidate;
                  exists = true;
                }
              } catch {
                /* Unknown historical assets remain a 404. */
              }
            }
            if (!exists && extname(path)) out = json({ error: 'Not found' }, 404);
            else {
              if (!exists) file = resolve(root, 'index.html');
              out = await serveStatic(file, {
                mime: mime[extname(file)] || 'application/octet-stream',
                cacheControl:
                  path.startsWith('/assets/') ||
                  /^\/coin-logos\/v2\/[a-z0-9]+-[a-f0-9]{12}\.png$/.test(path)
                    ? 'public, max-age=31536000, immutable'
                    : 'no-cache',
                publicOrigin,
                headers: req.headers,
              });
            }
          }
        }
      }
    } catch {
      out = json({ error: 'Service temporarily unavailable' }, 503);
    }
    if (res.destroyed) {
      await out.body?.cancel().catch(() => {});
      return;
    }
    const headers = new Headers(out.headers);
    securityHeaders(headers, { https: !!publicOrigin, mode: cspMode });
    telemetry.requests++;
    telemetry.maxRequestMs = Math.max(
      telemetry.maxRequestMs,
      Math.round(performance.now() - started),
    );
    res.writeHead(out.status, Object.fromEntries(headers));
    if (req.method === 'HEAD') {
      await out.body?.cancel();
      res.end();
    } else if (out.body)
      Readable.fromWeb(out.body)
        .on('error', () => res.destroy())
        .pipe(
          new Transform({
            transform(chunk, encoding, callback) {
              telemetry.responseBytes += chunk.length;
              callback(null, chunk);
            },
          }),
        )
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
      loop.disable();
      const timer = setTimeout(() => server.closeAllConnections(), 10000);
      await new Promise((resolve) => server.close(resolve));
      clearTimeout(timer);
      await Promise.allSettled([...pending]);
    },
  };
}
