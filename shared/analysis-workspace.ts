import type { Asset, Point } from './types';
import { DAY, rsi, sma } from './math';
import { networkMetrics } from './network-catalog';

export type PriceBasis = 'reference' | 'upbit' | 'binance';
export function priceBasis(params: URLSearchParams): PriceBasis {
  const explicit = params.get('price_source');
  if (explicit === 'reference' || explicit === 'upbit' || explicit === 'binance') return explicit;
  return params.get('market') === 'upbit'
    ? 'upbit'
    : params.get('market') === 'binance'
      ? 'binance'
      : 'reference';
}
export const basisUnit = (basis: PriceBasis) =>
  basis === 'reference' ? 'USD' : basis === 'upbit' ? 'KRW' : 'USDT';
export const basisName = (basis: PriceBasis) =>
  basis === 'reference' ? 'USD 참조' : basis === 'upbit' ? 'Upbit KRW' : 'Binance USDT';
export function assetLink(path: string, asset: Asset, params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.set('asset', asset);
  if (!next.has('period')) next.set('period', 'all');
  // An event or observation belongs to one asset; never carry it to another coin.
  if (params.get('asset') !== asset) {
    for (const key of ['event', 'signal', 'focus', 'metric']) next.delete(key);
    if (next.has('panels'))
      next.set(
        'panels',
        next
          .get('panels')!
          .split(',')
          .filter((id) => supportedPanel(asset, id))
          .join(','),
      );
  }
  return path + '?' + next.toString();
}
export function supportedPanel(asset: Asset, id: string) {
  if (id.startsWith('btc:')) return asset === 'BTC';
  if (id.startsWith('chain:')) return asset === 'ETH';
  if (id.startsWith('net:')) return networkMetrics(asset).some((m) => m.id === id.slice(4));
  if (id === 'relative') return asset !== 'BTC';
  return true;
}
/** Restart rolling calculations after a missing calendar observation. No gap interpolation. */
export function contiguousCalculation(
  points: Point[],
  kind: 'sma' | 'rsi',
  window = 200,
  step = DAY,
): Point[] {
  const segments: Point[][] = [];
  for (const p of points) {
    if (!Number.isFinite(p.value) || p.value <= 0) continue;
    const last = segments.at(-1);
    if (!last || p.time - last.at(-1)!.time !== step) segments.push([p]);
    else last.push(p);
  }
  return segments.flatMap((segment) =>
    kind === 'sma' ? sma(segment, window) : rsi(segment, window),
  );
}
export function drawdowns(points: Point[]): Point[] {
  let high = 0;
  return points.map((p) => {
    high = Math.max(high, p.value);
    return { time: p.time, value: high > 0 ? (p.value / high - 1) * 100 : 0 };
  });
}
export function relativeStrength(points: Point[], benchmark: Point[]): Point[] {
  const byTime = new Map(benchmark.map((p) => [p.time, p.value]));
  return points.flatMap((p) => {
    const other = byTime.get(p.time);
    return other && other > 0 ? [{ time: p.time, value: p.value / other }] : [];
  });
}
export function monthlyReturns(points: Point[]) {
  const last = new Map<string, Point>();
  for (const p of points) last.set(new Date(p.time * 1000).toISOString().slice(0, 7), p);
  return [...last].map(([month, end]) => {
    const start = Date.parse(month + '-01T00:00:00Z') / 1000;
    const prior = points.find((p) => p.time === start - DAY);
    const nextMonth = new Date(start * 1000);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const expected = (end.time - start) / DAY + 1;
    const valid =
      prior && points.filter((p) => p.time >= start && p.time <= end.time).length === expected;
    return {
      month,
      value: valid ? (end.value / prior.value - 1) * 100 : null,
      partial: end.time + DAY < nextMonth.getTime() / 1000,
    };
  });
}
