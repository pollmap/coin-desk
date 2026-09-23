import type { Point } from './types';
import { DAY } from './math';

function dailySma(points: Point[], window: number): Point[] {
  const output: Point[] = [];
  const values: number[] = [];
  let sum = 0;
  let previous = -DAY;
  for (const point of points) {
    if (point.time - previous !== DAY) {
      values.length = 0;
      sum = 0;
    }
    previous = point.time;
    values.push(point.value);
    sum += point.value;
    if (values.length > window) sum -= values.shift()!;
    if (values.length === window) output.push({ time: point.time, value: sum / window });
  }
  return output;
}

function weeklyCloses(points: Point[]): Point[] {
  const output: Point[] = [];
  let week = -1;
  let last: Point | undefined;
  for (const point of points) {
    const date = new Date(point.time * 1000);
    const start = point.time - ((date.getUTCDay() + 6) % 7) * DAY;
    if (week !== -1 && start !== week && last) output.push(last);
    week = start;
    last = point;
  }
  // The current UTC week has not closed. Never use its provisional close.
  return output;
}

export function btcCycle(points: Point[]) {
  const ma730 = dailySma(points, 730);
  const ma111 = dailySma(points, 111);
  const ma350 = dailySma(points, 350);
  // Weekly observations are spaced by 7 days; compute their moving mean separately.
  const weeks = weeklyCloses(points);
  const weekly200: Point[] = [];
  let rolling = 0;
  for (let index = 0; index < weeks.length; index++) {
    rolling += weeks[index].value;
    if (index >= 200) rolling -= weeks[index - 200].value;
    if (index >= 199 && weeks[index].time - weeks[index - 199].time === 199 * 7 * DAY)
      weekly200.push({ time: weeks[index].time, value: rolling / 200 });
  }
  const latest = points.at(-1)?.value;
  let maximum = -Infinity;
  for (const point of points) maximum = Math.max(maximum, point.value);
  return {
    ma730,
    ma730x5: ma730.map((point) => ({ time: point.time, value: point.value * 5 })),
    ma111,
    ma350x2: ma350.map((point) => ({ time: point.time, value: point.value * 2 })),
    ma200w: weekly200,
    drawdown: latest !== undefined && maximum > 0 ? (latest / maximum - 1) * 100 : null,
  };
}
