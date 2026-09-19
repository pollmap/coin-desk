/** Presets use UTC calendar dates, not an approximation of 30/365 days. */
export const PERIOD_OPTIONS = [
  { id: '1m', label: '1개월' },
  { id: '3m', label: '3개월' },
  { id: '6m', label: '6개월' },
  { id: 'ytd', label: '올해' },
  { id: '1y', label: '1년' },
  { id: '3y', label: '3년' },
  { id: '5y', label: '5년' },
  { id: 'all', label: '전체' },
] as const;
export type RangePeriod = (typeof PERIOD_OPTIONS)[number]['id'];
export function isRangePeriod(value: unknown): value is RangePeriod {
  return PERIOD_OPTIONS.some((p) => p.id === value);
}
export function periodStart(period: RangePeriod, nowSeconds = Date.now() / 1000): number {
  if (period === 'all') return 0;
  const date = new Date(nowSeconds * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid range date');
  const year = date.getUTCFullYear(),
    month = date.getUTCMonth(),
    day = date.getUTCDate();
  if (period === 'ytd') return Date.UTC(year, 0, 1) / 1000;
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60 }[period];
  const target = new Date(Date.UTC(year, month - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)) / 1000;
}
