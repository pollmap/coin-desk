import type { Asset, Candle, Point } from './types';
import { periodStart, type RangePeriod } from './ranges';

const DAY = 86400;
export const COMPARISON_VERSION = 'common-utc-calendar-v2';
export interface ComparisonRange {
  from: number;
  to: number;
}
export function parseComparisonRange(
  from: unknown,
  to: unknown,
  now = Date.now() / 1000,
): { range: ComparisonRange | null; error?: string } {
  if (from == null && to == null) return { range: null };
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(value + 'T00:00:00Z') / 1000;
    return Number.isFinite(time) &&
      time >= 0 &&
      new Date(time * 1000).toISOString().slice(0, 10) === value
      ? time
      : NaN;
  };
  const start = parse(from),
    end = parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return { range: null, error: '시작일과 종료일을 실제 날짜(YYYY-MM-DD)로 함께 입력해 주세요.' };
  if (start > end) return { range: null, error: '시작일은 종료일보다 늦을 수 없습니다.' };
  if (end > Math.floor(now / DAY) * DAY)
    return { range: null, error: '종료일은 오늘(UTC) 이후의 미래 날짜로 지정할 수 없습니다.' };
  return { range: { from: start, to: end } };
}
export interface ComparisonInput {
  asset: Asset;
  candles: Candle[];
  historyStart?: number | null;
}
export interface ComparisonRow {
  asset: Asset;
  points: Point[];
  startPrice: number;
  endPrice: number;
  returnPct: number;
  maxDrawdownPct: number;
  annualVolatilityPct: number | null;
  missingDays: number;
  ignoredRows: number;
  latestAvailable: number;
}
export interface ComparisonResult {
  rows: ComparisonRow[];
  start: number | null;
  end: number | null;
  requestedStart: number | null;
  requestedEnd: number | null;
  coverage: { asset: Asset; first: number | null; last: number | null }[];
  endShortened: boolean;
  shortened: boolean;
  missingCommonDays: number;
  observations: number;
  error?: string;
}

/** Compare only finalized UTC daily closes available for every selected asset.
 * No interpolation, forward fill, latest unfinished candle or 252-day convention.
 */
export function compareCloses(
  inputs: ComparisonInput[],
  period: RangePeriod,
  now = Date.now() / 1000,
  custom?: ComparisonRange | null,
): ComparisonResult {
  const empty: ComparisonResult = {
    rows: [],
    start: null,
    end: null,
    requestedStart: custom?.from ?? null,
    requestedEnd: custom?.to ?? null,
    coverage: [],
    endShortened: false,
    shortened: false,
    missingCommonDays: 0,
    observations: 0,
  };
  if (
    custom &&
    (!Number.isFinite(custom.from) ||
      !Number.isFinite(custom.to) ||
      custom.from < 0 ||
      custom.from > custom.to ||
      custom.from % DAY !== 0 ||
      custom.to % DAY !== 0)
  )
    return { ...empty, error: '비교 날짜 범위가 올바르지 않습니다.' };
  if (
    inputs.length < 2 ||
    inputs.length > 8 ||
    new Set(inputs.map((i) => i.asset)).size !== inputs.length
  )
    return { ...empty, error: '서로 다른 코인을 2개 이상 선택해 주세요.' };
  const sources = inputs.map(({ asset, candles, historyStart }) => {
    const valid = new Map<number, Candle>();
    let ignoredRows = 0;
    for (const candle of candles) {
      if (
        !candle ||
        typeof candle !== 'object' ||
        !candle.closed ||
        !Number.isFinite(candle.time) ||
        candle.time % DAY !== 0 ||
        candle.closeTime !== candle.time + DAY ||
        candle.closeTime > now ||
        !Number.isFinite(candle.close) ||
        candle.close <= 0
      ) {
        ignoredRows++;
        continue;
      }
      if (valid.has(candle.time)) ignoredRows++;
      valid.set(candle.time, candle);
    }
    return {
      asset,
      valid,
      ignoredRows,
      historyStart,
      times: [...valid.keys()].sort((a, b) => a - b),
    };
  });
  const coverage = sources.map((source) => ({
    asset: source.asset,
    first: source.historyStart ?? source.times[0] ?? null,
    last: source.times.at(-1) ?? null,
  }));
  empty.coverage = coverage;
  const unavailable = sources.filter((source) => source.times.length < 2);
  if (unavailable.length)
    return {
      ...empty,
      error: unavailable.map((s) => s.asset).join(' · ') + '의 확정 일봉이 부족합니다.',
    };
  const latestLimit = Math.min(...sources.map((source) => source.times.at(-1)!));
  const allCommonTimes = sources[0].times.filter(
    (time) => time <= latestLimit && sources.every((s) => s.valid.has(time)),
  );
  const end = allCommonTimes.at(-1) ?? latestLimit;
  const requestedStart = custom?.from ?? (period === 'all' ? null : periodStart(period, end));
  const requestedEnd = custom?.to ?? end;
  const commonTimes = allCommonTimes.filter(
    (time) => time >= (requestedStart ?? 0) && time <= requestedEnd,
  );
  if (commonTimes.length < 2)
    return {
      ...empty,
      requestedStart,
      requestedEnd,
      error: '선택한 코인들이 겹치는 확정 일봉이 2개 미만입니다. 기간이나 코인을 변경해 주세요.',
    };
  const start = commonTimes[0];
  const actualEnd = commonTimes.at(-1)!;
  const expectedDays = Math.round((actualEnd - start) / DAY) + 1;
  const missingCommonDays = expectedDays - commonTimes.length;
  const rows = sources.map((source): ComparisonRow => {
    const closes = commonTimes.map((time) => source.valid.get(time)!.close);
    const startPrice = closes[0];
    const endPrice = closes.at(-1)!;
    let peak = startPrice;
    let drawdown = 0;
    for (const value of closes) {
      peak = Math.max(peak, value);
      drawdown = Math.min(drawdown, value / peak - 1);
    }
    // Missing days turn a return into a multi-day return. Do not annualize it as daily.
    let annualVolatilityPct: number | null = null;
    if (missingCommonDays === 0 && closes.length >= 21) {
      const returns = closes.slice(1).map((value, i) => Math.log(value / closes[i]));
      const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      const sampleVariance =
        returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
      annualVolatilityPct = Math.sqrt(sampleVariance * 365) * 100;
    }
    const available = source.times.filter((time) => time >= start && time <= actualEnd).length;
    return {
      asset: source.asset,
      points: commonTimes.map((time, i) => ({ time, value: (closes[i] / startPrice) * 100 })),
      startPrice,
      endPrice,
      returnPct: (endPrice / startPrice - 1) * 100,
      maxDrawdownPct: drawdown * 100,
      annualVolatilityPct,
      missingDays: expectedDays - available,
      ignoredRows: source.ignoredRows,
      latestAvailable: source.times.at(-1)!,
    };
  });
  if (
    rows.some(
      (row) =>
        !Number.isFinite(row.returnPct) ||
        row.points.some((point) => !Number.isFinite(point.value)) ||
        (row.annualVolatilityPct !== null && !Number.isFinite(row.annualVolatilityPct)),
    )
  )
    return {
      ...empty,
      error: '가격 배율을 안정적으로 계산할 수 없습니다. 원천 가격의 범위를 확인해 주세요.',
    };
  return {
    rows,
    start,
    end: actualEnd,
    requestedStart,
    requestedEnd,
    coverage,
    endShortened: actualEnd < requestedEnd,
    shortened: requestedStart !== null && start > requestedStart,
    missingCommonDays,
    observations: commonTimes.length,
  };
}
