import type { Candle, Interval } from './types';

export type PatternId =
  | 'bullish-engulfing'
  | 'bearish-engulfing'
  | 'doji'
  | 'hammer'
  | 'hanging-man'
  | 'inverted-hammer'
  | 'shooting-star'
  | 'dragonfly-doji'
  | 'gravestone-doji';
export type TrendFilter = 'sma50' | 'sma50-200' | 'none';
export const PATTERN_VERSION = 'coin-desk-candles-1';
export interface PatternDefinition {
  id: PatternId;
  title: string;
  english: string;
  direction: 'up' | 'down' | 'neutral';
  summary: string;
  rules: string[];
  source: string;
  demo: { open: number; high: number; low: number; close: number }[];
}
const tv = 'https://www.tradingview.com/support/solutions/';
const screen = tv + '43000752737-candlestick-pattern-in-screener/';
const lower = [{ open: 75, high: 92, low: 10, close: 90 }];
const upper = [{ open: 25, high: 90, low: 8, close: 10 }];
export const PATTERNS: readonly PatternDefinition[] = [
  {
    id: 'bullish-engulfing',
    title: '상승 장악형',
    english: 'Bullish Engulfing',
    direction: 'up',
    summary: '음봉 다음 양봉의 몸통이 앞선 몸통을 감싸는 두 봉 형태입니다.',
    rules: [
      '앞 봉은 음봉, 현재 봉은 양봉',
      '현재 시가 ≤ 앞선 종가, 현재 종가 ≥ 앞선 시가',
      '현재 몸통이 앞선 몸통보다 큼 · 꼬리 포함은 요구하지 않음',
    ],
    source: 'https://kr.tradingview.com/support/solutions/43000583771/',
    demo: [
      { open: 70, high: 82, low: 23, close: 40 },
      { open: 35, high: 88, low: 30, close: 77 },
    ],
  },
  {
    id: 'bearish-engulfing',
    title: '하락 장악형',
    english: 'Bearish Engulfing',
    direction: 'down',
    summary: '양봉 다음 음봉의 몸통이 앞선 몸통을 감싸는 두 봉 형태입니다.',
    rules: [
      '앞 봉은 양봉, 현재 봉은 음봉',
      '현재 시가 ≥ 앞선 종가, 현재 종가 ≤ 앞선 시가',
      '현재 몸통이 앞선 몸통보다 큼 · 꼬리 포함은 요구하지 않음',
    ],
    source: tv + '43000583769-engulfing-bearish/',
    demo: [
      { open: 40, high: 82, low: 23, close: 70 },
      { open: 77, high: 88, low: 30, close: 35 },
    ],
  },
  {
    id: 'doji',
    title: '도지형',
    english: 'Doji',
    direction: 'neutral',
    summary: '시가와 종가가 가까워 몸통이 작은 봉입니다. 도지코인과 다른 용어입니다.',
    rules: [
      '몸통 ≤ 전체 고저 범위의 10%',
      '고가와 저가가 같은 봉은 제외',
      '방향을 가정하지 않으므로 추세 필터를 적용하지 않음',
    ],
    source: tv + '43000583767-doji/',
    demo: [{ open: 49, high: 90, low: 10, close: 52 }],
  },
  {
    id: 'hammer',
    title: '망치형',
    english: 'Hammer',
    direction: 'up',
    summary: '긴 아래꼬리와 위쪽의 작은 몸통을 가진 형태입니다. 앞선 하락 흐름을 함께 확인합니다.',
    rules: [
      '몸통 > 고저 범위의 10%',
      '아래꼬리 ≥ 몸통의 2배',
      '위꼬리 ≤ 몸통의 0.5배 · 양봉·음봉 모두 포함',
    ],
    source: screen,
    demo: lower,
  },
  {
    id: 'hanging-man',
    title: '교수형',
    english: 'Hanging Man',
    direction: 'down',
    summary: '망치형과 같은 모양을 앞선 상승 흐름에서 구분한 형태입니다.',
    rules: [
      '몸통 > 고저 범위의 10%',
      '아래꼬리 ≥ 몸통의 2배',
      '위꼬리 ≤ 몸통의 0.5배 · 추세를 끄면 망치형과 겹침',
    ],
    source: screen,
    demo: lower,
  },
  {
    id: 'inverted-hammer',
    title: '역망치형',
    english: 'Inverted Hammer',
    direction: 'up',
    summary: '긴 위꼬리와 아래쪽 몸통을 하락 흐름에서 관찰하는 형태입니다.',
    rules: [
      '몸통 > 고저 범위의 10%',
      '위꼬리 ≥ 몸통의 2배',
      '아래꼬리 ≤ 몸통의 0.5배 · 양봉·음봉 모두 포함',
    ],
    source: screen,
    demo: upper,
  },
  {
    id: 'shooting-star',
    title: '유성형',
    english: 'Shooting Star',
    direction: 'down',
    summary: '긴 위꼬리와 아래쪽 몸통을 앞선 상승 흐름에서 관찰하는 형태입니다.',
    rules: [
      '몸통 > 고저 범위의 10%',
      '위꼬리 ≥ 몸통의 2배',
      '아래꼬리 ≤ 몸통의 0.5배 · 추세를 끄면 역망치형과 겹침',
    ],
    source: screen,
    demo: upper,
  },
  {
    id: 'dragonfly-doji',
    title: '잠자리 도지형',
    english: 'Dragonfly Doji',
    direction: 'up',
    summary: '시가·종가가 고가 가까이 있고 아래꼬리가 긴 도지형입니다.',
    rules: ['몸통 ≤ 고저 범위의 10%', '위꼬리 ≤ 고저 범위의 10%', '아래꼬리 ≥ 고저 범위의 60%'],
    source: tv + '43000583768-dragonfly-doji-bullish/',
    demo: [{ open: 85, high: 90, low: 10, close: 87 }],
  },
  {
    id: 'gravestone-doji',
    title: '비석 도지형',
    english: 'Gravestone Doji',
    direction: 'down',
    summary: '시가·종가가 저가 가까이 있고 위꼬리가 긴 도지형입니다.',
    rules: ['몸통 ≤ 고저 범위의 10%', '아래꼬리 ≤ 고저 범위의 10%', '위꼬리 ≥ 고저 범위의 60%'],
    source: tv + '43000583773-gravestone-doji-bearish/',
    demo: [{ open: 12, high: 90, low: 10, close: 15 }],
  },
];
export const trendFilter = (v: unknown): TrendFilter =>
  v === 'none' || v === 'sma50-200' ? v : 'sma50';
export function validPatterns(value: unknown): PatternId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)].filter((p): p is PatternId => PATTERNS.some((x) => x.id === p));
}
export interface PatternHit {
  id: string;
  pattern: PatternId;
  time: number;
  from: number;
  confirmedAt: number;
  label: string;
  direction: PatternDefinition['direction'];
  close: number;
  trend: TrendFilter;
  previousClose?: number;
  sma50?: number;
  sma200?: number;
  body: number;
  range: number;
  upper: number;
  lower: number;
  version: string;
}
function nextTime(t: number, interval: Interval) {
  if (interval === '1M') {
    const d = new Date(t * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return t + { '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 }[interval];
}
/** A causal detector: consecutive real, closed OHLC bars only. Never use reference closes as candles. */
export function detectPatterns(
  input: Candle[],
  selected: readonly PatternId[],
  filter: TrendFilter = 'sma50',
  interval: Interval = '1d',
  now = Date.now() / 1000,
): PatternHit[] {
  const ids = new Set(validPatterns(selected));
  if (!ids.size) return [];
  const out: PatternHit[] = [];
  let run: Candle[] = [],
    sum50 = 0,
    sum200 = 0,
    lastTime = -Infinity;
  for (const c of input) {
    if (c.time <= lastTime) {
      run = [];
      sum50 = 0;
      sum200 = 0;
      continue;
    }
    if (Number.isFinite(c.time)) lastTime = c.time;
    const valid =
      c.closed &&
      c.closeTime <= now &&
      c.closeTime >= nextTime(c.time, interval) - 1 &&
      c.closeTime <= nextTime(c.time, interval) &&
      [c.time, c.open, c.high, c.low, c.close, c.closeTime, c.volume].every(Number.isFinite) &&
      c.time > 0 &&
      Math.min(c.open, c.close, c.low) > 0 &&
      c.high >= Math.max(c.open, c.close, c.low) &&
      c.low <= Math.min(c.open, c.close) &&
      c.volume >= 0;
    if (!valid) {
      run = [];
      sum50 = 0;
      sum200 = 0;
      continue;
    }
    const p = run.at(-1);
    if (p && nextTime(p.time, interval) !== c.time) {
      run = [];
      sum50 = 0;
      sum200 = 0;
    }
    // Trend is measured immediately BEFORE the pattern completes; this choice is explicit in the dictionary.
    const prev = run.at(-1),
      ma50 = run.length >= 50 ? sum50 / 50 : undefined,
      ma200 = run.length >= 200 ? sum200 / 200 : undefined;
    const body = Math.abs(c.close - c.open),
      range = c.high - c.low,
      upper = c.high - Math.max(c.open, c.close),
      lower = Math.min(c.open, c.close) - c.low;
    const down =
      !!prev &&
      ma50 !== undefined &&
      prev.close < ma50 &&
      (filter !== 'sma50-200' || (ma200 !== undefined && ma50 < ma200));
    const up =
      !!prev &&
      ma50 !== undefined &&
      prev.close > ma50 &&
      (filter !== 'sma50-200' || (ma200 !== undefined && ma50 > ma200));
    if (range > 0)
      for (const spec of PATTERNS) {
        if (
          !ids.has(spec.id) ||
          (filter !== 'none' &&
            spec.direction !== 'neutral' &&
            !(spec.direction === 'up' ? down : up))
        )
          continue;
        const engulf = prev && body > Math.abs(prev.close - prev.open);
        const doji = body <= range * 0.1;
        const shape =
          spec.id === 'bullish-engulfing'
            ? engulf &&
              prev!.close < prev!.open &&
              c.close > c.open &&
              c.open <= prev!.close &&
              c.close >= prev!.open
            : spec.id === 'bearish-engulfing'
              ? engulf &&
                prev!.close > prev!.open &&
                c.close < c.open &&
                c.open >= prev!.close &&
                c.close <= prev!.open
              : spec.id === 'doji'
                ? doji
                : spec.id === 'dragonfly-doji'
                  ? doji && upper <= range * 0.1 && lower >= range * 0.6
                  : spec.id === 'gravestone-doji'
                    ? doji && lower <= range * 0.1 && upper >= range * 0.6
                    : ['hammer', 'hanging-man'].includes(spec.id)
                      ? !doji && lower >= 2 * body && upper <= body * 0.5
                      : !doji && upper >= 2 * body && lower <= body * 0.5;
        if (shape)
          out.push({
            id: `${spec.id}:${c.time}`,
            pattern: spec.id,
            time: c.time,
            from: spec.id.includes('engulfing') ? prev!.time : c.time,
            confirmedAt: c.closeTime,
            label: spec.title,
            direction: spec.direction,
            close: c.close,
            trend: filter,
            previousClose: prev?.close,
            sma50: ma50,
            sma200: ma200,
            body,
            range,
            upper,
            lower,
            version: PATTERN_VERSION,
          });
      }
    run.push(c);
    sum50 += c.close;
    sum200 += c.close;
    if (run.length > 50) sum50 -= run[run.length - 51].close;
    if (run.length > 200) sum200 -= run[run.length - 201].close;
  }
  return out;
}
