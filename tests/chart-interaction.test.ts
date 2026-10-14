import { describe, expect, it } from 'vitest';
import {
  chartDate,
  chartTick,
  chartPrecision,
  inspectionPosition,
  logicalRangeChanged,
  mobileChartHeight,
  boundedLogicalPan,
  restoreLogicalView,
} from '../src/chart-interaction';
import { priceDigits } from '../src/lib';
import { readingDigits } from '../shared/chart-readings';

describe('chart precision and inspection layout', () => {
  it('uses KST consistently without changing the underlying UTC observation', () => {
    const time = Date.UTC(2026, 9, 14, 16, 30) / 1000;
    expect(chartDate(time)).toBe('2026-10-15');
    expect(chartDate(time, true)).toBe('2026-10-15 01:30');
    expect(chartTick(time, 2)).toBe('10-15');
    expect(chartTick(time, 3)).toBe('01:30');
  });
  it('keeps micro prices, negative funding, zero, and large KRW increments accurate', () => {
    expect(chartPrecision([0.000001135, 0.000005], (v) => priceDigits(v, 'USDT'))).toEqual({
      precision: 8,
      minMove: 1e-8,
    });
    expect(chartPrecision([0, -0.000134], readingDigits)).toEqual({ precision: 6, minMove: 1e-6 });
    expect(chartPrecision([65000000, 100000000], (v) => priceDigits(v, 'KRW'))).toEqual({
      precision: 0,
      minMove: 1,
    });
    expect(chartPrecision([NaN, Infinity, 0], readingDigits)).toEqual({
      precision: 2,
      minMove: 0.01,
    });
  });
  it('uses bounded mobile heights without reducing desktop chart height', () => {
    expect(mobileChartHeight(577, 270, 59)).toBe(240);
    expect(mobileChartHeight(844, 270, 93)).toBe(330);
    expect(mobileChartHeight(700, 270, 59)).toBe(330);
    expect(mobileChartHeight(650, 270, 59)).toBe(313);
  });
  it('keeps a tooltip away from right axes, navigation, and touch points', () => {
    const bounds = { left: 0, top: 0, width: 250, height: 210 };
    for (const point of [
      { x: 0, y: 0 },
      { x: 249, y: 209 },
      { x: 100, y: 100 },
    ]) {
      const position = inspectionPosition(point, bounds, { width: 150, height: 60 }, true);
      expect(position.left).toBeGreaterThanOrEqual(6);
      expect(position.left + 150).toBeLessThanOrEqual(244);
      expect(position.top).toBeGreaterThanOrEqual(6);
      expect(position.top + 60).toBeLessThanOrEqual(204);
    }
    expect(
      inspectionPosition({ x: 120, y: 140 }, bounds, { width: 100, height: 40 }, true).top,
    ).toBe(68);
  });
  it('only treats a changed logical window as range interaction', () => {
    expect(logicalRangeChanged({ from: 0, to: 100 }, { from: 0, to: 100 })).toBe(false);
    expect(logicalRangeChanged({ from: 0, to: 100 }, { from: 1e-8, to: 100 })).toBe(false);
    expect(logicalRangeChanged({ from: 0, to: 100 }, { from: 1, to: 101 })).toBe(true);
    expect(logicalRangeChanged(null, { from: 1, to: 101 })).toBe(false);
  });
  it('keeps the exact bar width when moving repeatedly to first and last observations', () => {
    const range = { from: 20.25, to: 75.75 };
    const start = boundedLogicalPan(range, 0, 0, 149)!;
    const end = boundedLogicalPan(start, 149, 0, 149)!;
    const startAgain = boundedLogicalPan(end, 0, 0, 149)!;
    expect(start).toEqual({ from: 0, to: 55.5 });
    expect(end).toEqual({ from: 93.5, to: 149 });
    expect(startAgain).toEqual(start);
    expect(end.to - end.from).toBe(range.to - range.from);
  });
  it('retains zoom for irregular observations and keeps a stable observation after prepend', () => {
    const anchor = { time: 172800, offset: 0.25, width: 55.5 };
    const before = restoreLogicalView(anchor, 20);
    const prepended = restoreLogicalView(anchor, 70);
    const correctedGap = restoreLogicalView(anchor, 67);
    expect(before).toEqual({ from: 20.25, to: 75.75 });
    expect(prepended).toEqual({ from: 70.25, to: 125.75 });
    expect(correctedGap.to - correctedGap.from).toBe(before.to - before.from);
    expect(boundedLogicalPan(before, 100, 0, 149)).toEqual({ from: 72.25, to: 127.75 });
  });
  it('does not shrink a deliberately wider viewport or accept invalid spans', () => {
    expect(boundedLogicalPan({ from: 40, to: 240 }, 0, 0, 149)).toEqual({ from: 0, to: 200 });
    expect(boundedLogicalPan({ from: -200, to: 0 }, 149, 0, 149)).toEqual({ from: -51, to: 149 });
    expect(boundedLogicalPan({ from: 1, to: 1 }, 0, 0, 149)).toBeNull();
    expect(boundedLogicalPan({ from: 0, to: NaN }, 0, 0, 149)).toBeNull();
  });
});
