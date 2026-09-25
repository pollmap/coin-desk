import { describe, expect, it } from 'vitest';
import {
  adjacentObservation,
  readingIndex,
  readingsCsv,
  readingDigits,
} from '../shared/chart-readings';

const columns = [
  {
    title: 'BTC',
    unit: 'USD',
    source: 'Reference',
    data: [
      { time: 86400, value: 100 },
      { time: 259200, value: 120 },
    ],
  },
  {
    title: '펀딩',
    unit: '%',
    source: 'Bybit',
    data: [
      { time: 86400, value: 0 },
      { time: 115200, value: -0.00001 },
      { time: 172800, value: 0.01 },
    ],
  },
];
describe('synchronized chart readings', () => {
  it('keeps small relative prices and funding rates legible without zero padding at zero', () => {
    expect(readingDigits(0.000001135)).toBe(8);
    expect(readingDigits(-0.000134)).toBe(6);
    expect(readingDigits(0)).toBe(2);
  });
  it('retains intraday observations and leaves missing prices empty', () => {
    const { times, maps } = readingIndex(columns);
    expect(times).toEqual([86400, 115200, 172800, 259200]);
    expect(maps[0].get(172800)).toBeUndefined();
    expect(maps[1].get(86400)).toBe(0);
    expect(maps[1].get(259200)).toBeUndefined();
  });
  it('navigates both directions across gaps, exact observations and boundaries', () => {
    const { times } = readingIndex(columns);
    expect(adjacentObservation(times, 120000, -1)).toBe(115200);
    expect(adjacentObservation(times, 120000, 1)).toBe(172800);
    expect(adjacentObservation(times, 115200, 1)).toBe(172800);
    expect(adjacentObservation(times, 115200, -1)).toBe(86400);
    expect(adjacentObservation(times, 86400, -1)).toBe(86400);
    expect(adjacentObservation(times, 259200, 1)).toBe(259200);
    expect(adjacentObservation([], null, 1)).toBeNull();
  });
  it('exports the visible range, exact source/unit, zero and full funding precision', () => {
    const csv = readingsCsv(columns, { from: 86400, to: 172800 });
    expect(csv).toContain('BTC · USD · Reference');
    expect(csv).toContain('펀딩 · % · Bybit');
    expect(csv).toContain('1970-01-02T00:00:00.000Z,100,0');
    expect(csv).toContain('1970-01-02T08:00:00.000Z,,-0.00001');
    expect(csv).toContain('1970-01-03T00:00:00.000Z,,0.01');
    expect(csv).not.toContain('1970-01-04');
  });
  it('escapes metadata and excludes invalid readings', () => {
    const extra = {
      title: '=bad,"name"',
      unit: '%',
      source: 'Example',
      data: [{ time: 1, value: NaN }],
    };
    expect(readingIndex([extra]).times).toEqual([]);
    expect(readingsCsv([extra])).toContain('"관측: =bad,""name"" · % · Example"');
  });
});
