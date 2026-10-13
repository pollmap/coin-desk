import type { Asset, Point, Interval } from './types';
import { observationSignals, signalLabels, type ObservationSignal } from './signals';
import type { SupertrendRow } from './supertrend';
import { bucketEnd } from './math';

export interface IndicatorTransition {
  id: string;
  time: number;
  label: string;
  direction: 'up' | 'down' | 'neutral';
}
export function signalMetric(signal: ObservationSignal): string {
  return signal.rule === 'mvrv1'
    ? 'net:mvrv'
    : signal.rule === 'funding0'
      ? 'futures:funding'
      : signal.rule === 'sma200'
        ? 'view:price'
        : 'rsi';
}
/** A legacy event belongs to its original observations, never a substituted price feed. */
export function signalMatchesAnalysis(
  signal: ObservationSignal,
  metric: string,
  basis: string,
): boolean {
  const expected = signalMetric(signal);
  if (metric !== expected && !(signal.rule === 'mvrv1' && metric === 'btc:mvrv')) return false;
  const source = metric.startsWith('btc:')
    ? 'bitview'
    : metric.startsWith('net:')
      ? 'coinmetrics'
      : metric.startsWith('futures:')
        ? 'bybit'
        : basis;
  return signal.source === source;
}
export function indicatorTransitions(
  asset: Asset,
  metric: string,
  source: string,
  points: Point[],
  now: number,
): IndicatorTransition[] {
  const kind = metric.endsWith(':mvrv')
    ? 'mvrv'
    : metric === 'futures:funding'
      ? 'funding'
      : ['view:price', 'rsi'].includes(metric)
        ? 'price'
        : null;
  if (!kind) return [];
  return observationSignals(asset, source, points, kind, now)
    .filter((s) =>
      metric === 'rsi'
        ? s.rule === 'rsi30' || s.rule === 'rsi70'
        : metric === 'view:price'
          ? s.rule === 'sma200'
          : true,
    )
    .map((s) => ({
      id: s.id,
      time: s.time,
      label: `${signalLabels[s.rule]} ${s.direction === 'up' ? '상향' : '하향'} 통과`,
      direction: s.direction,
    }));
}
/** Do not turn the first result after an OHLC gap into a direction-change event. */
export function supertrendTransitions(
  asset: Asset,
  source: string,
  rows: SupertrendRow[],
  interval: Interval,
): IndicatorTransition[] {
  return rows.flatMap((row, i) => {
    const previous = rows[i - 1];
    return previous &&
      row.time === bucketEnd(previous.time, interval) &&
      row.direction !== previous.direction
      ? [
          {
            id: `${asset}:${source}:supertrend:${interval}:${row.time}`,
            time: row.time,
            label: `슈퍼트렌드 ${row.direction === 'up' ? '상승' : '하락'} 전환`,
            direction: row.direction,
          },
        ]
      : [];
  });
}
