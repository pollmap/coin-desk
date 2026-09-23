import type { Candle, Interval, Point } from './types';
export const DAY = 86400;
export function bucket(t: number, interval: Interval): number {
  const d = new Date(t * 1000);
  if (interval === '1M') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  if (interval === '1w') return Math.floor((t - 4 * DAY) / (7 * DAY)) * 7 * DAY + 4 * DAY;
  const size = interval === '1h' ? 3600 : interval === '4h' ? 14400 : DAY;
  return Math.floor(t / size) * size;
}
export function bucketEnd(t: number, interval: Interval): number {
  if (interval === '1M') {
    const d = new Date(t * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return (
    t + (interval === '1w' ? 7 * DAY : interval === '1d' ? DAY : interval === '4h' ? 14400 : 3600)
  );
}
export function aggregate(input: Candle[], interval: Interval, now = Date.now() / 1000): Candle[] {
  const groups = new Map<number, Candle>();
  for (const c of input) {
    const t = bucket(c.time, interval),
      existing = groups.get(t);
    if (existing) {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    } else groups.set(t, { ...c, time: t, closeTime: bucketEnd(t, interval), closed: false });
  }
  return [...groups.values()]
    .sort((a, b) => a.time - b.time)
    .map((c) => ({ ...c, closed: c.closeTime <= now }));
}
export function sma(points: Point[], period: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].value;
    if (i >= period) sum -= points[i - period].value;
    if (i >= period - 1) out.push({ time: points[i].time, value: sum / period });
  }
  return out;
}
export function rsi(points: Point[], period = 14): Point[] {
  if (points.length <= period) return [];
  let gain = 0,
    loss = 0;
  const out: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const diff = points[i].value - points[i - 1].value,
      g = Math.max(diff, 0),
      l = Math.max(-diff, 0);
    if (i <= period) {
      gain += g / period;
      loss += l / period;
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
    }
    if (i >= period)
      out.push({
        time: points[i].time,
        value: loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss),
      });
  }
  return out;
}
export function bollinger(
  points: Point[],
  period = 20,
  multiplier = 2,
): { middle: Point[]; upper: Point[]; lower: Point[] } {
  const middle = sma(points, period),
    upper: Point[] = [],
    lower: Point[] = [];
  for (let i = period - 1; i < points.length; i++) {
    const mean = middle[i - period + 1].value;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (points[j].value - mean) ** 2;
    const width = multiplier * Math.sqrt(variance / period);
    upper.push({ time: points[i].time, value: mean + width });
    lower.push({ time: points[i].time, value: mean - width });
  }
  return { middle, upper, lower };
}
/** EMA seeded with the first period's SMA. MACD signal follows the same rule. */
export function ema(points: Point[], period: number): Point[] {
  if (points.length < period) return [];
  let value = points.slice(0, period).reduce((sum, p) => sum + p.value, 0) / period;
  const out = [{ time: points[period - 1].time, value }];
  const alpha = 2 / (period + 1);
  for (let i = period; i < points.length; i++) {
    value += alpha * (points[i].value - value);
    out.push({ time: points[i].time, value });
  }
  return out;
}
export function macd(points: Point[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (
    ![fastPeriod, slowPeriod, signalPeriod].every(
      (v) => Number.isInteger(v) && v >= 2 && v <= 1000,
    ) ||
    fastPeriod >= slowPeriod
  )
    return { line: [], signal: [], histogram: [] };
  const fast = new Map(ema(points, fastPeriod).map((p) => [p.time, p.value]));
  const line = ema(points, slowPeriod).map((p) => ({
    time: p.time,
    value: fast.get(p.time)! - p.value,
  }));
  const signal = ema(line, signalPeriod),
    byTime = new Map(signal.map((p) => [p.time, p.value]));
  const histogram = line
    .filter((p) => byTime.has(p.time))
    .map((p) => ({ time: p.time, value: p.value - byTime.get(p.time)! }));
  return { line, signal, histogram };
}
export interface ZState {
  n: number;
  mean: number;
  m2: number;
}
export function zStep(
  state: ZState,
  market: number | null,
  realized: number | null,
): { state: ZState; value: number | null } {
  if (
    market === null ||
    realized === null ||
    !Number.isFinite(market) ||
    !Number.isFinite(realized) ||
    market <= 0 ||
    realized <= 0
  )
    return { state, value: null };
  const n = state.n + 1,
    delta = market - state.mean,
    mean = state.mean + delta / n,
    m2 = state.m2 + delta * (market - mean),
    variance = Math.max(0, m2 / n);
  return {
    state: { n, mean, m2 },
    value: n >= 365 && variance > 0 ? (market - realized) / Math.sqrt(variance) : null,
  };
}
export function atBarClose(
  points: Point[],
  baseInterval: Interval,
  candles: Candle[],
  now = Date.now() / 1000,
): Point[] {
  let index = 0;
  let last: Point | undefined;
  const out: Point[] = [];
  for (const c of candles) {
    const availableAt = Math.min(c.closeTime, now);
    while (index < points.length && bucketEnd(points[index].time, baseInterval) <= availableAt) {
      last = points[index++];
    }
    if (last) out.push({ time: c.time, value: last.value });
  }
  return out;
}
export function validCandle(c: Candle): boolean {
  return (
    [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
    c.time > 0 &&
    c.open > 0 &&
    c.close > 0 &&
    c.low > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.volume >= 0
  );
}
