import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDatabase } from '../scripts/local-db.mjs';
vi.mock('../worker/providers', () => ({
  bitviewPage: vi.fn(),
  getRecentCandles: vi.fn(),
  getQuote: vi.fn(),
  getQuotes: vi.fn(),
}));
import { bitviewPage, getRecentCandles } from '../worker/providers';
import { scheduled, updatePrice } from '../worker/scheduled';
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
    'quotes:binance:0',
    'quotes:upbit:0',
    'reference:BTC',
    'network:BTC',
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
  await scheduled(env, now - 60);
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
it('unchanged source candles do not rewrite history, but corrections replace the stored value', async () => {
  const time = Math.floor(now / 3600) * 3600 - 3600;
  DB.sqlite
    .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('BTC', 'binance', '1h', time, 100, 110, 90, 105, 1, time + 3600, 1);
  const candle = {
    time,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
    closeTime: time + 3600,
    closed: true,
  };
  getRecentCandles.mockResolvedValue([candle]);
  await updatePrice(env, 'BTC', 'binance', '1h');
  expect(DB.sqlite.prepare('SELECT fetched_at FROM candles').get().fetched_at).toBe(1);
  getRecentCandles.mockResolvedValue([{ ...candle, close: 106 }]);
  await updatePrice(env, 'BTC', 'binance', '1h');
  const stored = DB.sqlite.prepare('SELECT close,fetched_at FROM candles').get();
  expect(stored.close).toBe(106);
  expect(stored.fetched_at).toBeGreaterThanOrEqual(now);
});

const priceRow = (time, step = 86400, close = 105) => ({
  time,
  open: 100,
  high: 110,
  low: 90,
  close,
  volume: 1,
  closeTime: time + step,
  closed: true,
});
const storedHistory = (key) =>
  JSON.parse(DB.sqlite.prepare('SELECT value FROM state WHERE key=?').get('history:' + key).value);
it('price history metadata observes the committed upserts and retains unchanged older history', async () => {
  const day = Math.floor(now / 86400) * 86400 - 86400;
  DB.sqlite
    .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('BTC', 'binance', '1d', day - 10 * 86400, 100, 110, 90, 105, 1, day - 9 * 86400, 1);
  getRecentCandles.mockResolvedValue([priceRow(day - 86400), priceRow(day)]);
  await updatePrice(env, 'BTC', 'binance', '1d');
  expect(storedHistory('BTC:binance:1d')).toMatchObject({
    first: day - 10 * 86400,
    last: day,
    rows: 3,
    asset: 'BTC',
    market: 'binance',
    interval: '1d',
  });
  const ingestion = DB.sqlite
    .prepare('SELECT data_as_of,last_success,error FROM ingestion WHERE key=?')
    .get('BTC:binance:1d');
  expect(ingestion).toMatchObject({ data_as_of: day, error: null });
  expect(ingestion.last_success).toBeGreaterThanOrEqual(now);
  const raw = DB.sqlite.prepare('SELECT body FROM raw_samples WHERE id=?').get('BTC:binance:1d');
  expect(JSON.parse(raw.body).normalizedSourceSample).toEqual([
    priceRow(day - 86400),
    priceRow(day),
  ]);
});
it('archived daily metadata keeps original start and counts newly added days only once', async () => {
  const day = Math.floor(now / 86400) * 86400 - 86400;
  const key = 'DOGE:binance:1d';
  state('history:' + key, {
    first: day - 1000 * 86400,
    last: day - 86400,
    rows: 1000,
    archived: true,
  });
  DB.sqlite
    .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('DOGE', 'binance', '1d', day - 86400, 100, 110, 90, 105, 1, day, 1);
  getRecentCandles.mockResolvedValue([priceRow(day - 86400, 86400, 106), priceRow(day)]);
  await updatePrice(env, 'DOGE', 'binance', '1d');
  expect(storedHistory(key)).toMatchObject({
    first: day - 1000 * 86400,
    last: day,
    rows: 1001,
    archived: true,
  });
  await updatePrice(env, 'DOGE', 'binance', '1d');
  expect(storedHistory(key).rows).toBe(1001);
});
it('rolling archived hours retain an explicit unknown row count and advance the ninety-day floor', async () => {
  const hour = Math.floor(now / 3600) * 3600;
  const key = 'DOGE:upbit:1h';
  state('history:' + key, {
    first: hour - 120 * 86400,
    last: hour - 3600,
    rows: 2160,
    archived: true,
  });
  getRecentCandles.mockResolvedValue([priceRow(hour - 3600, 3600), priceRow(hour, 3600)]);
  const before = Math.ceil((Date.now() / 1000 - 90 * 86400) / 3600) * 3600;
  await updatePrice(env, 'DOGE', 'upbit', '1h');
  const history = storedHistory(key);
  expect(history).toMatchObject({ last: hour, rows: null, archived: true });
  expect(Object.hasOwn(history, 'rows')).toBe(true);
  expect(history.first).toBe(before);
});
it('an unknown archived daily count remains explicitly null', async () => {
  const day = Math.floor(now / 86400) * 86400;
  state('history:DOGE:upbit:1d', {
    first: day - 100 * 86400,
    last: day - 86400,
    rows: null,
    archived: true,
  });
  getRecentCandles.mockResolvedValue([priceRow(day)]);
  await updatePrice(env, 'DOGE', 'upbit', '1d');
  expect(storedHistory('DOGE:upbit:1d')).toMatchObject({
    first: day - 100 * 86400,
    last: day,
    rows: null,
    archived: true,
  });
});
it.each(['raw_samples', 'candles', 'state', 'ingestion'])(
  'a failed %s write rolls back the whole price publication',
  async (table) => {
    const key = 'BTC:binance:1d';
    const day = Math.floor(now / 86400) * 86400;
    DB.sqlite
      .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('BTC', 'binance', '1d', day - 86400, 100, 110, 90, 105, 1, day, 1);
    state('history:' + key, { first: day - 86400, last: day - 86400, rows: 1 });
    DB.sqlite
      .prepare('INSERT INTO raw_samples VALUES(?,?,?,?)')
      .run(key, key, 1, '{"previous":true}');
    const tables = ['raw_samples', 'candles', 'state', 'ingestion'];
    const before = tables.map((name) =>
      DB.sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all(),
    );
    // Table names come from the fixed test matrix, never external input.
    DB.sqlite.exec(
      `CREATE TRIGGER reject_publication BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;`,
    );
    getRecentCandles.mockResolvedValue([priceRow(day - 86400, 86400, 106), priceRow(day)]);
    await expect(updatePrice(env, 'BTC', 'binance', '1d')).rejects.toThrow(
      'simulated write failure',
    );
    expect(
      tables.map((name) => DB.sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()),
    ).toEqual(before);
  },
);
