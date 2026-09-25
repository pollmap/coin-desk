import { describe, expect, it } from 'vitest';
import { historyBands } from '../shared/history-bands';
import {
  consecutiveSegments,
  drawdownY,
  positionGeometry,
  priceObservations,
} from '../shared/position-chart';
import { DAY } from '../shared/math';

describe('price position visualization integrity', () => {
  it('draws deeper losses below the zero line', () => {
    expect(drawdownY(0)).toBe(300);
    expect(drawdownY(-50)).toBe(330);
    expect(drawdownY(-100)).toBe(360);
    expect(drawdownY(-80)).toBeGreaterThan(drawdownY(-20));
  });
  it('retains the first 730 prices without fabricating bands', () => {
    const raw = Array.from({ length: 735 }, (_, i) => ({ time: i * DAY, value: 100 + i }));
    const observations = priceObservations(raw),
      bands = historyBands(raw);
    const geometry = positionGeometry(observations, bands, 290)!;
    expect(observations).toHaveLength(735);
    expect(bands).toHaveLength(5);
    expect(geometry.first).toBe(0);
    expect(bands[0].time).toBe(730 * DAY);
    expect(geometry.x(raw.at(-1)!.time)).toBeLessThan(290);
  });
  it('keeps historical peak before a visible subrange and ignores invalid prices', () => {
    const rows = priceObservations([
      { time: 0, value: 100 },
      { time: DAY, value: NaN },
      { time: 2 * DAY, value: 40 },
      { time: 3 * DAY, value: 200 },
      { time: 4 * DAY, value: 50 },
    ]);
    expect(rows.map((p) => p.drawdown)).toEqual([0, -60, 0, -75]);
    expect(rows.slice(-1)[0].drawdown).toBe(-75);
  });
  it('does not connect price or band paths across missing observations', () => {
    const rows = [
      { time: 0, value: 100 },
      { time: DAY, value: 101 },
      { time: 3 * DAY, value: 90 },
      { time: 4 * DAY, value: 91 },
    ];
    expect(consecutiveSegments(rows).map((s) => s.length)).toEqual([2, 2]);
    const observations = priceObservations(rows);
    const bands = observations.map((p) => ({
      ...p,
      center: p.price,
      sigma: 1,
      z: 0,
      peak: 101,
      bands: [1, 2, 3, 4, 5, 6],
    }));
    const geometry = positionGeometry(observations, bands, 1000)!;
    expect(geometry.paths).toHaveLength(2);
    expect(geometry.polygons).toHaveLength(10);
  });
  it('does not discard a single-day spike or trough in the plotted history', () => {
    const rows = Array.from({ length: 6000 }, (_, i) => ({
      time: i * DAY,
      value: i === 1521 ? 10000 : i === 4523 ? 1 : 100,
    }));
    const observations = priceObservations(rows);
    const geometry = positionGeometry(observations, [], 320)!;
    expect(geometry.paths[0].price.split(' ')).toHaveLength(6000);
    expect(geometry.paths[0].price).toContain(
      `${geometry.x(1521 * DAY).toFixed(1)},${geometry.y(10000).toFixed(1)}`,
    );
    expect(observations[4523].drawdown).toBeCloseTo(-99.99);
  });
});
