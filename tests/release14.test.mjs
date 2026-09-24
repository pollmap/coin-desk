import { it, expect, vi, afterEach } from 'vitest';
import { openDatabase } from '../scripts/local-db.mjs';
import { getDominance, DOMINANCE_VERSION, updateDominance } from '../worker/dominance';
import { selectJob } from '../worker/health';
import feed from '../worker/market-feed';
import { turnover } from '../src/lib';

it('uses readable KRW denominations without converting USDT to USD', () => {
  expect(turnover(55414000000, 'KRW')).toBe('554.1억 원');
  expect(turnover(1200000000000, 'KRW')).toBe('1.20조 원');
  expect(turnover(55414000, 'USDT')).toBe('55.41M USDT');
  expect(turnover(null, 'KRW')).toBe('—');
});

afterEach(() => vi.unstubAllGlobals());
it('returns the last dominance without waiting for upstream or writing during a page request', async () => {
  const DB = openDatabase(':memory:');
  try {
    const now = Math.floor(Date.now() / 1000);
    const data = {
      calculationVersion: DOMINANCE_VERSION,
      coins: [],
      asOf: now - 8000,
      fetchedAt: now - 8000,
    };
    DB.sqlite.prepare('INSERT INTO state VALUES(?,?)').run('dominance', JSON.stringify(data));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const value = await getDominance({ DB }, false);
    expect(value.stale).toBe(true);
    expect(value.asOf).toBe(data.asOf);
    expect(fetcher).not.toHaveBeenCalled();
    expect(DB.sqlite.prepare('SELECT COUNT(*) n FROM ingestion').get().n).toBe(0);
  } finally {
    DB.sqlite.close();
  }
});
it('services overdue shared data before secondary backfill and still respects failure backoff', () => {
  const now = 1800000000;
  const market = { key: 'coinlore', kind: 'dominance', every: 3600, maxLag: 7200 };
  const primary = {
    key: 'network:BTC',
    kind: 'network',
    every: 21600,
    maxLag: 259200,
    assets: ['BTC'],
  };
  const secondary = { ...primary, key: 'network:SOL', assets: ['SOL'] };
  const state = {
    key: 'coinlore',
    last_attempt: now - 4000,
    data_as_of: now - 4000,
    failures: 1,
    next_attempt: now - 400,
  };
  expect(selectJob([secondary, primary, market], [state], now).key).toBe('coinlore');
  expect(
    selectJob([secondary, primary, market], [{ ...state, next_attempt: now + 60 }], now).key,
  ).toBe('network:BTC');
  expect(
    selectJob([secondary, primary, market], [{ ...state, next_attempt: now - 10 }], now).key,
  ).toBe('network:BTC');
});
it('keeps the CoinLore adapter authenticated and rejects user-supplied target URLs', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await feed.fetch(new Request('https://feed.test/coinlore'), { FEED_TOKEN: 'test' })).status,
  ).toBe(401);
  expect(
    (
      await feed.fetch(
        new Request('https://feed.test/coinlore?url=https://other.test', {
          headers: { 'X-Feed-Token': 'test' },
        }),
        { FEED_TOKEN: 'test' },
      )
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it('validates regional market data before storing a new dominance observation', async () => {
  const DB = openDatabase(':memory:');
  try {
    const fetcher = vi.fn(async () =>
      Response.json({
        global: [{ total_mcap: 100 }],
        markets: [{ id: '90', symbol: 'BTC', market_cap_usd: 101 }],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      updateDominance({ DB, FEED_URL: 'https://feed.test', FEED_TOKEN: 'test' }),
    ).rejects.toThrow('Invalid market cap');
    expect(fetcher.mock.calls[0][0]).toBe('https://feed.test/coinlore');
    expect(DB.sqlite.prepare('SELECT COUNT(*) n FROM dominance_history').get().n).toBe(0);
  } finally {
    DB.sqlite.close();
  }
});
