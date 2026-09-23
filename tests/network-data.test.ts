import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
// @ts-expect-error JavaScript-only local development SQLite adapter.
import { openDatabase } from '../scripts/local-db.mjs';
import { DAY } from '../shared/math';
import { networkMetrics, networkUnit, type NetworkAsset } from '../shared/network-catalog';
import {
  networkMonth,
  networkSourceMetrics,
  parseNetwork,
  decimalDifference,
  readNetworkSeries,
  updateNetworkData,
} from '../worker/network-data';
import type { Env } from '../worker/storage';

const start = Date.UTC(2009, 0, 3) / 1000;
const now = Date.UTC(2026, 8, 20) / 1000;
const raw = (time: number, asset: NetworkAsset = 'BTC', changes: Record<string, unknown> = {}) => ({
  asset: asset.toLowerCase(),
  time: new Date(time * 1000).toISOString(),
  ...Object.fromEntries(
    networkSourceMetrics(asset).map((key) => [
      key,
      key === 'PriceUSD'
        ? '10'
        : key === 'CapMrktCurUSD'
          ? '1000'
          : key === 'CapMVRVCur'
            ? '2'
            : '0',
    ]),
  ),
  ...changes,
});

describe('free network metric definitions and normalization', () => {
  it('subtracts large exchange decimals before float conversion', () => {
    expect(decimalDifference('593183.075487895027779039', '593197.4758625682507349'))
      .toBeCloseTo(-14.400374673222956, 12);
    expect(decimalDifference('1.20', '1.2')).toBe(0);
  });
  it('registers actual free availability and chain-specific units, without inventing unsupported token fees', () => {
    expect(
      ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'].map(
        (asset) => networkMetrics(asset as NetworkAsset).length,
      ),
    ).toEqual([18, 14, 17, 11, 10]);
    expect(networkMetrics('SOL')).toEqual([]);
    expect(networkUnit('DOGE', 'fees_native')).toBe('DOGE / 일');
    expect(networkUnit('BTC', 'hashrate')).toBe('TH/s');
    expect(networkMetrics('LINK').find((item) => item.id === 'fees_native')).toBeUndefined();
    expect(
      networkMetrics('DOGE')
        .filter((item) => item.derived)
        .map((item) => item.id),
    ).toEqual(['realized_cap', 'realized_price', 'nupl']);
  });

  it('retains zero observations, omits nulls and derives only from the same dated source', () => {
    const rows = parseNetwork(
      { data: [raw(start, 'BTC', { PriceUSD: null }), raw(start + DAY)] },
      'BTC',
      now,
    );
    expect(rows[0].values.active_addresses).toBe(0);
    expect(rows[0].values.price).toBeUndefined();
    expect(rows[0].values.realized_price).toBeUndefined();
    expect(rows[1].values).toMatchObject({
      realized_cap: 500,
      realized_price: 5,
      nupl: 0.5,
      fees_native: 0,
    });
    const zero = parseNetwork({ data: [raw(start, 'BTC', { CapMVRVCur: '0' })] }, 'BTC', now)[0];
    expect(zero.values.mvrv).toBe(0);
    expect(zero.values.nupl).toBeUndefined();
    expect(zero.values.realized_cap).toBeUndefined();
    expect(
      parseNetwork({ data: [raw(start, 'BTC', { CapMVRVCur: '0.5' })] }, 'BTC', now)[0].values.nupl,
    ).toBe(-1);
  });

  it('accepts exactly closed UTC dates but excludes the still-open daily observation', () => {
    expect(
      parseNetwork({ data: [raw(now), raw(now - DAY)] }, 'BTC', now).map((row) => row.time),
    ).toEqual([now - DAY]);
    expect(parseNetwork({ data: [raw(now - DAY)] }, 'BTC', now - 1)).toEqual([]);
  });

  it('rejects malformed source payloads before writing any partial month', () => {
    for (const input of [
      null,
      { data: {} },
      { data: [raw(start), raw(start)] },
      { data: [raw(start + 1)] },
      { data: [raw(start, 'DOGE')] },
      { data: [raw(start, 'BTC', { TxCnt: '' })] },
      { data: [raw(start, 'BTC', { TxCnt: true })] },
      { data: [raw(start, 'BTC', { TxCnt: '-1' })] },
      { data: [raw(start, 'BTC', { HashRate: 'Infinity' })] },
      { data: [raw(start, 'BTC', { PriceUSD: '0' })] },
      { data: [raw(start, 'BTC', { CapMVRVCur: 'NaN' })] },
      { data: [raw(start, 'BTC', { CapMVRVCur: undefined })] },
    ])
      expect(() => parseNetwork(input, 'BTC', now)).toThrow();
    const missing = raw(start) as Record<string, unknown>;
    delete missing.HashRate;
    expect(() => parseNetwork({ data: [missing] }, 'BTC', now)).toThrow('Missing');
  });
});

describe('monthly network storage against actual SQLite', () => {
  let db: { sqlite: DatabaseSync } & D1Database;
  let env: Env;
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    db = openDatabase(':memory:');
    env = {
      DB: db,
      ENABLED_ASSETS: 'BTC,DOGE,ETH,XRP,LINK',
      BITVIEW_BASE_URL: 'https://bitview.space',
      ASSETS: {} as Fetcher,
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db.sqlite.close();
  });
  const source = (data: unknown[], next = false) => {
    const fetcher = vi.fn(async (_url: string) =>
      Response.json({ data, ...(next ? { next_page_token: 'opaque' } : {}) }),
    );
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  };

  it('writes a sixty-day page in monthly chunks, atomically advances a cursor and accurately counts zero values', async () => {
    const fetcher = source(
      Array.from({ length: 60 }, (_, index) => raw(start + index * DAY)),
      true,
    );
    await updateNetworkData(env, 'BTC');
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM network_months').get()?.n).toBe(3);
    expect(
      db.sqlite
        .prepare("SELECT observations FROM network_coverage WHERE metric='active_addresses'")
        .get()?.observations,
    ).toBe(60);
    expect(
      db.sqlite.prepare("SELECT value FROM state WHERE key='network-cursor:BTC'").get()?.value,
    ).toBe(String(start + 60 * DAY));
    expect(
      db.sqlite
        .prepare("SELECT data_as_of,next_attempt FROM ingestion WHERE key='network:BTC'")
        .get(),
    ).toMatchObject({ data_as_of: start + 59 * DAY, next_attempt: now + 60 });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get('page_size')).toBe('60');
    expect(url.searchParams.get('start_time')).toBe(new Date(start * 1000).toISOString());
  });

  it('re-reading unchanged source days preserves month timestamps and coverage counts; a source revision replaces its value', async () => {
    source([raw(start), raw(start + DAY)]);
    await updateNetworkData(env, 'BTC');
    const initial = db.sqlite.prepare('SELECT * FROM network_months').all();
    const coverage = db.sqlite.prepare('SELECT * FROM network_coverage ORDER BY metric').all();
    vi.spyOn(Date, 'now').mockReturnValue((now + 60) * 1000);
    await updateNetworkData(env, 'BTC');
    expect(db.sqlite.prepare('SELECT * FROM network_months').all()).toEqual(initial);
    expect(db.sqlite.prepare('SELECT * FROM network_coverage ORDER BY metric').all()).toEqual(
      coverage,
    );
    source([raw(start, 'BTC', { CapMVRVCur: '4' }), raw(start + DAY)]);
    await updateNetworkData(env, 'BTC');
    const result = await readNetworkSeries(db, 'BTC', 'realized_price', 0, now, 1000);
    expect(result.data).toEqual([
      { time: start, value: 2.5 },
      { time: start + DAY, value: 5 },
    ]);
    expect(result.meta.warning).toContain('역산');
    expect(result.meta.historyStart).toBe(start);
  });

  it('fails closed when the source retracts existing valid values or a later page is malformed', async () => {
    source([raw(start), raw(start + DAY)]);
    await updateNetworkData(env, 'BTC');
    const snapshot = db.sqlite.prepare('SELECT * FROM network_months').all();
    const ingestion = db.sqlite.prepare('SELECT * FROM ingestion').all();
    source([raw(start, 'BTC', { CapMVRVCur: null }), raw(start + DAY)]);
    await expect(updateNetworkData(env, 'BTC')).rejects.toThrow('removed');
    expect(db.sqlite.prepare('SELECT * FROM network_months').all()).toEqual(snapshot);
    expect(db.sqlite.prepare('SELECT * FROM ingestion').all()).toEqual(ingestion);
    source([raw(start), raw(start + DAY, 'BTC', { HashRate: -1 })]);
    await expect(updateNetworkData(env, 'BTC')).rejects.toThrow();
    expect(db.sqlite.prepare('SELECT * FROM network_months').all()).toEqual(snapshot);
  });

  it('preserves data and ingestion on HTTP errors and empty source pages', async () => {
    source([raw(start)]);
    await updateNetworkData(env, 'BTC');
    const snapshot = db.sqlite.prepare('SELECT * FROM ingestion').all();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );
    await expect(updateNetworkData(env, 'BTC')).rejects.toThrow('429');
    source([]);
    await expect(updateNetworkData(env, 'BTC')).rejects.toThrow('Empty');
    expect(db.sqlite.prepare('SELECT * FROM ingestion').all()).toEqual(snapshot);
  });

  it('uses inclusive from/exclusive to, aligns USD prices and returns actual full metric coverage even on a short page', async () => {
    source([
      raw(start, 'BTC', { CapMVRVCur: null, PriceUSD: null }),
      raw(start + DAY),
      raw(start + 3 * DAY),
      raw(start + 4 * DAY),
    ]);
    await updateNetworkData(env, 'BTC');
    const first = await readNetworkSeries(db, 'BTC', 'mvrv', 0, start + 4 * DAY, 1);
    expect(first.data).toEqual([{ time: start + DAY, value: 2 }]);
    expect(first.price).toEqual([{ time: start + DAY, value: 10 }]);
    expect(first.meta).toMatchObject({
      historyStart: start + DAY,
      dataAsOf: start + 4 * DAY,
      stale: true,
    });
    expect(first.nextCursor).toBe(start + 2 * DAY);
    const second = await readNetworkSeries(
      db,
      'BTC',
      'mvrv',
      first.nextCursor!,
      start + 4 * DAY,
      1000,
    );
    expect(second.data).toEqual([{ time: start + 3 * DAY, value: 2 }]);
    expect(second.nextCursor).toBeNull();
  });

  it('flags collector staleness independently of a recent metric date', async () => {
    const time = now - 2 * DAY;
    db.sqlite
      .prepare('INSERT INTO network_months VALUES(?,?,?,?)')
      .run('BTC', networkMonth(time), JSON.stringify([{ time, values: { mvrv: 1 } }]), now);
    db.sqlite
      .prepare('INSERT INTO network_coverage VALUES(?,?,?,?,?,?)')
      .run('BTC', 'mvrv', time, time, 1, now - 8 * 3600);
    const stale = await readNetworkSeries(db, 'BTC', 'mvrv', 0, now, 1000);
    expect(stale.meta.stale).toBe(true);
    const empty = await readNetworkSeries(db, 'DOGE', 'mvrv', 0, now, 1000);
    expect(empty.data).toEqual([]);
    expect(empty.meta).toMatchObject({ historyStart: null, dataAsOf: null, stale: true });
  });

  it('rejects unsupported metrics and corrupt stored months without returning fabricated points', async () => {
    await expect(readNetworkSeries(db, 'LINK', 'fees_native', 0, now, 1000)).rejects.toThrow();
    await expect(readNetworkSeries(db, 'BTC', 'mvrv', 0, now, 1001)).rejects.toThrow();
    source([raw(start)]);
    await updateNetworkData(env, 'BTC');
    db.sqlite
      .prepare('UPDATE network_months SET payload=?')
      .run(JSON.stringify([{ time: start, values: { mvrv: 'bad' } }]));
    await expect(readNetworkSeries(db, 'BTC', 'mvrv', 0, now, 1000)).rejects.toThrow('stored');
  });
});
