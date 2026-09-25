import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import worker from '../worker/index';
import { pages } from '../src/lib';
import { DAY } from '../shared/math';
import { jobPolicies, dueAt } from '../worker/health';
let DB, env, pending;
beforeEach(() => {
  DB = openDatabase(':memory:');
  env = {
    DB,
    ENABLED_ASSETS: 'BTC,DOGE,ETH,XRP,LINK,SOL',
    BITVIEW_BASE_URL: '',
    ASSETS: { fetch: vi.fn() },
  };
  pending = [];
  vi.stubGlobal('caches', { default: memoryCache() });
});
afterEach(async () => {
  await Promise.all(pending);
  DB.sqlite.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const call = (path) =>
  worker.fetch(new Request('https://test.local/api/v1/' + path), env, {
    waitUntil: (task) => pending.push(task),
  });

it('publishes only supported per-asset metrics and rejects unsupported metric/source combinations before reading history', async () => {
  const doge = await (await call('network-catalog?asset=DOGE')).json();
  const link = await (await call('network-catalog?asset=LINK')).json();
  expect(doge.data.some((metric) => metric.id === 'hashrate')).toBe(true);
  expect(link.data.some((metric) => metric.id === 'fees_native')).toBe(false);
  for (const query of [
    'asset=SOL&metric=mvrv',
    'asset=LINK&metric=hashrate',
    'asset=DOGE&metric=unknown',
    'asset=DOGE&metric=mvrv&limit=1001',
    'asset=DOGE&metric=mvrv&cachebuster=1',
  ])
    expect((await call('network?' + query)).status).toBe(400);
});

it('loads more than 1,000 daily network observations through the public cursor contract into 2026', async () => {
  const start = Date.UTC(2019, 0, 1) / 1000,
    now = Math.floor(Date.now() / 1000);
  const values = Array.from({ length: 2600 }, (_, i) => ({
    time: start + i * DAY,
    values: { mvrv: 1 + i / 1000, price: 10 + i },
  }));
  const months = new Map();
  for (const row of values) {
    const date = new Date(row.time * 1000),
      bucket = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
    if (!months.has(bucket)) months.set(bucket, []);
    months.get(bucket).push(row);
  }
  for (const [bucket, rows] of months)
    DB.sqlite
      .prepare('INSERT INTO network_months(asset,bucket,payload,fetched_at) VALUES(?,?,?,?)')
      .run('DOGE', bucket, JSON.stringify(rows), now);
  for (const metric of ['mvrv', 'price'])
    DB.sqlite
      .prepare(
        'INSERT INTO network_coverage(asset,metric,first,last,observations,fetched_at) VALUES(?,?,?,?,?,?)',
      )
      .run('DOGE', metric, start, values.at(-1).time, values.length, now);
  DB.sqlite
    .prepare('INSERT INTO ingestion(key,last_attempt,last_success,data_as_of) VALUES(?,?,?,?)')
    .run('network:DOGE', now, now, values.at(-1).time);
  const first = await (await call('network?asset=DOGE&metric=mvrv&limit=1000')).json();
  expect(first.data).toHaveLength(1000);
  expect(first.nextCursor).toBe(start + 1000 * DAY);
  const before = DB.sqlite.prepare('SELECT total_changes() n').get().n;
  vi.stubGlobal('fetch', (url) => call(String(url).replace('/api/v1/', '')));
  const all = await pages('/api/v1/network?asset=DOGE&metric=mvrv&limit=1000');
  expect(all.data).toEqual(values.map((row) => ({ time: row.time, value: row.values.mvrv })));
  expect(new Date(all.data.at(-1).time * 1000).getUTCFullYear()).toBe(2026);
  expect(all.meta.dataAsOf).toBe(values.at(-1).time);
  expect(all.nextCursor).toBeNull();
  expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(before);
});

it('schedules independent network collection hourly and respects explicit catchup/backoff checkpoints', () => {
  const now = Math.floor(Date.now() / 1000),
    job = jobPolicies(['DOGE'], false).find((item) => item.key === 'network:DOGE');
  const source = {
    key: job.key,
    last_attempt: now,
    last_success: now,
    data_as_of: now - DAY,
    next_attempt: 0,
  };
  expect(job).toMatchObject({ kind: 'network', every: 3600, maxLag: 3 * DAY });
  expect(dueAt(job, [source], now)).toBe(now + 3600);
  source.next_attempt = now + 60;
  expect(dueAt(job, [source], now)).toBe(now + 60);
  source.next_attempt = now + 3600;
  expect(dueAt(job, [source], now)).toBe(now + 3600);
});
