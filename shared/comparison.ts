import type { Asset, Candle, Period, Point } from './types';

const DAY = 86400;
export const COMPARISON_VERSION = 'common-utc-close-v1';
export const COMPARISON_PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = {
  '1m': 30,
  '3m': 90,
  '1y': 365,
  '3y': 1095,
};
export interface ComparisonInput {
  asset: Asset;
  candles: Candle[];
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
  period: Period,
  now = Date.now() / 1000,
): ComparisonResult {
  const empty: ComparisonResult = {
    rows: [],
    start: null,
    end: null,
    requestedStart: null,
    shortened: false,
    missingCommonDays: 0,
    observations: 0,
  };
  if (
    inputs.length < 2 ||
    inputs.length > 8 ||
    new Set(inputs.map((i) => i.asset)).size !== inputs.length
  )
    return { ...empty, error: '서로 다른 코인을 2개 이상 선택해 주세요.' };
  const sources = inputs.map(({ asset, candles }) => {
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
    return { asset, valid, ignoredRows, times: [...valid.keys()].sort((a, b) => a - b) };
  });
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
  const requestedStart = period === 'all' ? null : end - COMPARISON_PERIOD_DAYS[period] * DAY;
  const commonTimes = allCommonTimes.filter((time) => time >= (requestedStart ?? 0));
  if (commonTimes.length < 2)
    return {
      ...empty,
      requestedStart,
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
    shortened: requestedStart !== null && start > requestedStart,
    missingCommonDays,
    observations: commonTimes.length,
  };
}
