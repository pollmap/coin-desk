import type { Point } from './types';
import { DAY } from './math';

function correlation(
  pairs: { time: number; asset: number; btc: number }[],
  window: number,
): number | null {
  if (pairs.length <= window) return null;
  const recent = pairs.slice(-window - 1);
  const x: number[] = [],
    y: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].time - recent[i - 1].time !== DAY) return null;
    x.push(Math.log(recent[i].asset / recent[i - 1].asset));
    y.push(Math.log(recent[i].btc / recent[i - 1].btc));
  }
  const mx = x.reduce((sum, value) => sum + value, 0) / window;
  const my = y.reduce((sum, value) => sum + value, 0) / window;
  let covariance = 0,
    vx = 0,
    vy = 0;
  for (let i = 0; i < window; i++) {
    covariance += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
    vy += (y[i] - my) ** 2;
  }
  return vx > 0 && vy > 0 ? covariance / Math.sqrt(vx * vy) : null;
}

export function relativeAnalysis(asset: Point[], btc: Point[]) {
  const btcByTime = new Map(btc.map((point) => [point.time, point.value]));
  const pairs = asset.flatMap((point) => {
    const reference = btcByTime.get(point.time);
    return reference && point.value > 0
      ? [{ time: point.time, asset: point.value, btc: reference }]
      : [];
  });
  const first = pairs[0];
  const ratio = pairs.map((point) => ({ time: point.time, value: point.asset / point.btc }));
  const relative = first
    ? pairs.map((point) => ({
        time: point.time,
        value: (100 * (point.asset / first.asset)) / (point.btc / first.btc),
      }))
    : [];
  let maximum = -Infinity;
  const drawdowns = asset.map((point) => {
    maximum = Math.max(maximum, point.value);
    return { time: point.time, value: (point.value / maximum - 1) * 100 };
  });
  return {
    ratio,
    relative,
    drawdown: drawdowns.at(-1)?.value ?? null,
    correlation30: correlation(pairs, 30),
    correlation90: correlation(pairs, 90),
    first: first?.time ?? null,
    last: pairs.at(-1)?.time ?? null,
  };
}
