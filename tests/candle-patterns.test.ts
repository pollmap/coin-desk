import { describe, it, expect } from 'vitest';
import { PATTERNS, detectPatterns, validPatterns, type PatternId } from '../shared/candle-patterns';
import { DAY, bucketEnd } from '../shared/math';
import type { Candle, Interval } from '../shared/types';
const t = Date.UTC(2024, 0, 1) / 1000;
const candle = (i: number, open: number, close: number, extra: Partial<Candle> = {}): Candle => ({
  time: t + i * DAY,
  open,
  close,
  high: Math.max(open, close) + 5,
  low: Math.min(open, close) - 5,
  volume: 100,
  closeTime: t + (i + 1) * DAY,
  closed: true,
  ...extra,
});
describe('confirmed candle morphology and causal trend filters', () => {
  it('engulfs bodies, not necessarily wicks, and reports the confirmation time', () => {
    const a = candle(0, 100, 90, { high: 115, low: 75 }),
      b = candle(1, 89, 101, { high: 105, low: 85 });
    const hits = detectPatterns([a, b], ['bullish-engulfing'], 'none', '1d', b.closeTime);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      time: b.time,
      from: a.time,
      confirmedAt: b.closeTime,
      body: 12,
      range: 20,
    });
    expect(
      detectPatterns(
        [a, { ...b, open: 90, close: 100 }],
        ['bullish-engulfing'],
        'none',
        '1d',
        b.closeTime,
      ),
    ).toHaveLength(0);
    expect(
      detectPatterns(
        [a, { ...b, open: 92, high: 120, low: 70 }],
        ['bullish-engulfing'],
        'none',
        '1d',
        b.closeTime,
      ),
    ).toHaveLength(0);
  });
  it('mirrors bullish and bearish logic without interpreting an outside wick as engulfing', () => {
    const a = candle(0, 90, 100),
      b = candle(1, 101, 89);
    expect(
      detectPatterns([a, b], ['bullish-engulfing', 'bearish-engulfing'], 'none'),
    ).toMatchObject([{ pattern: 'bearish-engulfing', direction: 'down' }]);
  });
  it('does not finalize an open, future, short, invalid or missing bar', () => {
    const a = candle(0, 100, 90),
      b = candle(1, 89, 101);
    for (const patch of [
      { closed: false },
      { closeTime: b.closeTime - 600 },
      { high: 80 },
      { volume: -1 },
      { close: NaN },
    ])
      expect(detectPatterns([a, { ...b, ...patch }], ['bullish-engulfing'], 'none')).toHaveLength(
        0,
      );
    expect(
      detectPatterns([a, b], ['bullish-engulfing'], 'none', '1d', b.closeTime - 1),
    ).toHaveLength(0);
    expect(detectPatterns([a, candle(2, 89, 101)], ['bullish-engulfing'], 'none')).toHaveLength(0);
  });
  it('resets around duplicate or unordered input and does not double count', () => {
    const a = candle(0, 100, 90),
      b = candle(1, 89, 101);
    expect(detectPatterns([a, b, b], ['bullish-engulfing'], 'none')).toHaveLength(1);
    const d = candle(2, 100, 100);
    expect(detectPatterns([d, d], ['doji'], 'none')).toHaveLength(1);
  });
  it('requires prior observations for trend and never uses the result candle in the trend mean', () => {
    const history = Array.from({ length: 55 }, (_, i) => candle(i, 210 - i, 209 - i));
    const last = history.at(-1)!;
    const next = candle(55, last.close - 1, 400);
    const hit = detectPatterns([...history, next], ['bullish-engulfing'], 'sma50').at(-1)!;
    expect(hit).toBeDefined();
    expect(hit.sma50).toBeCloseTo(history.slice(-50).reduce((s, c) => s + c.close, 0) / 50);
    expect(hit.previousClose).toBeLessThan(hit.sma50!);
    expect(detectPatterns([last, next], ['bullish-engulfing'], 'sma50')).toHaveLength(0);
    expect(detectPatterns([...history, next], ['bullish-engulfing'], 'sma50-200')).toHaveLength(0);
    const h200 = Array.from({ length: 205 }, (_, i) => candle(i, 510 - i, 509 - i));
    expect(
      detectPatterns([...h200, candle(205, 303, 600)], ['bullish-engulfing'], 'sma50-200'),
    ).toHaveLength(1);
  });
  it('recognizes every published example and explicitly ignores trend for neutral doji', () => {
    for (const p of PATTERNS) {
      const bars = p.demo.map((c, i) => candle(i, c.open, c.close, c));
      expect(
        detectPatterns(bars, [p.id], 'none').some((h) => h.pattern === p.id),
        p.id,
      ).toBe(true);
    }
    expect(detectPatterns([candle(0, 100, 100)], ['doji'], 'sma50-200')).toHaveLength(1);
    expect(
      detectPatterns([candle(0, 100, 100, { high: 100, low: 100 })], ['doji'], 'none'),
    ).toHaveLength(0);
  });
  it('supports zero volume shapes without making a VWAP and honors calendar month boundaries', () => {
    expect(detectPatterns([candle(0, 100, 100, { volume: 0 })], ['doji'], 'none')).toHaveLength(1);
    for (const interval of ['1h', '4h', '1w', '1M'] as Interval[]) {
      const first = { ...candle(0, 100, 90), closeTime: bucketEnd(t, interval) };
      const second = {
        ...candle(1, 89, 101),
        time: first.closeTime,
        closeTime: bucketEnd(first.closeTime, interval),
      };
      expect(detectPatterns([first, second], ['bullish-engulfing'], 'none', interval)).toHaveLength(
        1,
      );
    }
  });
  it('is scale invariant and later data cannot change existing hits', () => {
    const rows = [candle(0, 100, 90), candle(1, 89, 101)],
      ids: PatternId[] = ['bullish-engulfing', 'doji'];
    const a = detectPatterns(rows, ids, 'none');
    const scaled = rows.map((c) => ({
      ...c,
      open: c.open * 0.001,
      high: c.high * 0.001,
      low: c.low * 0.001,
      close: c.close * 0.001,
    }));
    expect(detectPatterns(scaled, ids, 'none').map((h) => h.id)).toEqual(a.map((h) => h.id));
    expect(
      detectPatterns([...rows, candle(2, 120, 90)], ids, 'none').filter(
        (h) => h.time <= rows[1].time,
      ),
    ).toEqual(a);
    expect(validPatterns(['unknown', 'bullish-engulfing', 'bullish-engulfing', {}])).toEqual([
      'bullish-engulfing',
    ]);
  });
});
