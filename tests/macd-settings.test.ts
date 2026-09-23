import { describe, it, expect } from 'vitest';
import { indicatorSpec, indicatorIdentity, addIndicator } from '../shared/indicators';
import { macd } from '../shared/math';
import { calculateIndicators } from '../shared/chart-analysis';
import type { Candle } from '../shared/types';
describe('configurable MACD settings and chart integration', () => {
  it('preserves the old alias while identifying every parameter', () => {
    expect(indicatorIdentity('macd')).toBe(indicatorIdentity('macd:12:bar:26:9'));
    expect(indicatorSpec('macd:8:bar:21:5')?.label).toBe('MACD 8·21·5');
    expect(addIndicator(['sma200', 'macd'], 'macd:8:bar:21:5').value).toEqual([
      'sma200',
      'macd:8:bar:21:5',
    ]);
  });
  it('rejects malformed settings and inverted EMA periods', () => {
    for (const id of [
      'macd:26:bar:12:9',
      'macd:12:bar:12:9',
      'macd:8:d:21:5',
      'macd:8:bar:21:1',
      'macd:8:bar:1001:5',
      'macd:8:bar:21:5:7',
    ])
      expect(indicatorSpec(id)).toBeNull();
    expect(macd([{ time: 1, value: 10 }], 26, 12, 9).line).toEqual([]);
  });
  it('uses chosen periods in the price chart and never uses future bars', () => {
    const candles = Array.from({ length: 60 }, (_, i) => ({
      time: 1600000000 + i * 86400,
      closeTime: 1600000000 + (i + 1) * 86400,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1,
      closed: true,
    })) as Candle[];
    const points = candles.map((c) => ({ time: c.time, value: c.close }));
    const id = 'macd:8:bar:21:5';
    const all = calculateIndicators(candles, [], [id])[id];
    expect(all[0]).toEqual(macd(points, 8, 21, 5).line);
    expect(all[0][0].time).toBe(candles[20].time);
    expect(all[1][0].time).toBe(candles[24].time);
    const prefix = calculateIndicators(candles.slice(0, 40), [], [id])[id];
    prefix.forEach((series, i) =>
      expect(series).toEqual(all[i].filter((p) => p.time <= candles[39].time)),
    );
  });
});
