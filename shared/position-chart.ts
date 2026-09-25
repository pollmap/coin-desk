import type { Point } from './types';
import type { HistoryBandPoint } from './history-bands';
import { DAY } from './math';

export const PRICE_TOP = 18;
export const PRICE_BOTTOM = 250;
export const DRAWDOWN_TOP = 300;
export const DRAWDOWN_BOTTOM = 360;
export const drawdownY = (value: number) =>
  DRAWDOWN_TOP - (Math.max(-100, Math.min(0, value)) / 100) * (DRAWDOWN_BOTTOM - DRAWDOWN_TOP);

/** Keep every daily observation, including prices before band calculation begins. */
export function priceObservations(points: Point[]) {
  let peak = 0;
  return points
    .filter((p) => Number.isSafeInteger(p.time) && Number.isFinite(p.value) && p.value > 0)
    .map((p) => {
      peak = Math.max(peak, p.value);
      return { time: p.time, price: p.value, drawdown: (p.value / peak - 1) * 100 };
    });
}

export function consecutiveSegments<T extends { time: number }>(points: T[]): T[][] {
  const segments: T[][] = [];
  for (const point of points) {
    const current = segments.at(-1);
    if (!current || point.time - current.at(-1)!.time !== DAY) segments.push([point]);
    else current.push(point);
  }
  return segments;
}

export function positionGeometry(
  points: ReturnType<typeof priceObservations>,
  bands: HistoryBandPoint[],
  width: number,
  log = true,
) {
  if (points.length < 2) return null;
  const left = 76,
    right = Math.max(left + 100, width - 12);
  const first = points[0].time,
    last = points.at(-1)!.time;
  if (last <= first) return null;
  const transform = log ? Math.log : (value: number) => value;
  const inverse = log ? Math.exp : (value: number) => value;
  let low = Infinity,
    high = -Infinity;
  for (const p of points) {
    low = Math.min(low, transform(p.price));
    high = Math.max(high, transform(p.price));
  }
  for (const p of bands) {
    low = Math.min(low, transform(p.bands[0]));
    high = Math.max(high, transform(p.bands[5]));
  }
  const padding = Math.max(log ? 0.1 : 1e-12, (high - low) * 0.07);
  const min = log ? low - padding : Math.max(0, low - padding),
    max = high + padding;
  const x = (time: number) => left + ((time - first) / (last - first)) * (right - left);
  const y = (price: number) =>
    PRICE_BOTTOM - ((transform(price) - min) / (max - min)) * (PRICE_BOTTOM - PRICE_TOP);
  const paths = consecutiveSegments(points).map((segment) => ({
    price: segment
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.price).toFixed(1)}`)
      .join(' '),
    drawdown: segment
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${drawdownY(p.drawdown).toFixed(1)}`)
      .join(' '),
  }));
  const polygons = consecutiveSegments(bands).flatMap((segment) =>
    Array.from({ length: 5 }, (_, band) => ({
      band,
      points: [
        ...segment.map((p) => `${x(p.time).toFixed(1)},${y(p.bands[band + 1]).toFixed(1)}`),
        ...[...segment]
          .reverse()
          .map((p) => `${x(p.time).toFixed(1)},${y(p.bands[band]).toFixed(1)}`),
      ].join(' '),
    })),
  );
  return {
    x,
    y,
    left,
    right,
    min,
    max,
    first,
    last,
    paths,
    polygons,
    tick: (fraction: number) => inverse(min + (max - min) * fraction),
  };
}
