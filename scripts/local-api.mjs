import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createServer as viteServer } from 'vite';
import { openDatabase, memoryCache } from './local-db.mjs';

const DB = openDatabase();
if (process.argv.includes('--seed')) {
  if (!existsSync('work/seed.sql')) throw new Error('먼저 npm run seed 를 실행하세요.');
  DB.sqlite.exec('BEGIN');
  try {
    DB.sqlite.exec(readFileSync('work/seed.sql', 'utf8'));
    DB.sqlite.exec('COMMIT');
  } catch (e) {
    DB.sqlite.exec('ROLLBACK');
    throw e;
  }
  console.log('Real source data imported into work/local.sqlite');
  DB.sqlite.close();
  process.exit(0);
}
globalThis.caches = { default: memoryCache() };
// The API only transforms Worker/shared TypeScript. Keep its watcher and optimizer
// independent of the browser's React plugins, proxy rules, and Vite config restarts.
const vite = await viteServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-api',
  publicDir: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: {
    middlewareMode: true,
    hmr: false,
    ws: false,
    watch: {
      ignored: ['**/work/**', '**/.wrangler/**', '**/test-results/**', '**/playwright-report/**'],
    },
  },
  appType: 'custom',
});
const env = {
  DB,
  BITVIEW_BASE_URL: 'https://bitview.space',
  ENABLED_ASSETS: 'BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE',
  ASSETS: { fetch: async () => new Response('Open http://127.0.0.1:5173') },
};
// Mirror the production service topology locally without remote bindings or credentials.
for (const [binding, lane] of [
  ['BACKGROUND_COLLECTOR', 'background'],
  ['ANALYSIS_COLLECTOR', 'analysis'],
])
  env[binding] = {
    fetch: async (request) => {
      const collector = (await vite.ssrLoadModule('/worker/collector-entry.ts')).default;
      return collector.fetch(request, { ...env, COLLECTOR_LANE: lane });
    },
  };
env.FEED_SERVICE = {
  fetch: async (request) => {
    const feed = (await vite.ssrLoadModule('/worker/market-feed.ts')).default;
    const headers = new Headers(request.headers);
    headers.set('X-Feed-Token', 'local-development-only');
    return feed.fetch(new Request(request, { headers }), { FEED_TOKEN: 'local-development-only' });
  },
};
const context = {
  waitUntil(promise) {
    promise.catch((error) => console.error('Background job:', error.message));
  },
};
const server = createServer(async (req, res) => {
  try {
    const worker = (await vite.ssrLoadModule('/worker/index.ts')).default;
    const request = new Request('http://127.0.0.1:8787' + req.url, { method: req.method });
    const out = await worker.fetch(request, env, context);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error(e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Local API error' }));
  }
});
server.listen(8787, '127.0.0.1', () =>
  console.log('Local API on http://127.0.0.1:8787 · same Worker code / Node SQLite adapter'),
);
let running = false;
const tick = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    const worker = (await vite.ssrLoadModule('/worker/index.ts')).default;
    const jobs = [];
    await worker.scheduled({ scheduledTime: Date.now() }, env, { waitUntil: (p) => jobs.push(p) });
    const { runCollector } = await vite.ssrLoadModule('/worker/collector-entry.ts');
    jobs.push(runCollector(Math.floor(Date.now() / 1000), { ...env, COLLECTOR_LANE: 'quotes' }));
    await Promise.allSettled(jobs);
  } catch (e) {
    console.error('Refresh:', e.message);
  } finally {
    running = false;
  }
}, 60000);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    clearInterval(tick);
    server.close();
    await vite.close();
    DB.sqlite.close();
    process.exit(0);
  });
