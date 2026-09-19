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
const vite = await viteServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const env = {
  DB,
  BITVIEW_BASE_URL: 'https://bitview.space',
  ENABLED_ASSETS: 'BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE',
  ASSETS: { fetch: async () => new Response('Open http://127.0.0.1:5173') },
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
    const { scheduled } = await vite.ssrLoadModule('/worker/scheduled.ts');
    await scheduled(env);
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
