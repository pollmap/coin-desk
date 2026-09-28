import type { Point } from './types';
import { DAY } from './math';

export const BAND_DAYS = 730;
export const BAND_OFFSETS = [-2, -1.3, -0.55, 0.55, 1.3, 2] as const;

export interface HistoryBandPoint {
  time: number;
  price: number;
  center: number;
  sigma: number;
  z: number | null;
  bands: number[];
  peak: number;
  drawdown: number;
}

/** Prior 730 consecutive UTC observations only; the plotted day's price never sets its own band. */
export function historyBands(points: Point[]): HistoryBandPoint[] {
  const result: HistoryBandPoint[] = [];
  const window: number[] = [];
  const counts = new Map<number, number>();
  let sum = 0;
  let sumSquares = 0;
  let previous = -DAY;
  let peak = 0;
  for (const point of points) {
    if (!Number.isSafeInteger(point.time) || !Number.isFinite(point.value) || point.value <= 0) {
      window.length = 0;
      counts.clear();
      sum = 0;
      sumSquares = 0;
      previous = -DAY;
      continue;
    }
    if (point.time - previous !== DAY) {
      window.length = 0;
      counts.clear();
      sum = 0;
      sumSquares = 0;
    }
    previous = point.time;
    const value = Math.log(point.value);
    if (window.length === BAND_DAYS) {
      const mean = sum / BAND_DAYS;
      // A flat window has no standardised position. Avoid cancellation noise
      // turning identical prices into a small, nonzero variance.
      const sigma =
        counts.size === 1 ? 0 : Math.sqrt(Math.max(0, sumSquares / BAND_DAYS - mean * mean));
      result.push({
        time: point.time,
        price: point.value,
        center: Math.exp(mean),
        sigma,
        z: sigma > 1e-10 ? (value - mean) / sigma : null,
        bands: BAND_OFFSETS.map((offset) => Math.exp(mean + offset * sigma)),
        peak: Math.max(peak, point.value),
        drawdown: (point.value / Math.max(peak, point.value) - 1) * 100,
      });
    }
    window.push(value);
    counts.set(value, (counts.get(value) ?? 0) + 1);
    sum += value;
    sumSquares += value * value;
    if (window.length > BAND_DAYS) {
      const removed = window.shift()!;
      const count = counts.get(removed)! - 1;
      if (count) counts.set(removed, count);
      else counts.delete(removed);
      sum -= removed;
      sumSquares -= removed * removed;
    }
    peak = Math.max(peak, point.value);
  }
  return result;
}

export function bandPosition(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return '변동 폭 없음';
  if (z < -1.3) return '깊은 하단';
  if (z < -0.55) return '하단';
  if (z <= 0.55) return '중앙';
  if (z <= 1.3) return '상단';
  return '높은 상단';
}
