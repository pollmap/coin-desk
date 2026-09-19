import { aggregate, atBarClose, bollinger, ema, macd, rsi, sma } from './math';
import { indicatorSpec, validIndicators } from './indicators';
import type { Candle, Drawing, Point } from './types';

/** Values retain their source timestamp. No nearest future observation is used. */
export function pointAtOrBefore(points: Point[], time: number): Point | undefined {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return points[lo - 1];
}

export function calculateIndicators(
  candles: Candle[],
  daily: Candle[],
  indicators: string[],
  now = Date.now() / 1000,
): Record<string, Point[][]> {
  const closes = candles.map((c) => ({ time: c.time, value: c.close }));
  const closedDaily = daily.filter((c) => c.closed && c.closeTime <= now);
  const dailyPoints = closedDaily.map((c) => ({ time: c.time, value: c.close }));
  // A listing or truncated response can begin midweek. That partial week is not a full sample.
  const firstDaily = closedDaily[0]?.time;
  const weekly = aggregate(closedDaily, '1w', now)
    .filter((c) => c.closed && (firstDaily === undefined || c.time >= firstDaily))
    .map((c) => ({ time: c.time, value: c.close }));
  const out: Record<string, Point[][]> = {};
  for (const id of validIndicators(indicators)) {
    const spec = indicatorSpec(id)!;
    if (spec.kind === 'bb') {
      const b = bollinger(closes, spec.period, spec.multiplier);
      out[id] = [b.middle, b.upper, b.lower];
    } else if (spec.kind === 'rsi') out[id] = [rsi(closes, spec.period)];
    else if (spec.kind === 'macd') {
      const m = macd(closes);
      out[id] = [m.line, m.signal, m.histogram];
    } else {
      const input = spec.basis === 'w' ? weekly : spec.basis === 'd' ? dailyPoints : closes;
      const points = (spec.kind === 'ema' ? ema : sma)(input, spec.period);
      out[id] = [
        spec.basis === 'bar'
          ? points
          : atBarClose(points, spec.basis === 'd' ? '1d' : '1w', candles, now),
      ];
    }
  }
  return out;
}

/** localStorage is user-controlled input. Reject malformed or unbounded chart objects. */
export function validDrawings(input: unknown): Drawing[] {
  if (!Array.isArray(input)) return [];
  const out: Drawing[] = [];
  const ids = new Set<string>();
  for (const item of input.slice(-60)) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.id ||
      item.id.length > 100 ||
      ids.has(item.id) ||
      !['horizontal', 'trend'].includes(item.kind) ||
      !Array.isArray(item.points) ||
      item.points.length !== (item.kind === 'horizontal' ? 1 : 2)
    )
      continue;
    const points: Point[] = [];
    for (const point of item.points) {
      if (
        !point ||
        typeof point !== 'object' ||
        typeof point.time !== 'number' ||
        !Number.isSafeInteger(point.time) ||
        point.time <= 0 ||
        point.time > 253402300799 ||
        typeof point.value !== 'number' ||
        !Number.isFinite(point.value) ||
        point.value <= 0
      )
        break;
      points.push({ time: point.time, value: point.value });
    }
    if (
      points.length !== item.points.length ||
      (points.length === 2 && points[0].time === points[1].time)
    )
      continue;
    ids.add(item.id);
    out.push({ id: item.id, kind: item.kind, points: points.sort((a, b) => a.time - b.time) });
  }
  return out.slice(-30);
}

/** The export includes only actual source bars, including their finalized state. */
export function candlesCsv(candles: Candle[], scope: string, from = 0, to = Infinity): string {
  const [asset = '', market = '', interval = ''] = scope.split('.');
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '');
  const header =
    'asset,market,interval,open_time_utc,close_time_utc,open,high,low,close,volume,quote_unit,volume_unit,closed';
  const rows = candles
    .filter((c) => c.time >= from && c.time <= to)
    .map((c) =>
      [
        safe(asset),
        safe(market),
        safe(interval),
        new Date(c.time * 1000).toISOString(),
        new Date(c.closeTime * 1000).toISOString(),
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        market === 'upbit' ? 'KRW' : 'USDT',
        safe(asset),
        c.closed,
      ].join(','),
    );
  return '\uFEFF' + [header, ...rows].join('\r\n');
}
