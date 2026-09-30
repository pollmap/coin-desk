import type { Point } from './types';
import { DAY } from './math';

export const RAINBOW_VERSION = 'coin-desk-expanding-log-regression-v1';
export const RAINBOW_MIN_OBSERVATIONS = 730;
export const RAINBOW_OFFSETS = Array.from({ length: 10 }, (_, i) => -2.25 + i * 0.5);
const GENESIS = Date.UTC(2009, 0, 3) / 1000;
export interface RainbowPoint {
  time: number;
  price: number;
  center: number;
  sigma: number;
  z: number | null;
  bands: number[];
  a: number;
  b: number;
  observations: number;
  first: number;
  last: number;
}
/** O(n) expanding OLS. A plotted day never participates in its own fit. */
export function btcRainbow(points: Point[]): RainbowPoint[] {
  const out: RainbowPoint[] = [];
  let n = 0,
    mx = 0,
    my = 0,
    sxx = 0,
    sxy = 0,
    syy = 0,
    first = 0,
    last = 0;
  for (const p of points) {
    if (
      !Number.isSafeInteger(p.time) ||
      p.time % DAY !== 0 ||
      p.time <= GENESIS ||
      !Number.isFinite(p.value) ||
      p.value <= 0 ||
      p.time <= last
    )
      continue;
    const x = Math.log((p.time - GENESIS) / DAY),
      y = Math.log(p.value);
    if (n >= RAINBOW_MIN_OBSERVATIONS && sxx > 0) {
      const b = sxy / sxx,
        a = my - b * mx,
        variance = Math.max(0, (syy - b * sxy) / n),
        sigma = Math.sqrt(variance),
        center = Math.exp(a + b * x);
      out.push({
        time: p.time,
        price: p.value,
        center,
        sigma,
        z: sigma > 1e-10 ? (y - a - b * x) / sigma : null,
        bands: RAINBOW_OFFSETS.map((k) => Math.exp(a + b * x + k * sigma)),
        a,
        b,
        observations: n,
        first,
        last,
      });
    }
    n++;
    const dx = x - mx,
      dy = y - my;
    mx += dx / n;
    my += dy / n;
    sxx += dx * (x - mx);
    sxy += dx * (y - my);
    syy += dy * (y - my);
    first ||= p.time;
    last = p.time;
  }
  return out;
}
