import { eventTime, type HistoryEvent } from './history-events';

const DAY = 86400;
type Price = { time: number; value: number };

/** Exact UTC calendar observations only; never substitute a later price for a missing day. */
export function eventPriceContext(points: readonly Price[], event: HistoryEvent, days: number) {
  const start = eventTime(event);
  const date = new Date(start * 1000);
  const end =
    event.precision === 'month'
      ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000 - DAY
      : start;
  const first = points[0]?.time;
  const last = points.at(-1)?.time;
  const outside = first === undefined || last === undefined || end < first || start > last;
  const from = Math.max(first ?? start, start - days * DAY);
  const to = Math.min(last ?? end, end + days * DAY);
  const byDay = new Map(points.map((p) => [Math.floor(p.time / DAY), p]));
  const at = (offset: number) => {
    const point = byDay.get(Math.floor(start / DAY) + offset);
    return point && Number.isFinite(point.value) && point.value > 0 ? point : undefined;
  };
  const baseline = event.precision === 'month' ? undefined : at(0);
  return {
    outside,
    range: !outside && from < to ? { from, to } : undefined,
    clipped: !outside && (from > start - days * DAY || to < end + days * DAY),
    baseline,
    changes: [7, 30, 90].map((offset) => {
      const observation = at(offset);
      return {
        days: offset,
        observation: baseline ? observation : undefined,
        percent:
          baseline && observation ? (observation.value / baseline.value - 1) * 100 : undefined,
      };
    }),
  };
}
