import { describe, expect, it } from 'vitest';
import { eventPriceContext } from '../shared/event-price-context';
import { HISTORY_EVENTS, eventTime, type HistoryEvent } from '../shared/history-events';

const event: HistoryEvent = { ...HISTORY_EVENTS[0], date: '2022-11-11' };
const start = eventTime(event);
const DAY = 86400;
const points = Array.from({ length: 401 }, (_, i) => ({
  time: start + (i - 200) * DAY,
  value: 100 + i,
}));

describe('historical event price context', () => {
  it('focuses the selected event and uses exact calendar-day returns', () => {
    const context = eventPriceContext(points, event, 90);
    expect(context.range).toEqual({ from: start - 90 * DAY, to: start + 90 * DAY });
    expect(context.baseline?.value).toBe(300);
    expect(context.changes.map((c) => c.observation?.value)).toEqual([307, 330, 390]);
    expect(context.changes[1].percent).toBeCloseTo(10);
    expect(context.clipped).toBe(false);
  });
  it('does not turn a missing target date into a different-day return', () => {
    const context = eventPriceContext(
      points.filter((p) => p.time !== start + 7 * DAY),
      event,
      30,
    );
    expect(context.changes[0].percent).toBeUndefined();
    expect(context.changes[1].percent).toBeCloseTo(10);
  });
  it('does not calculate any return if the event-day price is absent or invalid', () => {
    for (const data of [
      points.filter((p) => p.time !== start),
      points.map((p) => (p.time === start ? { ...p, value: 0 } : p)),
    ]) {
      const context = eventPriceContext(data, event, 30);
      expect(context.baseline).toBeUndefined();
      expect(context.changes.every((c) => c.percent === undefined)).toBe(true);
    }
  });
  it('handles events before listing and empty histories without inventing prices', () => {
    for (const data of [[], points.filter((p) => p.time > start)]) {
      const context = eventPriceContext(data, event, 90);
      expect(context.outside).toBe(true);
      expect(context.range).toBeUndefined();
      expect(context.baseline).toBeUndefined();
    }
  });
  it('clips to observed history and leaves unobserved future returns empty', () => {
    const data = points.filter((p) => p.time <= start + 10 * DAY);
    const context = eventPriceContext(data, event, 90);
    expect(context.range?.to).toBe(start + 10 * DAY);
    expect(context.clipped).toBe(true);
    expect(context.changes[0].percent).toBeDefined();
    expect(context.changes[1].percent).toBeUndefined();
  });
  it('includes the entire month and omits day-specific returns for month precision', () => {
    const monthly = { ...event, date: '2022-11-01', precision: 'month' as const };
    const context = eventPriceContext(points, monthly, 30);
    expect(context.range).toEqual({
      from: Date.parse('2022-10-02T00:00:00Z') / 1000,
      to: Date.parse('2022-12-30T00:00:00Z') / 1000,
    });
    expect(context.changes.every((c) => c.percent === undefined)).toBe(true);
  });
  it('retains the overlapping part of a month when price history starts mid-month', () => {
    const monthly = { ...event, date: '2022-11-01', precision: 'month' as const };
    const context = eventPriceContext(
      points.filter((p) => p.time >= start),
      monthly,
      30,
    );
    expect(context.outside).toBe(false);
    expect(context.range?.from).toBe(start);
    expect(context.clipped).toBe(true);
    expect(context.baseline).toBeUndefined();
  });
});
