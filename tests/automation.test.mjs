import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
vi.mock('../worker/providers', () => ({
  bitviewPage: vi.fn(),
  getRecentCandles: vi.fn(),
  getQuotes: vi.fn(),
  getQuote: vi.fn(),
}));
vi.mock('../worker/dominance', () => ({
  updateDominance: vi.fn(),
  updateStable: vi.fn(),
  getDominance: vi.fn(),
  DOMINANCE_VERSION: 'test',
}));
import { getQuotes, getRecentCandles } from '../worker/providers';
import { scheduled, updateQuoteBatch } from '../worker/scheduled';
import { jobPolicies, dueAt, selectJob, operationStatus } from '../worker/health';
import worker from '../worker/index';
import { DAY } from '../shared/math';
import { networkMetrics } from '../shared/network-catalog';
let DB, env, now, waiting;
const assets = ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE'];
const quote = (asset) => ({
  asset,
  price: 100,
  change24h: 1,
  volume24h: 10,
  high24h: 110,
  low24h: 90,
  time: Math.floor(Date.now() / 1000),
});
function source(key, at = now, asOf = at) {
  DB.sqlite
    .prepare(
      'INSERT OR REPLACE INTO ingestion(key,last_attempt,last_success,data_as_of) VALUES(?,?,?,?)',
    )
    .run(key, at, at, asOf);
}
function ready() {
  for (const p of jobPolicies(assets, false))
    source(p.key, now, p.interval === '1d' ? Math.floor(now / DAY) * DAY : now);
  for (const asset of assets)
    for (const market of ['binance', 'upbit']) {
      source('quote:' + asset + ':' + market);
      DB.sqlite
        .prepare('INSERT INTO snapshots VALUES(?,?,?)')
        .run('quote:' + asset + ':' + market, JSON.stringify(quote(asset)), now);
      for (const interval of ['1h', '1d'])
        DB.sqlite.prepare('INSERT INTO state VALUES(?,?)').run(
          'history:' + asset + ':' + market + ':' + interval,
          JSON.stringify({
            asset,
            market,
            interval,
            first: now - DAY * 100,
            last: now,
            rows: 101,
          }),
        );
    }
  DB.sqlite.prepare('INSERT INTO state VALUES(?,?)').run('onchain_generation', '"active"');
  DB.sqlite
    .prepare('INSERT INTO onchain(generation,time,data,fetched_at) VALUES(?,?,?,?)')
    .run('active', now - DAY, '{"mvrv":1.2}', now);
  for (const asset of ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK']) {
    DB.sqlite
      .prepare('INSERT INTO reference_prices VALUES(?,?,?,?)')
      .run(asset, now - DAY, 100, now);
    for (const metric of networkMetrics(asset))
      DB.sqlite
        .prepare(
          'INSERT INTO network_coverage(asset,metric,first,last,observations,fetched_at) VALUES(?,?,?,?,?,?)',
        )
        .run(asset, metric.id, now - DAY, now - DAY, 1, now);
  }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
  now = Math.floor(Date.now() / 1000);
  DB = openDatabase(':memory:');
  env = {
    DB,
    ENABLED_ASSETS: assets.join(','),
    BITVIEW_BASE_URL: 'https://bitview.space',
    ASSETS: { fetch: async () => new Response('asset') },
  };
  waiting = [];
  vi.stubGlobal('caches', { default: memoryCache() });
  getQuotes.mockImplementation(async (selected) => ({ quotes: selected.map(quote), errors: [] }));
  getRecentCandles.mockImplementation(async () => [
    {
      time: now - 3600,
      open: 100,
      high: 110,
      low: 90,
      close: 100,
      volume: 1,
      closeTime: now,
      closed: true,
    },
  ]);
});
afterEach(async () => {
  await Promise.all(waiting);
  DB.sqlite.close();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('four quote batches refresh every market without visitors even while price recovery is overdue', async () => {
  ready();
  DB.sqlite
    .prepare("UPDATE ingestion SET last_attempt=?,data_as_of=? WHERE key LIKE '%:1h'")
    .run(now - 7200, now - 7200);
  DB.sqlite
    .prepare("UPDATE ingestion SET last_attempt=? WHERE key LIKE 'quotes:%' OR key LIKE 'quote:%'")
    .run(now - 900);
  DB.sqlite.prepare("UPDATE ingestion SET last_success=? WHERE key LIKE 'quote:%'").run(now - 900);
  for (let minute = 0; minute < 4; minute++) {
    vi.setSystemTime((now + minute * 60) * 1000);
    await scheduled(env);
  }
  expect(getQuotes).toHaveBeenCalledTimes(4);
  expect(getRecentCandles).not.toHaveBeenCalled();
  const stored = DB.sqlite
    .prepare('SELECT data FROM snapshots')
    .all()
    .map((r) => JSON.parse(r.data));
  expect(stored).toHaveLength(16);
  expect(stored.every((q) => q.time >= now)).toBe(true);
  vi.setSystemTime((now + 4 * 60) * 1000);
  await scheduled(env);
  expect(getRecentCandles).toHaveBeenCalledTimes(1);
});
it('concurrent delivery and duplicate minute delivery execute exactly one source job', async () => {
  ready();
  source('quotes:binance:0', now - 900);
  for (const asset of assets.slice(0, 4)) source('quote:' + asset + ':binance', now - 900);
  await Promise.all([scheduled(env), scheduled(env), scheduled(env)]);
  await scheduled(env);
  expect(getQuotes).toHaveBeenCalledTimes(1);
  expect(DB.sqlite.prepare('SELECT COUNT(*) n FROM cron_runs').get().n).toBe(1);
  expect(DB.sqlite.prepare('SELECT outcome,lease_until FROM cron_state').get()).toMatchObject({
    outcome: 'ok',
    lease_until: 0,
  });
});
it('an abandoned execution is recorded and resumed after its lease expires', async () => {
  ready();
  DB.sqlite
    .prepare(
      'INSERT INTO cron_state(id,run_id,last_tick,last_started,lease_until,job,outcome) VALUES(1,?,?,?,?,?,?)',
    )
    .run(
      'abandoned',
      Math.floor((now - 180) / 60),
      now - 180,
      now - 60,
      'BTC:binance:1h',
      'running',
    );
  DB.sqlite
    .prepare('INSERT INTO cron_runs VALUES(?,?,?,?,?,?,?)')
    .run(1, 'abandoned', now - 180, null, 'BTC:binance:1h', 'running', null);
  source('BTC:binance:1h', now - 180, now - 7200);
  DB.sqlite
    .prepare('UPDATE ingestion SET last_success=? WHERE key=?')
    .run(now - 7200, 'BTC:binance:1h');
  await scheduled(env);
  expect(getRecentCandles).toHaveBeenCalledTimes(1);
  expect(
    DB.sqlite.prepare('SELECT outcome FROM cron_runs WHERE run_id=?').get('abandoned').outcome,
  ).toBe('interrupted');
  expect(DB.sqlite.prepare('SELECT outcome,last_completed FROM cron_state').get()).toMatchObject({
    outcome: 'ok',
    last_completed: now,
  });
});
it('a failed asset preserves its prior quote and does not mark its successful peers failed', async () => {
  ready();
  const selected = assets.slice(0, 4);
  for (const asset of selected) source('quote:' + asset + ':binance', now - 900);
  getQuotes.mockResolvedValue({
    quotes: selected.slice(0, 3).map(quote),
    errors: [{ asset: 'SOL', error: new Error('HTTP 429 private body') }],
  });
  const states = DB.sqlite.prepare('SELECT * FROM ingestion').all();
  expect(await updateQuoteBatch(env, selected, 'binance', states)).toBe(true);
  for (const asset of selected.slice(0, 3))
    expect(
      DB.sqlite
        .prepare('SELECT last_success,error FROM ingestion WHERE key=?')
        .get('quote:' + asset + ':binance'),
    ).toMatchObject({ last_success: now, error: null });
  const failed = DB.sqlite.prepare('SELECT * FROM ingestion WHERE key=?').get('quote:SOL:binance');
  expect(failed.last_success).toBe(now - 900);
  expect(failed.next_attempt).toBeGreaterThan(now);
  expect(
    JSON.parse(
      DB.sqlite.prepare('SELECT data FROM snapshots WHERE key=?').get('quote:SOL:binance').data,
    ).price,
  ).toBe(100);
});
it('UTC day rollover refreshes the previous day and new daily candle before the six-hour cadence expires', () => {
  const start = Math.floor(now / DAY) * DAY;
  const job = jobPolicies(['BTC'], false).find((p) => p.key === 'BTC:binance:1d');
  const state = {
    key: job.key,
    last_attempt: start - 600,
    last_success: start - 600,
    data_as_of: start - DAY,
    next_attempt: 0,
  };
  expect(dueAt(job, [state], start + 60)).toBe(start);
  expect(selectJob([job], [state], start + 60)).toEqual(job);
});
it('source backoff does not stop another eligible source and remains visible', async () => {
  ready();
  source('quotes:binance:0', now - 900);
  source('BTC:binance:1h', now - 7200);
  DB.sqlite
    .prepare('UPDATE ingestion SET next_attempt=?,error=? WHERE key=?')
    .run(now + 900, 'HTTP 429 private body', 'quotes:binance:0');
  await scheduled(env);
  expect(getQuotes).not.toHaveBeenCalled();
  expect(getRecentCandles).toHaveBeenCalledTimes(1);
});
it('reference collection checks every six hours and catches up stale history without ignoring backoff', () => {
  const job = jobPolicies(['BTC'], false).find((p) => p.key === 'reference:BTC');
  const state = { key: job.key, last_attempt: now - 60, data_as_of: now - DAY, next_attempt: 0 };
  expect(dueAt(job, [state], now)).toBe(now - 60 + 21600);
  state.data_as_of = now - 4 * DAY;
  expect(dueAt(job, [state], now)).toBe(now);
  state.next_attempt = now + 900;
  expect(dueAt(job, [state], now)).toBe(now + 900);
});
it('background quote health tolerates its declared cadence while preserving the stricter live timestamp flag', async () => {
  ready();
  await scheduled(env);
  source('quote:DOGE:binance', now - 480, now - 480);
  const report = await operationStatus(env);
  expect(report.sources.find((row) => row.key === 'quote:DOGE:binance')).toMatchObject({
    status: 'ok',
    liveStale: true,
    dataAgeSeconds: 480,
    dataFreshnessLimitSeconds: 600,
  });
  source('quote:DOGE:binance', now - 601, now - 601);
  const delayed = await operationStatus(env);
  expect(
    delayed.health.reasons.some(
      (reason) => reason.key === 'quote:DOGE:binance' && reason.code === 'SOURCE_DELAYED',
    ),
  ).toBe(true);
});
it('a failed maintenance run is unhealthy without exposing upstream error details', async () => {
  ready();
  await scheduled(env);
  DB.sqlite
    .prepare("UPDATE cron_state SET outcome='error',job='maintenance',error=?")
    .run('private upstream body https://private.example/token');
  const report = await operationStatus(env);
  expect(report.health.reasons.some((reason) => reason.code === 'CRON_JOB_ERROR')).toBe(true);
  expect(JSON.stringify(report)).not.toContain('private.example');
});
it('read-only health detects cron stoppage, reports actual freshness and never refreshes a source', async () => {
  ready();
  await scheduled(env);
  const fetch = async (path) =>
    worker.fetch(new Request('https://unit.test/api/v1/' + path), env, {
      waitUntil: (p) => waiting.push(p),
    });
  const first = await fetch('health');
  expect(first.status).toBe(200);
  const before = DB.sqlite.prepare('SELECT total_changes() n').get().n;
  vi.setSystemTime((now + 181) * 1000);
  const later = await fetch('health');
  expect(later.status).toBe(503);
  expect((await later.json()).reasons.some((r) => r.code === 'CRON_STALLED')).toBe(true);
  expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(before);
  expect(getQuotes).not.toHaveBeenCalled();
  expect(getRecentCandles).not.toHaveBeenCalled();
});
it('missing stored history cannot be presented as healthy merely because ingestion timestamps exist', async () => {
  ready();
  await scheduled(env);
  DB.sqlite.prepare('DELETE FROM snapshots WHERE key=?').run('quote:DOGE:upbit');
  DB.sqlite.prepare('DELETE FROM state WHERE key=?').run('history:ETH:binance:1d');
  const report = await operationStatus(env);
  expect(report.health.ok).toBe(false);
  expect(report.health.reasons.some((r) => r.code === 'QUOTE_MISSING')).toBe(true);
  expect(report.health.reasons.some((r) => r.code === 'HISTORY_MISSING')).toBe(true);
});
it('a fresh network collector cannot conceal a missing or outdated individual metric', async () => {
  ready();
  await scheduled(env);
  DB.sqlite
    .prepare("DELETE FROM network_coverage WHERE asset='DOGE' AND metric='fees_native'")
    .run();
  const missing = await operationStatus(env);
  expect(missing.sources.find((row) => row.key === 'network:DOGE').status).toBe('missing');
  DB.sqlite
    .prepare(
      'INSERT INTO network_coverage(asset,metric,first,last,observations,fetched_at) VALUES(?,?,?,?,?,?)',
    )
    .run('DOGE', 'fees_native', now - 5 * DAY, now - 4 * DAY, 2, now);
  const delayed = await operationStatus(env);
  expect(delayed.sources.find((row) => row.key === 'network:DOGE')).toMatchObject({
    status: 'delayed',
    dataAgeSeconds: 4 * DAY,
    coverage: { metrics: 12, expectedMetrics: 12, oldestMetricAsOf: now - 4 * DAY },
  });
});
it('status bypasses old cached responses and reflects DB changes immediately without writing or refreshing sources', async () => {
  ready();
  await scheduled(env);
  const request = new Request('https://unit.test/api/v1/status');
  // A cache entry from an older deployment must not conceal the current state.
  await caches.default.put(
    request,
    new Response(JSON.stringify({ obsolete: true }), {
      headers: { 'Cache-Control': 'public, max-age=300' },
    }),
  );
  const fetch = () => worker.fetch(request, env, { waitUntil: (p) => waiting.push(p) });
  const before = DB.sqlite.prepare('SELECT total_changes() n').get().n;
  const initial = await fetch();
  expect(initial.status).toBe(200);
  expect((await initial.json()).health.ok).toBe(true);
  await Promise.all(waiting);
  expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(before);
  DB.sqlite
    .prepare("UPDATE cron_state SET outcome='error',job='maintenance',error='test failure'")
    .run();
  const afterMutation = DB.sqlite.prepare('SELECT total_changes() n').get().n;
  const current = await fetch();
  expect(current.status).toBe(200);
  expect(current.headers.get('Cache-Control')).toBe('no-store');
  const report = await current.json();
  expect(report.automation).toMatchObject({ lastRunStatus: 'error', lastJob: 'maintenance' });
  expect(report.health.ok).toBe(false);
  expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(afterMutation);
  expect(getQuotes).not.toHaveBeenCalled();
  expect(getRecentCandles).not.toHaveBeenCalled();
});
it('the execution ledger remains bounded after more than 120 minute ticks', async () => {
  ready();
  // Keep every source not due; exercise persistence/retention without fake upstream work.
  DB.sqlite.prepare('UPDATE ingestion SET next_attempt=?').run(now + 86400);
  for (let minute = 0; minute < 125; minute++) {
    vi.setSystemTime((now + minute * 60) * 1000);
    await scheduled(env);
  }
  expect(DB.sqlite.prepare('SELECT COUNT(*) n FROM cron_runs').get().n).toBe(120);
  expect(DB.sqlite.prepare('SELECT last_completed FROM cron_state').get().last_completed).toBe(
    now + 124 * 60,
  );
});
