import { describe, expect, it } from 'vitest';
import {
  chartDate,
  chartTick,
  chartPrecision,
  inspectionPosition,
  logicalRangeChanged,
  mobileChartHeight,
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
});
