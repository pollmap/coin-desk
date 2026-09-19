import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  aggregate,
  atBarClose,
  bollinger,
  bucket,
  bucketEnd,
  DAY,
  rsi,
  sma,
  validCandle,
  zStep,
} from '../shared/math';
import type { Candle } from '../shared/types';
const fixtures = JSON.parse(readFileSync('tests/fixtures/python-reference.json', 'utf8'));
const t = (date: string) => Date.parse(date + 'T00:00:00Z') / 1000;
const candle = (time: number, close = 100): Candle => ({
  time,
  open: 100,
  close,
  high: Math.max(110, close),
  low: Math.min(90, close),
  volume: 2,
  closeTime: time + DAY,
  closed: true,
});
describe('Python independent technical calculations', () => {
  for (const f of fixtures)
    it(f.name, () => {
      const points = f.values.map((value: number, i: number) => ({
        time: t('2020-01-01') + i * DAY,
        value,
      }));
      const compare = (actual: number[], expected: number[]) => {
        expect(actual.length).toBe(expected.length);
        actual.forEach((v, i) =>
          expect(Math.abs(v - expected[i])).toBeLessThan(
            Math.max(1e-8, Math.abs(expected[i]) * 1e-10),
          ),
        );
      };
      for (const n of [128, 200, 365])
        compare(
          sma(points, n).map((p) => p.value),
          f.expected['sma' + n],
        );
      compare(
        rsi(points).map((p) => p.value),
        f.expected.rsi,
      );
      for (const key of ['middle', 'upper', 'lower'] as const)
        compare(
          bollinger(points)[key].map((p) => p.value),
          f.expected.bb.map((b: Record<string, number>) => b[key]),
        );
    });
  it('insufficient data stays absent', () => {
    expect(rsi([{ time: 1, value: 10 }])).toEqual([]);
    expect(sma([{ time: 1, value: 10 }], 200)).toEqual([]);
  });
  it('gaps are not synthesized', () => {
    const c = [candle(t('2024-01-01')), candle(t('2024-01-03'))];
    expect(aggregate(c, '1d').length).toBe(2);
  });
});
describe('UTC candle boundaries and causality', () => {
  it('weeks begin Monday', () => {
    expect(bucket(t('2024-01-07'), '1w')).toBe(t('2024-01-01'));
    expect(bucket(t('2024-01-08'), '1w')).toBe(t('2024-01-08'));
  });
  it('leap month and year-end', () => {
    expect(bucketEnd(t('2024-02-01'), '1M')).toBe(t('2024-03-01'));
    expect(bucketEnd(t('2024-12-01'), '1M')).toBe(t('2025-01-01'));
  });
  it('OHLCV weekly aggregation, in-progress status', () => {
    const c = [candle(t('2024-01-01'), 105), candle(t('2024-01-02'), 108)];
    const out = aggregate(c, '1w', t('2024-01-03'))[0];
    expect(out).toMatchObject({
      open: 100,
      close: 108,
      high: 110,
      low: 90,
      volume: 4,
      closed: false,
    });
    expect(aggregate(c, '1w', t('2024-01-08'))[0].closed).toBe(true);
  });
  it('future daily close is unavailable to an earlier hourly bar', () => {
    const day = t('2024-01-01');
    const output = atBarClose(
      [{ time: day, value: 123 }],
      '1d',
      [
        { ...candle(day), closeTime: day + 3600 },
        { ...candle(day + 23 * 3600), closeTime: day + DAY },
      ],
      day + DAY,
    );
    expect(output).toEqual([{ time: day + 23 * 3600, value: 123 }]);
  });
  it('future weekly close is unavailable midweek', () => {
    const day = t('2024-01-01');
    expect(
      atBarClose([{ time: day, value: 123 }], '1w', [candle(day + DAY)], day + 2 * DAY),
    ).toEqual([]);
  });
  it('rejects invalid values', () => {
    expect(validCandle({ ...candle(1), close: NaN })).toBe(false);
    expect(validCandle({ ...candle(1), high: 1 })).toBe(false);
  });
});
describe('MVRV-Z', () => {
  it('matches independent Python population standard deviation on real history', () => {
    const f = JSON.parse(readFileSync('tests/fixtures/z-reference.json', 'utf8'));
    let state = { n: 0, mean: 0, m2: 0 };
    for (const [i, row] of f.rows.entries()) {
      const out = zStep(state, row[0], row[1]);
      state = out.state;
      const checkpoint = f.checkpoints.find((p: { index: number }) => p.index === i);
      if (checkpoint) expect(out.value).toBeCloseTo(checkpoint.expected, 9);
    }
  });
  it('requires 365 valid days and ignores null or zero', () => {
    let s = { n: 0, mean: 0, m2: 0 };
    for (let i = 1; i < 365; i++) {
      const out = zStep(s, i, 1);
      s = out.state;
      expect(out.value).toBeNull();
    }
    expect(zStep(s, null, 1).state).toEqual(s);
    expect(zStep(s, 0, 1).state).toEqual(s);
    expect(zStep(s, 365, 1).value).not.toBeNull();
  });
  it('zero deviation yields no value', () => {
    let s = { n: 0, mean: 0, m2: 0 };
    for (let i = 0; i < 400; i++) {
      const out = zStep(s, 10, 5);
      s = out.state;
      expect(out.value).toBeNull();
    }
  });
  it('appending future data cannot alter prior results', () => {
    const run = (count: number) => {
      let s = { n: 0, mean: 0, m2: 0 };
      return Array.from({ length: count }, (_, i) => {
        const out = zStep(s, 100 + i * 3, 70);
        s = out.state;
        return out.value;
      });
    };
    expect(run(500).slice(0, 400)).toEqual(run(400));
  });
});
