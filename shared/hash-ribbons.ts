import type { Point } from './types';
import { DAY } from './math';

export const HASH_RIBBONS_VERSION = 'bori-btc-hash-ribbons-30-60-price-10-20-v1';
export const HASHRATE_TREND_VERSION = 'bori-hashrate-trend-30-60-v1';
export type HashRibbonEvent = 'decrease' | 'recovery' | 'price-confirmed';
export interface HashRibbonRow {
  time: number;
  hashrate: number;
  hash30: number;
  hash60: number;
  price10: number | null;
  price20: number | null;
  state: 'decrease' | 'recovery' | 'normal';
  events: HashRibbonEvent[];
}

class RollingMean {
  private values: number[] = [];
  private mean = 0;
  private next = 0;
  constructor(private readonly size: number) {}
  reset(): void {
    this.values = [];
    this.mean = 0;
    this.next = 0;
  }
  add(value: number): number | null {
    if (this.values.length < this.size) {
      this.values.push(value);
      this.mean += (value - this.mean) / this.values.length;
    } else {
      this.mean += (value - this.values[this.next]) / this.size;
      this.values[this.next] = value;
      this.next = (this.next + 1) % this.size;
    }
    return this.values.length === this.size ? this.mean : null;
  }
}

function checkedCutoff(now: number): number {
  if (!(Number.isFinite(now) || now === Infinity) || now < 0)
    throw new Error('Invalid hash ribbon observation cutoff');
  return now;
}

function validDay(time: number): boolean {
  return Number.isSafeInteger(time) && time >= 0 && time % DAY === 0;
}

function priceMomentum(points: readonly Point[], now: number): Map<number, [number, number]> {
  const result = new Map<number, [number, number]>();
  const short = new RollingMean(10);
  const long = new RollingMean(20);
  let previous = -DAY;
  let seen = -1;
  for (const point of points) {
    if (!validDay(point.time) || point.time <= seen || point.time + DAY > now) continue;
    seen = point.time;
    if (!Number.isFinite(point.value) || point.value <= 0 || point.time - previous !== DAY) {
      short.reset();
      long.reset();
    }
    if (!Number.isFinite(point.value) || point.value <= 0) {
      previous = -DAY;
      continue;
    }
    previous = point.time;
    const price10 = short.add(point.value);
    const price20 = long.add(point.value);
    if (price10 !== null && price20 !== null) result.set(point.time, [price10, price20]);
  }
  return result;
}

function calculate(
  hashPoints: readonly Point[],
  momentum: Map<number, [number, number]> | null,
  now: number,
): HashRibbonRow[] {
  const rows: HashRibbonRow[] = [];
  const short = new RollingMean(30);
  const long = new RollingMean(60);
  let previous = -DAY;
  let seen = -1;
  let priorBelow: boolean | null = null;
  let cycle = false;
  let recovered = false;
  let confirmed = false;
  let priceQualified = false;
  for (const point of hashPoints) {
    if (!validDay(point.time) || point.time <= seen || point.time + DAY > now) continue;
    seen = point.time;
    if (!Number.isFinite(point.value) || point.value <= 0 || point.time - previous !== DAY) {
      short.reset();
      long.reset();
      priorBelow = null;
      cycle = false;
      recovered = false;
      confirmed = false;
      priceQualified = false;
    }
    if (!Number.isFinite(point.value) || point.value <= 0) {
      previous = -DAY;
      continue;
    }
    previous = point.time;
    const hash30 = short.add(point.value);
    const hash60 = long.add(point.value);
    if (hash30 === null || hash60 === null) continue;
    const tolerance = 16 * Number.EPSILON * Math.max(hash30, hash60);
    const equal = Math.abs(hash30 - hash60) <= tolerance;
    const below = !equal && hash30 < hash60;
    const events: HashRibbonEvent[] = [];
    if (below && priorBelow !== true) {
      // A first below-average reading starts a cycle, but cannot prove a downward crossing.
      if (priorBelow !== null) events.push('decrease');
      cycle = true;
      recovered = false;
      confirmed = false;
      priceQualified = momentum?.has(point.time) ?? false;
    }
    if (!below && !equal && hash30 > hash60 && priorBelow === true && cycle) {
      events.push('recovery');
      recovered = true;
    }
    const [price10, price20] = momentum?.get(point.time) ?? [null, null];
    // Losing continuous price inputs invalidates this cycle's pending confirmation.
    // A later warmed-up price series must wait for a new hash decrease/recovery cycle.
    if (momentum && (price10 === null || price20 === null)) priceQualified = false;
    if (
      recovered &&
      !below &&
      !confirmed &&
      priceQualified &&
      price10 !== null &&
      price20 !== null &&
      price10 - price20 > 16 * Number.EPSILON * Math.max(price10, price20)
    ) {
      events.push('price-confirmed');
      confirmed = true;
    }
    rows.push({
      time: point.time,
      hashrate: point.value,
      hash30,
      hash60,
      price10,
      price20,
      state: below ? 'decrease' : recovered ? 'recovery' : 'normal',
      events,
    });
    // Equality keeps the previous side; touching a mean is not itself a crossing.
    if (!equal || priorBelow === null) priorBelow = below;
  }
  return rows;
}

/** Generic PoW trend only; does not claim Bitcoin strategy results or price confirmation. */
export function hashrateTrend(
  hashPoints: readonly Point[],
  now = Date.now() / 1000,
): HashRibbonRow[] {
  return calculate(hashPoints, null, checkedCutoff(now));
}

/** BTC daily observations: hash 30/60 crossover followed by optional price 10/20 confirmation. */
export function hashRibbons(
  hashPoints: readonly Point[],
  pricePoints: readonly Point[],
  now = Date.now() / 1000,
): HashRibbonRow[] {
  checkedCutoff(now);
  return calculate(hashPoints, priceMomentum(pricePoints, now), now);
}
