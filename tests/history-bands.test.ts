import { describe, expect, it } from 'vitest';
import { BAND_DAYS, historyBands, bandPosition } from '../shared/history-bands';
import { DAY } from '../shared/math';

describe('historical price bands', () => {
  const start = Date.UTC(2020, 0, 1) / 1000;
  const flat = Array.from({ length: BAND_DAYS + 2 }, (_, index) => ({
    time: start + index * DAY,
    value: 10,
  }));

  it('uses only the previous 730 consecutive daily prices', () => {
    const changed = flat.map((point, index) => index === BAND_DAYS ? { ...point, value: 100 } : point);
    const bands = historyBands(changed);
    expect(bands).toHaveLength(2);
    expect(bands[0].center).toBeCloseTo(10);
    expect(bands[0].sigma).toBeCloseTo(0);
    expect(bands[0].price).toBe(100);
    expect(bands[1].center).toBeGreaterThan(10);
    expect(bands[1].drawdown).toBeCloseTo(-90);
  });

  it('does not bridge missing UTC days into a 730-day calculation', () => {
    const gapped = flat.map((point, index) => index >= 500 ? { ...point, time: point.time + DAY } : point);
    expect(historyBands(gapped)).toHaveLength(0);
  });

  it('describes positions without a trading recommendation', () => {
    expect(bandPosition(-1.5)).toBe('깊은 하단');
    expect(bandPosition(0)).toBe('중앙');
    expect(bandPosition(1.5)).toBe('높은 상단');
  });
});
