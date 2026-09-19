import { it, expect, vi, afterEach } from 'vitest';
import { openDatabase } from '../scripts/local-db.mjs';
import { candleHistory } from '../worker/candle-history';
import {
  normalizeDominance,
  normalizeStable,
  getDominance,
  lastArrayObject,
} from '../worker/dominance';
import { indicatorSpec, validIndicators } from '../shared/indicators';
import { ema, macd, bollinger } from '../shared/math';
import { money, priceDigits } from '../src/lib';
const now = Math.floor(Date.now() / 1000);
it('stable history tail extraction preserves nested values and quoted braces', () => {
  const last = {
    date: '123',
    note: 'a brace { and a quote " and backslash \\',
    totalCirculatingUSD: { peggedUSD: 42 },
  };
  expect(lastArrayObject(JSON.stringify([{ date: '1' }, last], null, 2))).toEqual(last);
  expect(() => lastArrayObject('[]')).toThrow();
  expect(() => lastArrayObject('{}')).toThrow();
});
const ids = ['90', '2', '80', '48543', '58', '2751', '121611', '93841', '518', '33285'];
const symbols = ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE', 'USDT', 'USDC'];
const caps = () => [
  [{ total_mcap: 10000 }],
  ids.map((id, i) => ({ id, symbol: symbols[i], market_cap_usd: String(100 * (10 - i)) })),
  { marketCap: 1000, asOf: now - 3600, fetchedAt: now },
];
afterEach(() => vi.restoreAllMocks());
it('dominance uses the same coin/global source and labels the daily stablecoin estimate', () => {
  const result = normalizeDominance(...caps(), now);
  expect(result.coins.find((c) => c.id === 'DOGE').value).toBe(9);
  expect(result.coins.find((c) => c.id === 'STABLE')).toMatchObject({
    value: 10,
    source: 'DefiLlama / CoinLore',
    timeBasis: 'daily',
  });
  expect(result.coins.find((c) => c.id === 'USDT')).toMatchObject({
    value: 2,
    marketCap: 200,
    timeBasis: 'retrieved',
  });
  expect(result.stale).toBe(false);
});
it('rejects missing, mismatched, non-finite and future cap observations', () => {
  for (const mutate of [
    (c) => c[1].pop(),
    (c) => (c[1][1].symbol = 'BTC'),
    (c) => (c[0][0].total_mcap = NaN),
    (c) => (c[2].asOf = now + 1000),
  ]) {
    const data = caps();
    mutate(data);
    expect(() => normalizeDominance(...data, now)).toThrow();
  }
  const data = caps();
  data[2].asOf = now - 4 * 86400;
  expect(normalizeDominance(...data, now).stale).toBe(true);
});
it('stablecoin totals sum USD valuations rather than incompatible native currencies', () => {
  const row = {
    date: now,
    totalCirculatingUSD: { peggedUSD: 100, peggedEUR: 22 },
    totalCirculating: { peggedUSD: 100, peggedEUR: 20 },
  };
  expect(normalizeStable([row], now).marketCap).toBe(122);
  expect(() =>
    normalizeStable([{ ...row, totalCirculatingUSD: { peggedUSD: null } }], now),
  ).toThrow();
});
it('429 keeps the last real dominance and records a retry instead of a new observation', async () => {
  const DB = openDatabase(':memory:');
  try {
    const saved = { ...normalizeDominance(...caps(), now), fetchedAt: now - 4000 };
    DB.sqlite.prepare('INSERT INTO state VALUES(?,?)').run('dominance', JSON.stringify(saved));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );
    const out = await getDominance({ DB });
    expect(out.coins).toEqual(saved.coins);
    expect(out.stale).toBe(true);
    expect(DB.sqlite.prepare('SELECT COUNT(*) n FROM dominance_history').get().n).toBe(0);
    expect(
      DB.sqlite.prepare('SELECT next_attempt FROM ingestion WHERE key=?').get('coinlore')
        .next_attempt,
    ).toBeGreaterThan(now);
  } finally {
    DB.sqlite.close();
    vi.unstubAllGlobals();
  }
});
it('archive queries cross chunk boundaries without losing gaps and latest corrections win', async () => {
  const DB = openDatabase(':memory:');
  try {
    const make = (i) => [1704067200 + i * 86400, 10, 14, 8, 12, 5, 1704067200 + (i + 1) * 86400];
    const values = Array.from({ length: 1500 }, (_, i) => make(i));
    for (let i = 0; i < values.length; i += 256) {
      const c = values.slice(i, i + 256);
      DB.sqlite
        .prepare('INSERT INTO price_archive VALUES(?,?,?,?,?,?,?)')
        .run('DOGE', 'binance', '1d', c[0][0], c.at(-1)[6], JSON.stringify(c), now);
    }
    const corrected = make(510);
    corrected[4] = 13;
    DB.sqlite
      .prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('DOGE', 'binance', '1d', ...corrected, now + 1);
    const rows = await candleHistory(
      { DB },
      'DOGE',
      'binance',
      '1d',
      values[251][0],
      values.at(-1)[6],
      1001,
    );
    expect(rows).toHaveLength(1001);
    expect(rows[0].time).toBe(values[251][0]);
    expect(rows.at(-1).time).toBe(values[1251][0]);
    expect(rows.find((r) => r.time === corrected[0]).close).toBe(13);
    const tail = await candleHistory(
      { DB },
      'DOGE',
      'binance',
      '1d',
      rows.at(-1).close_time,
      values.at(-1)[6],
      1001,
    );
    expect(tail).toHaveLength(248);
    expect(tail[0].time).toBe(values[1252][0]);
  } finally {
    DB.sqlite.close();
  }
});
it('custom indicator URL values are bounded, deduplicated, and keep legacy presets', () => {
  expect(indicatorSpec('sma200w')).toMatchObject({ kind: 'sma', period: 200, basis: 'w' });
  expect(indicatorSpec('ema:55:d')).toMatchObject({ kind: 'ema', period: 55, basis: 'd' });
  expect(validIndicators(['sma200', 'sma:200:d', 'rsi', 'rsi:7:bar', 'bb:20:bar:2.5'])).toEqual([
    'sma200',
    'rsi',
    'bb:20:bar:2.5',
  ]);
  for (const id of [
    'sma:0:d',
    'ema:1001:d',
    'rsi:14:w',
    'bb:20:bar:99',
    'sma:12.5:d',
    'sma:20:d:2:extra',
    null,
  ])
    expect(indicatorSpec(id)).toBeNull();
});
it('EMA SMA seed and MACD match the analytical linear-trend solution', () => {
  const points = Array.from({ length: 80 }, (_, i) => ({ time: i, value: i + 1 }));
  expect(ema(points, 20)[0]).toEqual({ time: 19, value: 10.5 });
  expect(ema(points, 20).at(-1).value).toBeCloseTo(70.5, 12);
  const m = macd(points);
  expect(m.line[0].time).toBe(25);
  expect(m.signal[0].time).toBe(33);
  m.line.forEach((p) => expect(p.value).toBeCloseTo(7, 12));
  m.histogram.forEach((p) => expect(p.value).toBeCloseTo(0, 12));
  const b = bollinger(points, 2, 3);
  expect(b.upper[0].value).toBe(3);
  expect(b.lower[0].value).toBe(0);
});
it('small DOGE and PEPE prices preserve meaningful digits in USD and KRW', () => {
  expect(money(0.091234)).toBe('$0.09123');
  expect(money(0.00542, 'KRW')).toBe('₩0.00542000');
  expect(priceDigits(0.00000001)).toBeGreaterThanOrEqual(8);
  expect(money(123, 'KRW')).toBe('₩123');
  expect(money(-0.5)).toBe('$-0.50000');
});
