import { describe, expect, it } from 'vitest';
import {
  aggregateCloses,
  alignComparison,
  halvingCycles,
  normalizeWindow,
  powerLaw,
  rollingCorrelation,
  rollingVwap,
  seasonality,
  vwapReclaims,
} from '../shared/advanced-analysis';
import type { Candle, Point } from '../shared/types';
const DAY = 86400,
  start = Date.UTC(2015, 0, 1) / 1000;
const points = (n: number): Point[] =>
  Array.from({ length: n }, (_, i) => ({ time: start + i * DAY, value: 100 + i }));
const bars = (n: number): Candle[] =>
  points(n).map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value + 3,
    low: p.value - 2,
    close: p.value,
    volume: (p.value % 5) + 1,
    closeTime: p.time + DAY,
    closed: true,
  }));
describe('source-specific advanced calculations', () => {
  it('uses independent weighted HLC3 sum and resets at a missing daily bar', () => {
    const input = bars(400),
      actual = rollingVwap(input);
    const last = input.slice(-365);
    const expected =
      last.reduce((s, p) => s + ((p.high + p.low + p.close) / 3) * p.volume, 0) /
      last.reduce((s, p) => s + p.volume, 0);
    expect(actual.at(-1)?.value).toBeCloseTo(expected, 10);
    expect(rollingVwap(input.filter((_, i) => i !== 30))).toHaveLength(5);
    expect(rollingVwap(input.map((p) => ({ ...p, volume: 0 })))).toEqual([]);
    expect(rollingVwap(input.map((p) => ({ ...p, closed: false })))).toEqual([]);
  });
  it('requires 100 below then seven closed daily above and emits once', () => {
    const p = points(125).map((p, i) => ({ ...p, value: i < 100 ? 9 : 11 })),
      v = p.map((p) => ({ ...p, value: 10 }));
    expect(vwapReclaims(p, v)).toEqual([p[106]]);
    expect(
      vwapReclaims(
        p.filter((_, i) => i !== 103),
        v,
      ),
    ).toEqual([]);
    expect(vwapReclaims(p.slice(1), v)).toEqual([]);
    expect(vwapReclaims(p.slice(0, 106), v)).toEqual([]);
  });
  it('aligns all sources on exact dates; distinguishes ratio/index/percent', () => {
    const a = points(4),
      b = a.slice(1).map((p) => ({ ...p, value: p.value * 2 }));
    expect(
      alignComparison(
        [
          { name: 'a', data: a },
          { name: 'b', data: b },
        ],
        'index',
      )[0].data[0].value,
    ).toBe(100);
    expect(
      alignComparison(
        [
          { name: 'a', data: a },
          { name: 'b', data: b },
        ],
        'percent',
      )[0].data[0].value,
    ).toBe(0);
    expect(
      alignComparison(
        [
          { name: 'a', data: a },
          { name: 'b', data: b },
        ],
        'ratio',
      )[1].data.map((p) => p.value),
    ).toEqual([2, 2, 2]);
  });
  it('correlates returns and restarts after missing dates', () => {
    const p = points(70);
    expect(rollingCorrelation(p, p, 30)[0].time).toBe(p[30].time);
    expect(rollingCorrelation(p, p, 30)[0].value).toBeCloseTo(1);
    expect(
      rollingCorrelation(
        p.filter((_, i) => i !== 40),
        p,
        30,
      ).at(-1)?.time,
    ).toBe(p[39].time);
  });
  it('keeps actual close timestamps and never fabricates OHLC', () => {
    const p = points(60);
    expect(aggregateCloses(p, '1M').map((p) => new Date(p.time * 1000).getUTCDate())).toEqual([
      31, 28, 1,
    ]);
    expect(Object.keys(aggregateCloses(p, '1w')[0])).toEqual(['time', 'value']);
  });
  it('normalizes cycle anchors using first observation and no future points', () => {
    const p = points(800);
    const window = normalizeWindow(p, start - 10 * DAY, start + 20 * DAY, 'A');
    expect(window.first).toBe(start);
    expect(window.points.at(-1)?.time).toBe(20);
    expect(window.points[0].value).toBe(100);
    expect(halvingCycles(p).flatMap((p) => p.points).length).toBeLessThanOrEqual(p.length);
    expect(powerLaw(p)[0].time).toBe(p[0].time);
    expect(powerLaw(p)[0].value).toBeCloseTo(
      4.42e-17 * ((start - Date.parse('2009-01-03') / 1000) / DAY) ** 5.6,
    );
  });
  it('excludes incomplete/current years, handles leap days and distinguishes mean from median', () => {
    const from = Date.UTC(2015, 11, 31) / 1000,
      to = Date.UTC(2020, 5, 1) / 1000;
    const p: Point[] = [];
    for (let t = from; t <= to; t += DAY) {
      const year = new Date(t * 1000).getUTCFullYear();
      const day = (t - Date.UTC(year, 0, 1) / 1000) / DAY;
      p.push({
        time: t,
        value: 100 * Math.exp((year === 2018 ? 0.008 : 0.001) * Math.max(0, day)),
      });
    }
    const result = seasonality(p, to);
    expect(result.years).toEqual([2016, 2017, 2018, 2019]);
    expect(result.summary).toHaveLength(365);
    expect(result.current.length).toBeGreaterThan(100);
    expect(result.summary.at(-1)?.mean).not.toBeCloseTo(result.summary.at(-1)!.median);
    expect(result.paths.every((p) => p.data.length === 365)).toBe(true);
    const broken = seasonality(
      p.filter((p) => p.time !== Date.UTC(2017, 5, 1) / 1000),
      to,
    );
    expect(broken.years).toEqual([2016, 2018, 2019]);
    expect(
      seasonality(
        p.filter((p) => p.time > Date.UTC(2018, 0, 1) / 1000),
        to,
      ).summary,
    ).toEqual([]);
  });
});
