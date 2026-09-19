import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDatabase } from '../scripts/local-db.mjs';
vi.mock('../worker/providers', () => ({
  bitviewPage: vi.fn(),
  getRecentCandles: vi.fn(),
  getQuote: vi.fn(),
}));
import { bitviewPage, getRecentCandles } from '../worker/providers';
import { scheduled } from '../worker/scheduled';
const now = Math.floor(Date.now() / 1000);
let DB, env;
beforeEach(() => {
  DB = openDatabase(':memory:');
  env = { DB, ENABLED_ASSETS: 'BTC', BITVIEW_BASE_URL: 'https://bitview.space' };
  for (const key of [
    'bitview',
    'coinlore',
    'defillama',
    'BTC:binance:1h',
    'BTC:binance:1d',
    'BTC:upbit:1h',
    'BTC:upbit:1d',
    'maintenance',
  ])
    DB.sqlite
      .prepare('INSERT INTO ingestion(key,last_attempt,last_success,data_as_of) VALUES(?,?,?,?)')
      .run(key, now, now, now);
});
afterEach(() => {
  vi.clearAllMocks();
  DB.sqlite.close();
});
const state = (key, value) =>
  DB.sqlite.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(key, JSON.stringify(value));
it('a source rebuild keeps published generation until complete', async () => {
  state('onchain_generation', 'old');
  state('onchain_build', {
    generation: 'new',
    cursor: 0,
    versions: null,
    n: 0,
    mean: 0,
    m2: 0,
    start: null,
  });
  DB.sqlite.prepare('UPDATE ingestion SET last_attempt=? WHERE key=?').run(now - 3600, 'bitview');
  bitviewPage.mockResolvedValue({
    rows: [{ time: 1704067200, data: { market_cap: 100, realized_cap: 80, mvrv: 1.3, nupl: 0.2 } }],
    versions: { price: 1 },
    next: 1,
    finished: false,
    raw: [],
  });
  await scheduled(env);
  expect(
    JSON.parse(
      (await DB.prepare('SELECT value FROM state WHERE key=?').bind('onchain_generation').first())
        .value,
    ),
  ).toBe('old');
  const built = await DB.prepare('SELECT data FROM onchain WHERE generation=?').bind('new').first();
  expect(JSON.parse(built.data)).toMatchObject({
    mvrv: 1.25,
    mvrv_source: 1.3,
    nupl: 0.2,
    mvrv_z: null,
  });
  DB.sqlite.prepare('UPDATE ingestion SET last_attempt=? WHERE key=?').run(now - 120, 'bitview');
  bitviewPage.mockResolvedValue({
    rows: [],
    versions: { price: 1 },
    next: 1,
    finished: true,
    raw: [],
  });
  await scheduled(env);
  expect(
    JSON.parse(
      (await DB.prepare('SELECT value FROM state WHERE key=?').bind('onchain_generation').first())
        .value,
    ),
  ).toBe('new');
  expect(
    await DB.prepare('SELECT value FROM state WHERE key=?').bind('onchain_build').first(),
  ).toBeNull();
});
it('a failed source backoff does not starve overdue price work', async () => {
  state('onchain_build', {
    generation: 'new',
    cursor: 0,
    versions: null,
    n: 0,
    mean: 0,
    m2: 0,
    start: null,
  });
  DB.sqlite
    .prepare('UPDATE ingestion SET last_attempt=?,next_attempt=? WHERE key=?')
    .run(now - 3600, now + 3600, 'bitview');
  DB.sqlite
    .prepare('UPDATE ingestion SET last_attempt=? WHERE key=?')
    .run(now - 3601, 'BTC:binance:1h');
  const row = {
    time: now - 3600,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
    closeTime: now,
    closed: true,
  };
  getRecentCandles.mockResolvedValue([row]);
  await scheduled(env);
  expect(bitviewPage).not.toHaveBeenCalled();
  expect(getRecentCandles).toHaveBeenCalledTimes(1);
  expect((await DB.prepare('SELECT COUNT(*) AS n FROM candles').first()).n).toBe(1);
});
it('outage recovery asks from the stored boundary', async () => {
  DB.sqlite
    .prepare('UPDATE ingestion SET last_attempt=?,data_as_of=? WHERE key=?')
    .run(now - 120, now - 3 * 86400, 'BTC:binance:1h');
  const old = Math.floor((now - 3 * 86400) / 3600) * 3600;
  DB.sqlite
    .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('BTC', 'binance', '1h', old, 100, 110, 90, 105, 1, old + 3600, old);
  getRecentCandles.mockResolvedValue([
    {
      time: old + 3600,
      open: 105,
      high: 115,
      low: 95,
      close: 110,
      volume: 2,
      closeTime: old + 7200,
      closed: true,
    },
  ]);
  await scheduled(env);
  expect(getRecentCandles).toHaveBeenCalledWith('BTC', 'binance', '1h', old - 7200);
});
