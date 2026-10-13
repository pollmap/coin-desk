import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { themeMarket } from '../worker/theme-market';
import { ASSET_REGISTRY, supportsMarket } from '../shared/asset-registry';
import { MARKET_MATRIX_VERSION } from '../shared/market-matrix';
import { DAY } from '../shared/math';
import { memoryCache, openDatabase } from '../scripts/local-db.mjs';

const basisDay = 21000 * DAY;
const now = basisDay + DAY + 3600;
let DB, env, waiting;
function seed(asset, market = 'binance', closes, volumes) {
  const rows = Array.from({ length: 8 }, (_, i) => {
    const time = basisDay - (7 - i) * DAY;
    const close = closes?.[i] ?? 100 + 10 * i;
    return {
      asset,
      market,
      interval: '1d',
      time,
      open: close,
      high: close,
      low: close,
      close,
      volume: volumes?.[i] ?? i + 1,
      close_time: time + DAY,
      fetched_at: now,
    };
  });
  const insert = DB.sqlite.prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for (const row of rows) insert.run(...Object.values(row));
  return rows;
}
const call = (query = 'market=binance', method = 'GET') =>
  worker.fetch(
    new Request('https://unit.test/api/v1/theme-market' + (query ? '?' + query : ''), { method }),
    env,
    { waitUntil: (task) => waiting.push(task) },
  );
beforeEach(() => {
  DB = openDatabase(':memory:');
  env = { DB, READ_ONLY_API: true, ENABLED_ASSETS: ASSET_REGISTRY.map((a) => a.id).join(',') };
  waiting = [];
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  vi.stubGlobal('caches', { default: memoryCache() });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected collection');
    }),
  );
});
afterEach(async () => {
  await Promise.all(waiting);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  DB.sqlite.close();
});

describe('Read-only confirmed daily theme market endpoint', () => {
  it('returns independently calculable seven-day return and base-volume median ratio', async () => {
    seed('DOGE');
    const before = DB.sqlite.prepare('SELECT total_changes() n').get().n;
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = await response.json();
    expect(result).toMatchObject({
      definitionVersion: MARKET_MATRIX_VERSION,
      market: 'binance',
      currency: 'USDT',
      asOf: now,
      basisDay,
      xMode: 'return7d',
      benchmark: null,
    });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      asset: 'DOGE',
      x: 70,
      y: 2,
      return7d: 70,
      latestVolume: 8,
      medianPriorVolume: 4,
      quadrant: 'up-high',
    });
    const meme = result.themes.points.find((p) => p.id === 'memes');
    expect(meme).toMatchObject({ members: ['DOGE'], usableMembers: 1, x: 70, y: 2 });
    expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['upbit', 'binance'])(
    'uses one indexed batch for every enabled %s asset',
    async (market) => {
      const supported = ASSET_REGISTRY.filter((a) => supportsMarket(a.id, market)).map((a) => a.id);
      for (const asset of supported) seed(asset, market);
      const spy = vi.spyOn(DB, 'prepare');
      const result = await (await call('market=' + market)).json();
      expect(result.points.map((p) => p.asset)).toEqual(supported);
      expect(result.points.every((p) => p.x === 70 && p.y === 2)).toBe(true);
      expect(result.excluded).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
      const sql = spy.mock.calls[0][0];
      expect(sql).toContain('FROM candles');
      expect(sql).toContain('json_each(?)');
      expect(sql).not.toMatch(/archive|snapshot|ingestion|INSERT|UPDATE|DELETE/i);
      const plan = DB.sqlite
        .prepare('EXPLAIN QUERY PLAN ' + sql)
        .all(
          JSON.stringify(supported),
          market,
          ...Array.from({ length: 8 }, (_, i) => basisDay - (7 - i) * DAY),
          now,
          supported.length * 8 + 1,
        );
      expect(
        plan.some((row) =>
          /SEARCH candles USING INDEX sqlite_autoindex_candles_1/.test(row.detail),
        ),
      ).toBe(true);
    },
  );

  it('does not substitute another market, disabled asset or unlisted asset', async () => {
    seed('DOGE', 'binance');
    seed('BNB', 'upbit'); // Deliberately invalid local fixture: BNB has no Upbit listing.
    seed('BTC', 'upbit');
    env.ENABLED_ASSETS = 'DOGE,BNB';
    const response = await call('market=upbit');
    const result = await response.json();
    expect(response.status).toBe(200); // Disabled default BTC must not gate the whole-market endpoint.
    expect(result.currency).toBe('KRW');
    expect(result.points).toEqual([]);
    expect(result.excluded.map((p) => p.asset)).toEqual(['DOGE']);
    expect((await (await call()).json()).points.map((p) => p.asset)).toEqual(['DOGE']);
  });

  it('requires the common latest complete day without interpolation or older-day fallback', async () => {
    seed('BTC');
    seed('DOGE');
    seed('ETH');
    DB.sqlite
      .prepare('DELETE FROM candles WHERE asset=? AND time=?')
      .run('DOGE', basisDay - 3 * DAY);
    DB.sqlite
      .prepare('UPDATE candles SET close_time=? WHERE asset=? AND time=?')
      .run(now + 1, 'ETH', basisDay);
    DB.sqlite
      .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        'BTC',
        'binance',
        '1d',
        basisDay + DAY,
        999,
        999,
        999,
        999,
        999,
        basisDay + 2 * DAY,
        now,
      );
    const result = await (await call()).json();
    expect(result.points.map((p) => p.asset)).toEqual(['BTC']);
    expect(result.points[0]).toMatchObject({ basisDay, x: 70, y: 2 });
    expect(result.excluded.find((p) => p.asset === 'DOGE')).toMatchObject({
      reason: 'missing-day',
      missingDays: [basisDay - 3 * DAY],
    });
    expect(result.excluded.find((p) => p.asset === 'ETH')).toMatchObject({
      reason: 'missing-day',
      missingDays: [basisDay],
    });
  });

  it('accepts a real zero latest volume and excludes zero baseline or invalid OHLC', async () => {
    seed('BTC', 'binance', undefined, [1, 2, 3, 4, 5, 6, 7, 0]);
    seed('DOGE', 'binance', undefined, [0, 0, 0, 0, 1, 2, 3, 8]);
    seed('ETH');
    seed('SOL');
    DB.sqlite.prepare('UPDATE candles SET high=1 WHERE asset=? AND time=?').run('ETH', basisDay);
    DB.sqlite.prepare('UPDATE candles SET volume=-1 WHERE asset=? AND time=?').run('SOL', basisDay);
    const result = await (await call()).json();
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ asset: 'BTC', y: 0 });
    expect(result.excluded.find((p) => p.asset === 'DOGE').reason).toBe('zero-baseline-volume');
    expect(result.excluded.find((p) => p.asset === 'ETH').reason).toBe('invalid-candle');
    expect(result.excluded.find((p) => p.asset === 'SOL').reason).toBe('invalid-candle');
  });

  it('ignores stale current quotes because the calculation uses confirmed daily observations', async () => {
    seed('BTC');
    DB.sqlite
      .prepare('INSERT INTO snapshots VALUES(?,?,?)')
      .run(
        'quote:BTC:binance',
        JSON.stringify({ asset: 'BTC', price: 99999, time: now - 99999 }),
        now,
      );
    const result = await (await call()).json();
    expect(result.points[0]).toMatchObject({ asset: 'BTC', return7d: 70, x: 70, y: 2 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reflects source corrections immediately instead of serving an old cached matrix', async () => {
    seed('BTC');
    const match = vi.spyOn(caches.default, 'match');
    const put = vi.spyOn(caches.default, 'put');
    expect((await (await call()).json()).points[0].x).toBe(70);
    DB.sqlite
      .prepare('UPDATE candles SET open=?,high=?,low=?,close=?,volume=? WHERE asset=? AND time=?')
      .run(200, 200, 200, 200, 16, 'BTC', basisDay);
    const corrected = await (await call()).json();
    expect(corrected.points[0]).toMatchObject({ x: 100, y: 4 });
    expect(match).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects unknown, repeated and oversized query values and all writing methods', async () => {
    const spy = vi.spyOn(DB, 'prepare');
    for (const query of [
      'market=other',
      'market=upbit&market=binance',
      'asset=BTC',
      'period=7d',
      'source=upbit',
      'market=',
      'market=UPBIT',
      'market=upbit%27',
      'q=' + 'a'.repeat(2050),
    ]) {
      expect((await call(query)).status, query).toBe(400);
    }
    for (const method of ['POST', 'PUT', 'DELETE'])
      expect((await call('', method)).status).toBe(405);
    expect(spy).not.toHaveBeenCalled();
    expect((await call('')).status).toBe(200); // Missing market keeps legacy Binance default.
  });

  it('isolates impossible duplicate rows and blocks unexpected asset identities from the adapter', async () => {
    const rows = seed('BTC');
    vi.spyOn(DB, 'prepare').mockReturnValue({
      bind: () => ({
        all: async () => ({
          results: [...rows, rows[0]],
        }),
      }),
    });
    const duplicates = await themeMarket(env, 'binance');
    expect(duplicates.points).toEqual([]);
    expect(duplicates.excluded.find((p) => p.asset === 'BTC').reason).toBe('duplicate-day');
    DB.prepare.mockReturnValue({
      bind: () => ({
        all: async () => ({
          results: [{ ...rows[0], asset: 'NOT_AN_ASSET' }],
        }),
      }),
    });
    const bad = await call();
    expect(bad.status).toBe(503);
    const body = await bad.json();
    expect(body.code).toBe('SOURCE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('NOT_AN_ASSET');
  });

  it('returns no fabricated observations and performs no query when no supported asset is enabled', async () => {
    env.ENABLED_ASSETS = '';
    const spy = vi.spyOn(DB, 'prepare');
    const result = await (await call()).json();
    expect(result.points).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.themes.points).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
