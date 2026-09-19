import { describe, expect, it } from 'vitest';
import { compareCloses, parseComparisonRange } from '../shared/comparison';
import type { Asset, Candle } from '../shared/types';

const DAY = 86400;
const BASE = Date.parse('2025-01-01T00:00:00Z') / 1000;
const candles = (values: number[], offset = 0): Candle[] =>
  values.map((close, i) => ({
    time: BASE + (i + offset) * DAY,
    closeTime: BASE + (i + offset + 1) * DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closed: true,
  }));
const input = (asset: Asset, values: number[], offset = 0) => ({
  asset,
  candles: candles(values, offset),
});
const now = BASE + 1000 * DAY;

describe('common UTC close comparison', () => {
  it('uses one common starting date despite different listing dates and price scales', () => {
    const result = compareCloses(
      [input('BTC', [50, 100, 200, 150]), input('PEPE', [0.000001, 0.000003, 0.000002], 1)],
      'all',
      now,
    );
    expect(result.start).toBe(BASE + DAY);
    expect(result.rows.map((r) => r.points[0].value)).toEqual([100, 100]);
    expect(result.rows[0].returnPct).toBe(50);
    expect(result.rows[1].returnPct).toBeCloseTo(100);
    expect(result.rows[0].maxDrawdownPct).toBe(-25);
    expect(result.rows[1].maxDrawdownPct).toBeCloseTo(-100 / 3);
  });
  it('excludes unfinished, future, invalid close and non-daily bars', () => {
    const bad = candles([100, 120, 130, 140, 150, 160]);
    bad[2].closed = false;
    bad[3].close = 0;
    bad[4].time += 3600;
    const result = compareCloses(
      [{ asset: 'BTC', candles: bad }, input('DOGE', [1, 2, 3, 4, 5, 6])],
      'all',
      BASE + 5 * DAY,
    );
    expect(result.observations).toBe(2);
    expect(result.end).toBe(BASE + DAY);
    expect(result.rows[0].ignoredRows).toBe(4);
  });
  it('keeps gaps visible and disables volatility instead of treating multi-day changes as daily', () => {
    const a = candles(Array.from({ length: 31 }, (_, i) => 100 + i));
    a.splice(15, 1);
    const result = compareCloses(
      [{ asset: 'BTC', candles: a }, input('ETH', Array(31).fill(10))],
      '1m',
      now,
    );
    expect(result.missingCommonDays).toBe(1);
    expect(result.rows.map((r) => r.missingDays)).toEqual([1, 0]);
    expect(result.rows.every((r) => r.annualVolatilityPct === null)).toBe(true);
    expect(result.rows[0].points.some((p) => p.time === BASE + 15 * DAY)).toBe(false);
  });
  it('calculates sample volatility from log returns with 365 calendar days', () => {
    const values = [100];
    for (let i = 0; i < 20; i++) values.push(values.at(-1)! * Math.exp(i % 2 ? -0.01 : 0.01));
    const result = compareCloses(
      [input('BTC', values), input('DOGE', Array(21).fill(5))],
      'all',
      now,
    );
    expect(result.rows[0].annualVolatilityPct).toBeCloseTo(
      Math.sqrt(((20 * 0.01 ** 2) / 19) * 365) * 100,
      10,
    );
    expect(result.rows[1].annualVolatilityPct).toBe(0);
    expect(result.rows[1].maxDrawdownPct).toBe(0);
  });
  it('uses UTC calendar months including both endpoints and labels shorter history', () => {
    const full = compareCloses(
      [
        input(
          'BTC',
          Array.from({ length: 50 }, (_, i) => i + 1),
        ),
        input('ETH', Array(50).fill(10)),
      ],
      '1m',
      now,
    );
    expect(full.observations).toBe(32);
    expect(full.start).toBe(BASE + 18 * DAY);
    expect(full.shortened).toBe(false);
    expect(full.rows[0].returnPct).toBeCloseTo((50 / 19 - 1) * 100);
    const short = compareCloses([input('BTC', [10, 11]), input('ETH', [1, 2])], '3y', now);
    expect(short.shortened).toBe(true);
    expect(short.rows[0].annualVolatilityPct).toBeNull();
  });
  it('requires all selected assets and common dates, rather than silently dropping failed assets', () => {
    expect(compareCloses([input('BTC', [1, 2]), input('DOGE', [])], 'all', now).rows).toEqual([]);
    expect(
      compareCloses([input('BTC', [1, 2]), input('DOGE', [1, 2], 8)], 'all', now).error,
    ).toMatch('겹치는');
    expect(compareCloses([input('BTC', [1, 2]), input('BTC', [1, 2])], 'all', now).error).toMatch(
      '서로 다른',
    );
  });
  it('bounds comparison at the last shared day and never invents a stale tail', () => {
    const result = compareCloses(
      [input('BTC', [10, 20, 30, 40]), input('ETH', [1, 2, 3])],
      'all',
      now,
    );
    expect(result.end).toBe(BASE + 2 * DAY);
    expect(result.rows[0].endPrice).toBe(30);
    expect(result.rows[0].latestAvailable).toBe(BASE + 3 * DAY);
  });
  it('sorts and resolves duplicate observations without double counting', () => {
    const a = candles([1, 2, 3]).reverse();
    a.push({ ...a[1], close: 4 });
    const result = compareCloses(
      [{ asset: 'BTC', candles: a }, input('ETH', [1, 2, 3])],
      'all',
      now,
    );
    expect(result.observations).toBe(3);
    expect(result.rows[0].points.map((p) => p.value)).toEqual([100, 400, 300]);
    expect(result.rows[0].ignoredRows).toBe(1);
  });
  it('anchors calendar windows to the actual common end when one latest date is missing', () => {
    const a = candles(Array.from({ length: 50 }, (_, i) => i + 1));
    a.splice(48, 1);
    const result = compareCloses(
      [{ asset: 'BTC', candles: a }, input('DOGE', Array(49).fill(1))],
      '1m',
      now,
    );
    expect(result.end).toBe(BASE + 47 * DAY);
    expect(result.start).toBe(BASE + 16 * DAY);
    expect(result.observations).toBe(32);
    expect(result.shortened).toBe(false);
  });
  it('does not send infinite price ratios to the financial chart', () => {
    const result = compareCloses(
      [input('BTC', [Number.MIN_VALUE, 1e100]), input('ETH', [1, 2])],
      'all',
      now,
    );
    expect(result.error).toMatch('배율');
    expect(result.rows).toEqual([]);
  });
  it('uses inclusive custom dates and never lets the chosen preset override them', () => {
    const data = [input('BTC', [10, 20, 30, 40, 50]), input('DOGE', [1, 2, 1, 4, 5])];
    const result = compareCloses(data, '5y', now, { from: BASE + DAY, to: BASE + 3 * DAY });
    expect(result.start).toBe(BASE + DAY);
    expect(result.end).toBe(BASE + 3 * DAY);
    expect(result.observations).toBe(3);
    expect(result.rows[0].returnPct).toBe(100);
    expect(result.rows[1].maxDrawdownPct).toBe(-50);
    expect(result.shortened).toBe(false);
    expect(result.endShortened).toBe(false);
  });
  it('reports source coverage and a missing custom tail without fabricating prices', () => {
    const result = compareCloses(
      [{ ...input('BTC', [10, 20, 30]), historyStart: BASE - DAY }, input('DOGE', [1, 2], 1)],
      'all',
      now,
      { from: BASE, to: BASE + 5 * DAY },
    );
    expect(result.shortened).toBe(true);
    expect(result.endShortened).toBe(true);
    expect(result.coverage).toEqual([
      { asset: 'BTC', first: BASE - DAY, last: BASE + 2 * DAY },
      { asset: 'DOGE', first: BASE + DAY, last: BASE + 2 * DAY },
    ]);
    expect(result.requestedEnd).toBe(BASE + 5 * DAY);
    expect(result.rows[0].points).toHaveLength(2);
  });
  it('supports six months, YTD and five years with leap-safe calendar anchors', () => {
    const start = Date.parse('2018-01-01T00:00:00Z') / 1000;
    const end = Date.parse('2024-02-29T00:00:00Z') / 1000;
    const series = Array.from({ length: (end - start) / DAY + 1 }, (_, i) => ({
      ...candles([100 + i])[0],
      time: start + i * DAY,
      closeTime: start + (i + 1) * DAY,
    }));
    const data = [
      { asset: 'BTC' as const, candles: series },
      { asset: 'ETH' as const, candles: series },
    ];
    expect(compareCloses(data, '5y', end + DAY).start).toBe(
      Date.parse('2019-02-28T00:00:00Z') / 1000,
    );
    expect(compareCloses(data, '6m', end + DAY).start).toBe(
      Date.parse('2023-08-29T00:00:00Z') / 1000,
    );
    expect(compareCloses(data, 'ytd', end + DAY).start).toBe(
      Date.parse('2024-01-01T00:00:00Z') / 1000,
    );
  });
  it('validates calendar dates, both bounds, order and future dates from shared URLs', () => {
    const today = Date.parse('2026-09-20T03:00:00Z') / 1000;
    expect(parseComparisonRange(null, null, today)).toEqual({ range: null });
    expect(parseComparisonRange('2024-02-29', '2024-03-01', today).range).not.toBeNull();
    for (const [from, to] of [
      ['2025-02-29', '2025-03-01'],
      ['2025-1-1', '2025-03-01'],
      ['2025-02-01', null],
      ['2025-03-02', '2025-03-01'],
      ['2026-09-20', '2026-09-21'],
      ['1969-01-01', '2025-03-01'],
    ])
      expect(parseComparisonRange(from, to, today).error).toBeTruthy();
    expect(
      compareCloses([input('BTC', [1, 2]), input('DOGE', [1, 2])], 'all', today, {
        from: BASE + DAY,
        to: BASE,
      }).error,
    ).toMatch('날짜');
  });
});
