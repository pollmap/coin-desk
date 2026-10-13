import { describe, expect, it } from 'vitest';
import { hashRibbons, hashrateTrend } from '../shared/hash-ribbons';
import { DAY } from '../shared/math';
import type { Point } from '../shared/types';

const start = Date.UTC(2020, 0, 1) / 1000;
const points = (values: number[]): Point[] =>
  values.map((value, index) => ({ time: start + index * DAY, value }));
const hashes = points([100, 50, 200, 20, 300].flatMap((value) => Array(80).fill(value)));
const increasing = points(Array.from({ length: hashes.length }, (_, index) => 100 + index));
const events = (rows: ReturnType<typeof hashRibbons>) =>
  rows.flatMap((row) => row.events.map((event) => ({ day: (row.time - start) / DAY, event })));

describe('daily hash ribbons and independently named PoW hash trend', () => {
  it('matches independent batch 30/60 and 10/20 rolling averages', () => {
    const rows = hashRibbons(hashes, increasing, Infinity);
    expect(rows).toHaveLength(hashes.length - 59);
    for (const row of rows) {
      const index = (row.time - start) / DAY;
      const mean = (input: Point[], period: number) =>
        input.slice(index - period + 1, index + 1).reduce((sum, point) => sum + point.value, 0) /
        period;
      expect(row.hash30).toBeCloseTo(mean(hashes, 30), 10);
      expect(row.hash60).toBeCloseTo(mean(hashes, 60), 10);
      expect(row.price10).toBeCloseTo(mean(increasing, 10), 10);
      expect(row.price20).toBeCloseTo(mean(increasing, 20), 10);
    }
  });

  it('emits each decrease/recovery and price confirmation once per recovery cycle', () => {
    expect(events(hashRibbons(hashes, increasing, Infinity))).toEqual([
      { day: 80, event: 'decrease' },
      { day: 160, event: 'recovery' },
      { day: 160, event: 'price-confirmed' },
      { day: 240, event: 'decrease' },
      { day: 320, event: 'recovery' },
      { day: 320, event: 'price-confirmed' },
    ]);
  });

  it('keeps other PoW trends free of Bitcoin price-confirmation semantics', () => {
    const rows = hashrateTrend(hashes, Infinity);
    expect(rows.every((row) => row.price10 === null && row.price20 === null)).toBe(true);
    expect(events(rows).map((value) => value.event)).toEqual([
      'decrease',
      'recovery',
      'decrease',
      'recovery',
    ]);
  });

  it('waits for positive price momentum after hash recovery rather than generating buy labels', () => {
    const price = points(
      Array.from({ length: hashes.length }, (_, index) =>
        index < 175 ? 600 - index : 300 + 6 * (index - 175),
      ),
    );
    const rows = hashRibbons(hashes, price, Infinity);
    const firstConfirmation = events(rows).find((value) => value.event === 'price-confirmed')!;
    expect(firstConfirmation.day).toBeGreaterThan(160);
    const confirmed = rows.find((row) => row.time === start + firstConfirmation.day * DAY)!;
    expect(confirmed.price10).toBeGreaterThan(confirmed.price20!);
    expect(confirmed.state).toBe('recovery');
    expect(
      events(rows).filter((value) => value.event === 'price-confirmed' && value.day < 240),
    ).toHaveLength(1);
    expect(
      events(
        hashRibbons(
          hashes,
          points(Array.from({ length: hashes.length }, (_, index) => 1000 - index)),
          Infinity,
        ),
      ).some((value) => value.event === 'price-confirmed'),
    ).toBe(false);
  });

  it('resets both hash windows and crossing state after a missing day or invalid hash', () => {
    const missing = hashes.filter((_, index) => index !== 100);
    const rows = hashrateTrend(missing, Infinity);
    expect(
      rows.filter((row) => row.time >= start + 100 * DAY && row.time < start + 160 * DAY),
    ).toEqual([]);
    expect(rows.find((row) => row.time === start + 160 * DAY)?.events).toEqual([]);
    for (const value of [0, -1, NaN, Infinity]) {
      const invalid = hashes.map((point, index) => (index === 100 ? { ...point, value } : point));
      expect(hashrateTrend(invalid, Infinity)).toEqual(rows);
    }
  });

  it('resets price confirmation readiness after price gaps without losing the hash lines', () => {
    const price = increasing.filter((_, index) => index !== 159);
    const rows = hashRibbons(hashes, price, Infinity);
    expect(rows).toHaveLength(hashes.length - 59);
    const recovery = rows.find((row) => row.time === start + 160 * DAY)!;
    expect(recovery.events).toEqual(['recovery']);
    expect(recovery.price20).toBeNull();
    expect(events(rows).find((value) => value.event === 'price-confirmed')).toEqual({
      day: 320,
      event: 'price-confirmed',
    });
  });

  it('requires a new recovery cycle after price inputs disappear during pending confirmation', () => {
    const price = points(
      Array.from({ length: hashes.length }, (_, index) =>
        index < 175 ? 600 - index : 300 + 6 * (index - 175),
      ),
    ).filter((_, index) => index !== 170);
    const rows = hashRibbons(hashes, price, Infinity);
    expect(rows.find((row) => row.time === start + 160 * DAY)?.events).toEqual(['recovery']);
    expect(rows.find((row) => row.time === start + 190 * DAY)?.price20).not.toBeNull();
    expect(events(rows).filter((value) => value.event === 'price-confirmed')).toEqual([
      { day: 320, event: 'price-confirmed' },
    ]);
    expect(
      rows.filter((row) => row.time >= start + 170 * DAY && row.time < start + 190 * DAY),
    ).toHaveLength(20);
  });

  it('does not infer a crossing from the first available below-average reading', () => {
    const rows = hashrateTrend(
      points(Array.from({ length: 75 }, (_, index) => 200 - index)),
      Infinity,
    );
    expect(rows[0].state).toBe('decrease');
    expect(events(rows)).toEqual([]);
  });

  it('does not treat equality or flat hashrate/price as confirmation', () => {
    const flat = points(Array(100).fill(25));
    const rows = hashRibbons(flat, flat, Infinity);
    expect(rows).toHaveLength(41);
    expect(
      rows.every((row) => row.hash30 === 25 && row.hash60 === 25 && row.state === 'normal'),
    ).toBe(true);
    expect(events(rows)).toEqual([]);
    expect(
      events(hashRibbons(hashes, points(Array(hashes.length).fill(7)), Infinity)).filter(
        (value) => value.event === 'price-confirmed',
      ),
    ).toEqual([]);
    expect(hashrateTrend(flat.slice(0, 59), Infinity)).toEqual([]);
  });

  it('keeps extreme finite observations finite instead of overflowing running sums', () => {
    const huge = points(Array(80).fill(1e308));
    const rows = hashRibbons(huge, huge, Infinity);
    expect(rows).toHaveLength(21);
    expect(
      rows.every((row) =>
        [row.hash30, row.hash60, row.price10, row.price20].every(Number.isFinite),
      ),
    ).toBe(true);
    expect(events(rows)).toEqual([]);
  });

  it('ignores duplicate and backward observations without creating duplicate events', () => {
    const repeated = [
      ...hashes.slice(0, 180),
      { ...hashes[179], value: 9 },
      hashes[10],
      ...hashes.slice(180),
    ];
    expect(hashRibbons(repeated, increasing, Infinity)).toEqual(
      hashRibbons(hashes, increasing, Infinity),
    );
    const pricesRepeated = [
      ...increasing.slice(0, 180),
      { ...increasing[179], value: 90000 },
      increasing[10],
      ...increasing.slice(180),
    ];
    expect(hashRibbons(hashes, pricesRepeated, Infinity)).toEqual(
      hashRibbons(hashes, increasing, Infinity),
    );
  });

  it('uses only closed days and does not revise signals when future observations append', () => {
    const prefix = hashes.slice(0, 200);
    const expected = hashRibbons(prefix, increasing.slice(0, 200), Infinity);
    expect(hashRibbons(hashes, increasing, prefix.at(-1)!.time + DAY - 1)).toEqual(
      hashRibbons(prefix.slice(0, -1), increasing.slice(0, 199), Infinity),
    );
    expect(hashRibbons(hashes, increasing, prefix.at(-1)!.time + DAY)).toEqual(expected);
    expect(hashRibbons(hashes, increasing, Infinity).slice(0, expected.length)).toEqual(expected);
    expect(() => hashrateTrend(hashes, NaN)).toThrow('cutoff');
  });
});
