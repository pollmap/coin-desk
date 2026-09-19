import { describe, expect, it } from 'vitest';
import {
  calculateIndicators,
  candlesCsv,
  pointAtOrBefore,
  validDrawings,
} from '../shared/chart-analysis';
import { addIndicator, indicatorIdentity } from '../shared/indicators';
import { DAY } from '../shared/math';
import type { Candle } from '../shared/types';

const start = Date.parse('2024-01-01T00:00:00Z') / 1000;
const candle = (time: number, close = 100, closed = true): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  closeTime: time + DAY,
  closed,
});

describe('chart red-team: causal display and data identity', () => {
  it('an initial partial listing week is excluded from full weekly moving averages', () => {
    const daily = Array.from({ length: 19 }, (_, i) => candle(start + (i + 2) * DAY, i + 1));
    const values = calculateIndicators(daily, daily, ['sma:2:w'], start + 22 * DAY)['sma:2:w'][0];
    expect(values).toEqual([{ time: start + 20 * DAY, value: (12 + 19) / 2 }]);
  });
  it('a daily close cannot leak into earlier intraday bars even if a stale closed flag is true', () => {
    const daily = [candle(start, 10), candle(start + DAY, 20), candle(start + 2 * DAY, 999)];
    const intraday = [
      { ...candle(start + 2 * DAY + 3600, 30, false), closeTime: start + 2 * DAY + 7200 },
    ];
    const result = calculateIndicators(intraday, daily, ['sma:2:d'], start + 2 * DAY + 3700);
    expect(result['sma:2:d'][0]).toEqual([{ time: intraday[0].time, value: 15 }]);
  });
  it('adding a forming bar changes only its own bar-based result, not prior signals', () => {
    const rows = Array.from({ length: 40 }, (_, i) => candle(start + i * DAY, 100 + i));
    const ids = ['ema:5:bar', 'rsi:7:bar', 'bb:10:bar:2', 'macd'];
    const before = calculateIndicators(rows, [], ids, start + 41 * DAY);
    const after = calculateIndicators(
      [...rows, candle(start + 40 * DAY, 1e6, false)],
      [],
      ids,
      start + 40 * DAY + 100,
    );
    for (const id of ids)
      after[id].forEach((series, i) => expect(series.slice(0, -1)).toEqual(before[id][i]));
  });
  it('hover lookup returns no future observation and exposes the actual observed timestamp', () => {
    const points = [
      { time: 10, value: 1 },
      { time: 30, value: 3 },
    ];
    expect(pointAtOrBefore(points, 5)).toBeUndefined();
    expect(pointAtOrBefore(points, 20)).toEqual(points[0]);
    expect(pointAtOrBefore(points, 30)).toEqual(points[1]);
    expect(pointAtOrBefore([], 100)).toBeUndefined();
  });
  it('CSV preserves actual tiny prices, UTC boundary, provenance, and in-progress state', () => {
    const data = [candle(start, 0.00000001), candle(start + DAY, 0.00000002, false)];
    const output = candlesCsv(data, 'PEPE.binance.1d', start + DAY, start + DAY);
    const lines = output.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('open_time_utc,close_time_utc');
    expect(lines[1]).toContain('PEPE,binance,1d,2024-01-02T00:00:00.000Z,2024-01-03T00:00:00.000Z');
    expect(Number(lines[1].split(',')[8])).toBe(0.00000002);
    expect(lines[1].endsWith(',false')).toBe(true);
  });
});

describe('chart red-team: untrusted settings and bounded drawings', () => {
  it('rejects malformed drawing storage rather than throwing while painting', () => {
    for (const input of [null, {}, '[]', 123]) expect(validDrawings(input)).toEqual([]);
    const valid = { id: 'ok', kind: 'horizontal', points: [{ time: start, value: 1e-8 }] };
    const invalid = [
      null,
      { id: 'missing' },
      { ...valid, id: 'bad', points: [{ time: start, value: -1 }] },
      { ...valid, id: 'same', kind: 'trend', points: [...valid.points, ...valid.points] },
      { ...valid, id: 'infinite', points: [{ time: start, value: Infinity }] },
      { ...valid, id: 'string', points: [{ time: '1704067200', value: 1 }] },
    ];
    expect(validDrawings([...invalid, valid, valid])).toEqual([valid]);
  });
  it('retains only 30 valid drawings and orders reversed trend endpoints', () => {
    const items = Array.from({ length: 35 }, (_, i) => ({
      id: String(i),
      kind: 'trend',
      points: [
        { time: start + DAY, value: i + 2 },
        { time: start, value: i + 1 },
      ],
    }));
    const result = validDrawings(items);
    expect(result).toHaveLength(30);
    expect(result[0].id).toBe('5');
    expect(result[0].points[0].time).toBe(start);
  });
  it('a preset and the equivalent custom setting identify the same line', () => {
    expect(indicatorIdentity('sma200')).toBe(indicatorIdentity('sma:200:d'));
    expect(indicatorIdentity('bb')).toBe(indicatorIdentity('bb:20:bar:2'));
    expect(indicatorIdentity('bb:20:bar:2.5')).not.toBe(indicatorIdentity('bb'));
    expect(addIndicator(['sma200', 'rsi'], 'sma:200:d').value).toEqual(['rsi', 'sma:200:d']);
  });
  it('updates existing periods at the ten-indicator limit and reports overflow instead of silently dropping it', () => {
    const input = Array.from({ length: 10 }, (_, i) => `sma:${i + 2}:d`);
    expect(addIndicator(input, 'ema:20:bar').error).toContain('최대 10개');
    expect(addIndicator(input, 'ema:20:bar').value).toEqual(input);
    const update = addIndicator(input, 'ema:20:bar', input[0]);
    expect(update.error).toBeUndefined();
    expect(update.value).toHaveLength(10);
    expect(update.value).toContain('ema:20:bar');
    expect(update.value).not.toContain(input[0]);
  });
  it('replaces single-pane indicators and leaves an invalid edit intact', () => {
    expect(addIndicator(['sma200', 'rsi'], 'rsi:7:bar').value).toEqual(['sma200', 'rsi:7:bar']);
    const input = ['sma200', 'bb'];
    expect(addIndicator(input, 'bb:0:bar:99', 'bb')).toMatchObject({
      value: input,
      error: expect.any(String),
    });
  });
});
