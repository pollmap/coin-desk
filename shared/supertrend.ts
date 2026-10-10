import { bucket, bucketEnd } from './math';
import type { Candle, Interval } from './types';

export const SUPERTREND_VERSION = 'ohlc-wilder-supertrend-v1';
export interface SupertrendSettings {
  period: number;
  multiplier: number;
}
export interface SupertrendRow {
  time: number;
  value: number;
  atr: number;
  upper: number;
  lower: number;
  direction: 'up' | 'down';
  bodyMiddle: number;
}
export function validSupertrendOption(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (key === 'st_period')
    return /^\d{1,4}$/.test(value) && Number(value) >= 2 && Number(value) <= 1000;
  return (
    key === 'st_multiplier' &&
    /^\d{1,2}(\.\d{1,2})?$/.test(value) &&
    Number(value) >= 0.5 &&
    Number(value) <= 10
  );
}
export function supertrendSettings(params: URLSearchParams): SupertrendSettings {
  return {
    period: validSupertrendOption('st_period', params.get('st_period'))
      ? Number(params.get('st_period'))
      : 10,
    multiplier: validSupertrendOption('st_multiplier', params.get('st_multiplier'))
      ? Number(params.get('st_multiplier'))
      : 3,
  };
}
/** Actual, consecutive, finalized OHLC only. RMA is SMA-seeded; no future bars or gap filling. */
export function supertrend(
  candles: Candle[],
  interval: Interval = '1d',
  settings: SupertrendSettings = { period: 10, multiplier: 3 },
  now = Date.now() / 1000,
): SupertrendRow[] {
  const { period, multiplier } = settings;
  if (
    !Number.isInteger(period) ||
    period < 2 ||
    period > 1000 ||
    !Number.isFinite(multiplier) ||
    multiplier < 0.5 ||
    multiplier > 10
  )
    return [];
  const out: SupertrendRow[] = [];
  let previous: Candle | undefined, previousRow: SupertrendRow | undefined;
  let samples = 0,
    seed = 0,
    atr: number | undefined;
  const reset = () => {
    previous = undefined;
    previousRow = undefined;
    samples = 0;
    seed = 0;
    atr = undefined;
  };
  for (const c of [...candles].sort((a, b) => a.time - b.time)) {
    const valid =
      c.closed &&
      c.closeTime <= now &&
      Number.isSafeInteger(c.time) &&
      c.time > 0 &&
      bucket(c.time, interval) === c.time &&
      c.closeTime >= bucketEnd(c.time, interval) - 1 &&
      [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0) &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close) &&
      c.high >= c.low;
    if (!valid) {
      reset();
      continue;
    }
    if (previous && c.time !== bucketEnd(previous.time, interval)) reset();
    const tr = previous
      ? Math.max(
          c.high - c.low,
          Math.abs(c.high - previous.close),
          Math.abs(c.low - previous.close),
        )
      : c.high - c.low;
    samples++;
    if (atr === undefined) {
      seed += tr;
      if (samples >= period) atr = seed / period;
    } else atr = (atr * (period - 1) + tr) / period;
    if (atr !== undefined) {
      const middle = c.high / 2 + c.low / 2;
      const basicUpper = middle + multiplier * atr,
        basicLower = middle - multiplier * atr;
      // TradingView's previous-band nz seed is zero; the first ATR direction is down.
      const upper =
        !previousRow || basicUpper < previousRow.upper || previous!.close > previousRow.upper
          ? basicUpper
          : previousRow.upper;
      const lower = !previousRow
        ? Math.max(0, basicLower)
        : basicLower > previousRow.lower || previous!.close < previousRow.lower
          ? basicLower
          : previousRow.lower;
      const direction = !previousRow
        ? 'down'
        : previousRow.value === previousRow.upper
          ? c.close > upper
            ? 'up'
            : 'down'
          : c.close < lower
            ? 'down'
            : 'up';
      const row: SupertrendRow = {
        time: c.time,
        value: direction === 'up' ? lower : upper,
        atr,
        upper,
        lower,
        direction,
        bodyMiddle: c.open / 2 + c.close / 2,
      };
      if (![atr, upper, lower, row.value].every(Number.isFinite)) {
        reset();
        continue;
      }
      out.push(row);
      previousRow = row;
    }
    previous = c;
  }
  return out;
}
