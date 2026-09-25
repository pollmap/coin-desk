import type { Asset, Point } from './types';
import { contiguousCalculation } from './analysis-workspace';
import { DAY } from './math';
export const SIGNAL_VERSION = 'observations-v1';
export const SIGNAL_RULES = ['sma200', 'rsi30', 'rsi70', 'mvrv1', 'funding0'] as const;
export type SignalRule = (typeof SIGNAL_RULES)[number];
export interface ObservationSignal {
  id: string;
  asset: Asset;
  source: string;
  rule: SignalRule;
  time: number;
  previous: number;
  previousTime?: number;
  current: number;
  threshold: number;
  direction: 'up' | 'down';
  condition: string;
  unit: string;
  version: string;
  bar: '1d' | 'settlement';
  createdAt?: number;
  revision?: number;
  status?: 'active' | 'corrected' | 'withdrawn';
  notify?: boolean;
}
export const signalLabels: Record<SignalRule, string> = {
  sma200: '200일선',
  rsi30: 'RSI 30',
  rsi70: 'RSI 70',
  mvrv1: 'MVRV 1',
  funding0: '펀딩 부호',
};
export function crossing(
  previous: number,
  current: number,
  threshold: number,
): 'up' | 'down' | null {
  if (previous <= threshold && current > threshold) return 'up';
  if (previous >= threshold && current < threshold) return 'down';
  return null;
}
export function observationSignals(
  asset: Asset,
  source: string,
  input: Point[],
  type: 'price' | 'mvrv' | 'funding',
  now: number,
  unit = 'USD',
): ObservationSignal[] {
  const seen = new Set<number>();
  const points = [...input]
    .sort((a, b) => a.time - b.time)
    .filter((p) => {
      if (!Number.isSafeInteger(p.time) || seen.has(p.time) || !Number.isFinite(p.value))
        throw new Error('Invalid observation');
      seen.add(p.time);
      return p.time + (type === 'funding' ? 0 : DAY) <= now;
    });
  const series: { rule: SignalRule; data: Point[]; threshold: number; unit: string }[] = [];
  if (type === 'price') {
    const averages = new Map(
      contiguousCalculation(points, 'sma', 200).map((p) => [p.time, p.value]),
    );
    series.push({
      rule: 'sma200',
      data: points.flatMap((p) =>
        averages.has(p.time) ? [{ time: p.time, value: p.value - averages.get(p.time)! }] : [],
      ),
      threshold: 0,
      unit,
    });
    const momentum = contiguousCalculation(points, 'rsi', 14);
    series.push(
      { rule: 'rsi30', data: momentum, threshold: 30, unit: 'RSI' },
      { rule: 'rsi70', data: momentum, threshold: 70, unit: 'RSI' },
    );
  } else
    series.push({
      rule: type === 'mvrv' ? 'mvrv1' : 'funding0',
      data: points,
      threshold: type === 'mvrv' ? 1 : 0,
      unit: type === 'mvrv' ? '배' : '%',
    });
  return series.flatMap((s) =>
    s.data.flatMap((p, i) => {
      const before = s.data[i - 1];
      if (
        !before ||
        (type !== 'funding' && p.time - before.time !== DAY) ||
        (type === 'funding' && (p.time - before.time > 8 * 3600 || p.value * before.value >= 0))
      )
        return [];
      const direction = crossing(before.value, p.value, s.threshold);
      if (!direction) return [];
      return [
        {
          id: `${asset}:${source}:${s.rule}:${p.time}:${SIGNAL_VERSION}`,
          asset,
          source,
          rule: s.rule,
          time: p.time,
          previous: before.value,
          previousTime: before.time,
          current: p.value,
          threshold: s.threshold,
          direction,
          condition:
            s.rule === 'sma200'
              ? '확정 일봉 종가 − 같은 원천의 200일 단순평균이 0 통과'
              : `${signalLabels[s.rule]} 경계 ${direction === 'up' ? '상향' : '하향'} 통과`,
          unit: s.unit,
          version: SIGNAL_VERSION,
          bar: type === 'funding' ? 'settlement' : '1d',
        } satisfies ObservationSignal,
      ];
    }),
  );
}
export interface DailyBriefing {
  id: string;
  date: string;
  createdAt: number;
  prices: {
    asset: Asset;
    price: number | null;
    change: number | null;
    asOf: number | null;
    source: string;
    unit: string;
  }[];
  signals: number;
  events: { title: string; url: string }[];
  missing: string[];
}
