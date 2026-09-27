import type { Candle, Point } from './types';
import { DAY } from './math';

export const ANALYSIS_VIEWS = [
  'price',
  'rainbow',
  'ribbon',
  'vwap',
  'relative',
  'cycles',
  'windows',
  'seasonality',
  'powerlaw',
] as const;
export type AnalysisView = (typeof ANALYSIS_VIEWS)[number];
export const analysisView = (v: unknown): AnalysisView =>
  ANALYSIS_VIEWS.includes(v as AnalysisView) ? (v as AnalysisView) : 'price';
export const ANALYSIS_LABELS: Record<AnalysisView, string> = {
  price: '가격·지표',
  rainbow: '가격 위치 밴드',
  ribbon: '이동평균 리본',
  vwap: '365일 VWAP',
  relative: '상대강도·상관',
  cycles: '반감기 사이클',
  windows: '과거 구간 비교',
  seasonality: '계절성',
  powerlaw: 'BTC 파워로 기준선',
};
export function cleanDaily(points: Point[]): Point[] {
  return [
    ...new Map(
      points
        .filter(
          (p) =>
            Number.isFinite(p.time) &&
            p.time % DAY === 0 &&
            Number.isFinite(p.value) &&
            p.value > 0,
        )
        .map((p) => [p.time, p]),
    ).values(),
  ].sort((a, b) => a.time - b.time);
}
/** Reference data contains closes only. Preserve the last actual observation timestamp. */
export function aggregateCloses(points: Point[], interval: string): Point[] {
  if (interval !== '1w' && interval !== '1M') return points;
  const groups = new Map<string | number, Point>();
  for (const p of points) {
    const d = new Date(p.time * 1000);
    const key =
      interval === '1M' ? d.toISOString().slice(0, 7) : p.time - ((d.getUTCDay() + 6) % 7) * DAY;
    groups.set(key, p);
  }
  return [...groups.values()];
}
/** Confirmed daily HLC3 weighted by native-asset volume. Gaps/invalid bars reset the window. */
export function rollingVwap(candles: Candle[], window = 365): Point[] {
  const out: Point[] = [],
    queue: { time: number; pv: number; volume: number }[] = [];
  let pv = 0,
    volume = 0,
    previous = -1;
  for (const c of [...candles].sort((a, b) => a.time - b.time)) {
    const valid =
      c.closed &&
      c.closeTime <= Date.now() / 1000 &&
      [c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
      c.volume >= 0 &&
      c.low > 0 &&
      c.high >= c.low &&
      c.close >= c.low &&
      c.close <= c.high;
    if (!valid || c.time - previous !== DAY) {
      queue.length = 0;
      pv = 0;
      volume = 0;
    }
    previous = c.time;
    if (!valid) continue;
    const row = { time: c.time, pv: ((c.high + c.low + c.close) / 3) * c.volume, volume: c.volume };
    queue.push(row);
    pv += row.pv;
    volume += row.volume;
    if (queue.length > window) {
      const old = queue.shift()!;
      pv -= old.pv;
      volume -= old.volume;
    }
    if (queue.length === window && volume > 0) out.push({ time: c.time, value: pv / volume });
  }
  return out;
}
export function vwapReclaims(
  closes: Point[],
  vwap: Point[],
  belowRequired = 100,
  aboveRequired = 7,
): Point[] {
  const byTime = new Map(vwap.map((p) => [p.time, p.value]));
  const out: Point[] = [];
  let below = 0,
    above = 0,
    armed = false,
    previous = -1;
  for (const p of closes) {
    const line = byTime.get(p.time);
    if (p.time - previous !== DAY || line === undefined) {
      below = 0;
      above = 0;
      armed = false;
    }
    previous = p.time;
    if (line === undefined) continue;
    if (p.value < line) {
      if (above > 0) armed = false;
      below++;
      above = 0;
      if (below >= belowRequired) armed = true;
    } else if (p.value > line) {
      below = 0;
      if (armed && ++above === aboveRequired) {
        out.push(p);
        armed = false;
        above = 0;
      }
    } else {
      below = 0;
      above = 0;
      armed = false;
    }
  }
  return out;
}
export const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'];
export interface ComparisonPath {
  name: string;
  anchor: number;
  first: number;
  points: Point[];
}
export function normalizeWindow(
  points: Point[],
  from: number,
  to: number,
  name: string,
): ComparisonPath {
  const data = cleanDaily(points).filter((p) => p.time >= from && p.time <= to);
  const first = data[0];
  return {
    name,
    anchor: from,
    first: first?.time ?? from,
    points: first
      ? data.map((p) => ({
          time: (p.time - first.time) / DAY,
          value: (p.value / first.value) * 100,
        }))
      : [],
  };
}
export function halvingCycles(points: Point[]): ComparisonPath[] {
  return HALVINGS.map((s, i) =>
    normalizeWindow(
      points,
      Date.parse(s) / 1000,
      i < HALVINGS.length - 1 ? Date.parse(HALVINGS[i + 1]) / 1000 - DAY : Infinity,
      s,
    ),
  ).filter((p) => p.points.length);
}
export function powerLaw(points: Point[]): Point[] {
  const origin = Date.parse('2009-01-03T00:00:00Z') / 1000;
  return points
    .filter((p) => p.time > origin)
    .map((p) => ({ time: p.time, value: 4.42e-17 * ((p.time - origin) / DAY) ** 5.6 }));
}
export type Normalization = 'percent' | 'index' | 'ratio';
export function alignComparison(series: { name: string; data: Point[] }[], mode: Normalization) {
  if (!series.length) return [];
  const maps = series.map((s) => new Map(cleanDaily(s.data).map((p) => [p.time, p.value])));
  const times = [...maps[0].keys()].filter((t) => maps.every((m) => m.has(t)));
  return series.map((s, i) => ({
    name: s.name,
    data: times.map((t) => ({
      time: t,
      value:
        mode === 'ratio'
          ? maps[i].get(t)! / maps[0].get(t)!
          : mode === 'index'
            ? (maps[i].get(t)! / maps[i].get(times[0])!) * 100
            : (maps[i].get(t)! / maps[i].get(times[0])! - 1) * 100,
    })),
  }));
}
export function rollingCorrelation(left: Point[], right: Point[], window: number): Point[] {
  const aligned = alignComparison(
    [
      { name: 'a', data: left },
      { name: 'b', data: right },
    ],
    'index',
  );
  if (!aligned.length) return [];
  const [a, b] = aligned;
  const out: Point[] = [];
  let returns: { a: number; b: number }[] = [];
  for (let i = 1; i < a.data.length; i++) {
    if (a.data[i].time - a.data[i - 1].time !== DAY) {
      returns = [];
      continue;
    }
    returns.push({
      a: Math.log(a.data[i].value / a.data[i - 1].value),
      b: Math.log(b.data[i].value / b.data[i - 1].value),
    });
    if (returns.length > window) returns.shift();
    if (returns.length !== window) continue;
    const ma = returns.reduce((s, p) => s + p.a, 0) / window,
      mb = returns.reduce((s, p) => s + p.b, 0) / window;
    const aa = returns.reduce((s, p) => s + (p.a - ma) ** 2, 0),
      bb = returns.reduce((s, p) => s + (p.b - mb) ** 2, 0);
    if (aa > 1e-20 && bb > 1e-20)
      out.push({
        time: a.data[i].time,
        value: Math.max(
          -1,
          Math.min(
            1,
            returns.reduce((s, p) => s + (p.a - ma) * (p.b - mb), 0) / Math.sqrt(aa * bb),
          ),
        ),
      });
  }
  return out;
}
function quantile(values: number[], q: number) {
  const a = [...values].sort((a, b) => a - b),
    x = (a.length - 1) * q,
    i = Math.floor(x);
  return a[i] + (a[Math.ceil(x)] - a[i]) * (x - i);
}
export interface Seasonality {
  years: number[];
  paths: { year: number; data: Point[] }[];
  current: Point[];
  summary: {
    day: number;
    mean: number;
    median: number;
    low: number;
    high: number;
    geometric: number;
    samples: number;
  }[];
}
export function seasonality(input: Point[], now = Date.now() / 1000): Seasonality {
  const points = cleanDaily(input).filter((p) => p.time < Math.floor(now / DAY) * DAY),
    map = new Map(points.map((p) => [p.time, p.value]));
  const currentYear = new Date(now * 1000).getUTCFullYear();
  const years = [...new Set(points.map((p) => new Date(p.time * 1000).getUTCFullYear()))];
  const paths: Seasonality['paths'] = [],
    logs: number[][] = [];
  let current: Point[] = [];
  for (const year of years) {
    const start = Date.UTC(year, 0, 1) / 1000,
      end = Date.UTC(year + 1, 0, 1) / 1000;
    const base = map.get(start - DAY);
    if (!base) continue;
    let previous = base,
      fold = 0,
      complete = true,
      index = 0;
    const data: Point[] = [],
      dailyLogs: number[] = [];
    for (let t = start; t < end; t += DAY) {
      const value = map.get(t);
      if (value === undefined) {
        complete = false;
        break;
      }
      const d = new Date(t * 1000);
      const log = Math.log(value / previous);
      previous = value;
      if (d.getUTCMonth() === 1 && d.getUTCDate() === 29) {
        fold = log;
        continue;
      }
      data.push({ time: index, value: (value / base - 1) * 100 });
      dailyLogs.push(log + fold);
      fold = 0;
      index++;
    }
    if (year === currentYear) current = data;
    if (complete && year < currentYear) {
      paths.push({ year, data });
      logs.push(dailyLogs);
    }
  }
  let cumulative = 0;
  const summary =
    paths.length < 3
      ? []
      : Array.from({ length: 365 }, (_, day) => {
          const values = paths.map((p) => p.data[day].value);
          cumulative += logs.reduce((s, a) => s + a[day], 0) / logs.length;
          return {
            day,
            mean: values.reduce((a, b) => a + b, 0) / values.length,
            median: quantile(values, 0.5),
            low: quantile(values, 0.25),
            high: quantile(values, 0.75),
            geometric: Math.expm1(cumulative) * 100,
            samples: values.length,
          };
        });
  return { years: paths.map((p) => p.year), paths, current, summary };
}
