/** Isolated, deterministic fixture DB, real Worker read paths, no cron/upstream.
 * Never opens work/local.sqlite or connects to production. Not a product server.
 */
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { openDatabase, memoryCache } from './local-db.mjs';
const DB = openDatabase(':memory:');
const port = Number(process.env.COIN_DESK_TEST_PORT || '5190');
const server = createServer();
const vite = await createVite({
  cacheDir: `node_modules/.vite-e2e-${port}`,
  server: { middlewareMode: true, hmr: { server }, proxy: {} },
  appType: 'spa',
});
const { ASSETS, METRICS } = await vite.ssrLoadModule('/shared/catalog.ts');
const { networkMetrics } = await vite.ssrLoadModule('/shared/network-catalog.ts');
const { jobPolicies } = await vite.ssrLoadModule('/worker/health.ts');
const now = Math.floor(Date.now() / 1000),
  day = 86400,
  last = Math.floor(now / day) * day - day;
const enabled = ASSETS.map((a) => a.id);
const setState = (key, value) =>
  DB.sqlite.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(key, JSON.stringify(value));
setState('onchain_generation', 'test');
for (const policy of jobPolicies(enabled, false)) {
  DB.sqlite
    .prepare(
      'INSERT OR REPLACE INTO ingestion(key,last_attempt,last_success,data_as_of,next_attempt) VALUES(?,?,?,?,?)',
    )
    .run(policy.key, now, now, last, now + day);
}
DB.sqlite.exec('BEGIN');
for (const [index, asset] of enabled.entries()) {
  const base = { BTC: 60000, ETH: 3000, DOGE: 0.1 }[asset] ?? 20;
  // Long-range regressions use the original core assets; discovery assets need
  // 90 complete bars for RSI, search and paging, not millions of duplicate fixtures.
  const count = index < 8 ? 1100 : 90;
  const first = last - (count - 1) * day;
  const months = new Map();
  for (const market of ['upbit', 'binance']) {
    const factor = market === 'upbit' ? 1400 : 1;
    DB.sqlite.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(
      'quote:' + asset + ':' + market,
      JSON.stringify({
        asset,
        price: base * factor,
        time: now,
        change24h: 2,
        volume24h: 100000000,
        high24h: base * factor * 1.1,
        low24h: base * factor * 0.9,
      }),
      now,
    );
    DB.sqlite
      .prepare(
        'INSERT OR REPLACE INTO ingestion(key,last_success,data_as_of,next_attempt) VALUES(?,?,?,?)',
      )
      .run('quote:' + asset + ':' + market, now, now, now + day);
    for (const interval of ['1d', '1h']) {
      setState(`history:${asset}:${market}:${interval}`, {
        asset,
        market,
        interval,
        first,
        last,
        rows: count,
        complete: true,
      });
      for (let i = 0; i < count; i++) {
        const time = interval === '1d' ? first + i * day : last - (count - 1 - i) * 3600;
        const price = base * factor * (0.75 + i / 4400 + Math.sin(i / 12) / 50);
        DB.sqlite
          .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(
            asset,
            market,
            interval,
            time,
            price,
            price * 1.01,
            price * 0.99,
            price,
            100,
            time + (interval === '1d' ? day : 3600),
            now,
          );
      }
    }
  }
  for (let i = 0; i < count; i++) {
    const time = first + i * day,
      price = base * (0.75 + i / 4400 + Math.sin(i / 12) / 50);
    DB.sqlite.prepare('INSERT INTO reference_prices VALUES(?,?,?,?)').run(asset, time, price, now);
    const values = { price };
    for (const metric of networkMetrics(asset))
      values[metric.id] =
        metric.id === 'mvrv' ? 1.5 + Math.sin(i / 12) / 5 : 1000 + index * 100 + i;
    const date = new Date(time * 1000),
      bucket = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
    if (!months.has(bucket)) months.set(bucket, []);
    months.get(bucket).push({ time, values });
    for (const metric of [
      'funding',
      'open_interest',
      'long_account_ratio',
      'open_interest_daily',
      'long_account_ratio_daily',
    ])
      DB.sqlite
        .prepare('INSERT INTO derivative_series VALUES(?,?,?,?,?)')
        .run(
          asset,
          metric,
          time,
          metric === 'funding' ? 0.001 : metric.includes('ratio') ? 52 : 1000000 + i,
          now,
        );
    if (asset === 'BTC') {
      const data = Object.fromEntries(METRICS.map((m) => [m.id, 1.5 + i / 1000]));
      DB.sqlite
        .prepare('INSERT INTO onchain(generation,time,data,fetched_at) VALUES(?,?,?,?)')
        .run('test', time, JSON.stringify(data), now);
    }
  }
  for (const [bucket, rows] of months)
    DB.sqlite
      .prepare('INSERT INTO network_months VALUES(?,?,?,?)')
      .run(asset, bucket, JSON.stringify(rows), now);
  for (const metric of networkMetrics(asset))
    DB.sqlite
      .prepare('INSERT INTO network_coverage VALUES(?,?,?,?,?,?)')
      .run(asset, metric.id, first, last, count, now);
}
DB.sqlite.exec('COMMIT');
globalThis.caches = { default: memoryCache() };
// Fail closed if a read path accidentally requests live exchange/provider data.
globalThis.fetch = async () => {
  throw new Error('E2E_UPSTREAM_DISABLED');
};
const worker = (await vite.ssrLoadModule('/worker/index.ts')).default;
const env = {
  DB,
  ENABLED_ASSETS: enabled.join(','),
  BITVIEW_BASE_URL: '',
  ASSETS: { fetch: async () => new Response('', { status: 404 }) },
};
let requestId = 0;
server.on('request', async (req, res) => {
  if (!req.url.startsWith('/api/')) return vite.middlewares(req, res);
  const id = ++requestId,
    started = Date.now();
  const trace = (phase) => {
    if (process.env.COIN_DESK_FIXTURE_TRACE === '1' && id <= 5000)
      console.log(
        JSON.stringify({
          event: 'fixture_api',
          id,
          phase,
          url: req.url,
          elapsedMs: Date.now() - started,
        }),
      );
  };
  trace('received');
  res.once('finish', () => trace('finished'));
  res.once('close', () => {
    if (!res.writableFinished) trace('closed-before-finish');
  });
  try {
    const response = await worker.fetch(new Request(`http://127.0.0.1:${port}` + req.url), env, {
      waitUntil: (p) => p.catch(() => {}),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: String(e) }));
  }
});
server.listen(port, '127.0.0.1');
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  server.close();
  await vite.close();
  DB.sqlite.close();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
process.on('message', (message) => {
  if (message === 'shutdown') void shutdown();
});
