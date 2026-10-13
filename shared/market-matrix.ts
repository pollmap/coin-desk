import type { Asset, Candle, Market } from './types';

const DAY = 86400;
export const MARKET_MATRIX_VERSION = 'bori-market-matrix-daily-volume-v1';
export type MatrixCurrency = 'KRW' | 'USDT';
export type MatrixXMode = 'return7d' | 'excess-btc7d';
export type MatrixQuadrant = 'up-high' | 'down-high' | 'down-low' | 'up-low';
export type MatrixStatus = 'up-volume-up' | 'down-volume-up' | 'volume-down' | 'baseline';
export type MatrixExclusionReason =
  | 'source-mismatch'
  | 'duplicate-asset'
  | 'missing-day'
  | 'duplicate-day'
  | 'unconfirmed-day'
  | 'invalid-candle'
  | 'zero-baseline-volume'
  | 'non-finite-result'
  | 'benchmark-unavailable';

export interface MarketMatrixInput {
  asset: Asset;
  market: Market;
  currency: MatrixCurrency;
  candles: readonly Candle[];
}
export interface MarketMatrixOptions {
  /** Unix seconds. The current unfinished UTC day is never a calculation input. */
  asOf: number;
  market: Market;
  currency: MatrixCurrency;
  xMode?: MatrixXMode;
  /** UTC opening time of a completed daily candle, for an explicit historical view. */
  basisDay?: number;
}
export interface MatrixCoordinates {
  x: number;
  y: number;
  quadrant: MatrixQuadrant | null;
  status: MatrixStatus;
}
export interface MarketMatrixPoint extends MatrixCoordinates {
  asset: Asset;
  basisDay: number;
  return7d: number;
  benchmarkReturn7d: number | null;
  latestVolume: number;
  medianPriorVolume: number;
}
export interface MarketMatrixExclusion {
  asset: Asset;
  reason: MatrixExclusionReason;
  missingDays?: number[];
}
export interface MarketMatrixResponse {
  definitionVersion: string;
  market: Market;
  currency: MatrixCurrency;
  asOf: number;
  basisDay: number;
  xMode: MatrixXMode;
  benchmark: 'BTC' | null;
  points: MarketMatrixPoint[];
  excluded: MarketMatrixExclusion[];
}
export interface MatrixThemeInput {
  id: string;
  title: string;
  members: readonly { asset: Asset; evidence: { review: 'reviewed' | 'pending' | 'rejected' } }[];
}
export interface ThemeMatrixPoint extends MatrixCoordinates {
  id: string;
  title: string;
  basisDay: number;
  members: Asset[];
  expectedMembers: number;
  usableMembers: number;
  omitted: { asset: Asset; reason: 'unreviewed' | 'no-observation' | MatrixExclusionReason }[];
}
export interface ThemeMatrixResponse {
  points: ThemeMatrixPoint[];
  excluded: Omit<ThemeMatrixPoint, keyof MatrixCoordinates | 'members'>[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // Adding the halves avoids overflow for otherwise finite inputs.
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
}

function coordinates(x: number, y: number): MatrixCoordinates {
  return {
    x,
    y,
    quadrant:
      x === 0 || y === 1
        ? null
        : x > 0
          ? y > 1
            ? 'up-high'
            : 'up-low'
          : y > 1
            ? 'down-high'
            : 'down-low',
    status:
      y < 1
        ? 'volume-down'
        : y === 1 || x === 0
          ? 'baseline'
          : x > 0
            ? 'up-volume-up'
            : 'down-volume-up',
  };
}

/** Same-asset base volume is compared with its own past; it is not quote turnover. */
export function calculateMarketMatrix(
  inputs: readonly MarketMatrixInput[],
  options: MarketMatrixOptions,
): MarketMatrixResponse {
  const { asOf, market, currency } = options;
  const xMode = options.xMode ?? 'return7d';
  const basisDay = options.basisDay ?? Math.floor(asOf / DAY) * DAY - DAY;
  if (
    !Number.isFinite(asOf) ||
    asOf < DAY ||
    !Number.isSafeInteger(basisDay) ||
    basisDay < 0 ||
    basisDay % DAY !== 0 ||
    basisDay + DAY > asOf ||
    !['upbit', 'binance'].includes(market) ||
    currency !== (market === 'upbit' ? 'KRW' : 'USDT') ||
    !['return7d', 'excess-btc7d'].includes(xMode)
  )
    throw new RangeError('Invalid matrix source or completed UTC basis day');
  const result: MarketMatrixResponse = {
    definitionVersion: MARKET_MATRIX_VERSION,
    market,
    currency,
    asOf,
    basisDay,
    xMode,
    benchmark: xMode === 'excess-btc7d' ? 'BTC' : null,
    points: [],
    excluded: [],
  };
  const counts = new Map<Asset, number>();
  for (const input of inputs) counts.set(input.asset, (counts.get(input.asset) ?? 0) + 1);
  const handled = new Set<Asset>();
  for (const input of inputs) {
    const asset = input.asset;
    if (handled.has(asset)) continue;
    handled.add(asset);
    const omit = (reason: MatrixExclusionReason, missingDays?: number[]) => {
      result.excluded.push({ asset, reason, ...(missingDays ? { missingDays } : {}) });
    };
    if (counts.get(asset)! > 1) {
      omit('duplicate-asset');
      continue;
    }
    if (input.market !== market || input.currency !== currency) {
      omit('source-mismatch');
      continue;
    }
    const needed = Array.from({ length: 8 }, (_, i) => basisDay - (7 - i) * DAY);
    const window = input.candles.filter((c) => c.time >= needed[0] && c.time <= basisDay);
    const byDay = new Map(window.map((c) => [c.time, c]));
    if (byDay.size !== window.length) {
      omit('duplicate-day');
      continue;
    }
    const missing = needed.filter((time) => !byDay.has(time));
    if (missing.length) {
      omit('missing-day', missing);
      continue;
    }
    const candles = needed.map((time) => byDay.get(time)!);
    if (candles.some((c) => !c.closed || c.closeTime !== c.time + DAY || c.closeTime > asOf)) {
      omit('unconfirmed-day');
      continue;
    }
    if (
      candles.some(
        (c) =>
          ![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
          Math.min(c.open, c.high, c.low, c.close) <= 0 ||
          c.high < Math.max(c.open, c.close, c.low) ||
          c.low > Math.min(c.open, c.close, c.high) ||
          c.volume < 0,
      )
    ) {
      omit('invalid-candle');
      continue;
    }
    const latest = candles[7];
    const medianPriorVolume = median(candles.slice(0, 7).map((c) => c.volume));
    if (medianPriorVolume === 0) {
      omit('zero-baseline-volume');
      continue;
    }
    const return7d = (latest.close / candles[0].close - 1) * 100;
    const y = latest.volume / medianPriorVolume;
    if (![return7d, y].every(Number.isFinite)) {
      omit('non-finite-result');
      continue;
    }
    result.points.push({
      asset,
      basisDay,
      return7d,
      benchmarkReturn7d: null,
      latestVolume: latest.volume,
      medianPriorVolume,
      ...coordinates(return7d, y),
    });
  }
  if (xMode === 'excess-btc7d') {
    const benchmark = result.points.find((p) => p.asset === 'BTC');
    if (!benchmark) {
      for (const point of result.points)
        result.excluded.push({ asset: point.asset, reason: 'benchmark-unavailable' });
      result.points = [];
    } else {
      result.points = result.points.map((point) => ({
        ...point,
        benchmarkReturn7d: benchmark.return7d,
        ...coordinates(point.return7d - benchmark.return7d, point.y),
      }));
    }
  }
  return result;
}

/** Separate medians of valid constituent coordinates; not a market-cap weighted index. */
export function aggregateThemeMatrix(
  matrix: MarketMatrixResponse,
  themes: readonly MatrixThemeInput[],
): ThemeMatrixResponse {
  const points = new Map(matrix.points.map((p) => [p.asset, p]));
  const excluded = new Map(matrix.excluded.map((p) => [p.asset, p.reason]));
  const result: ThemeMatrixResponse = { points: [], excluded: [] };
  for (const theme of themes) {
    const members = [...new Map(theme.members.map((m) => [m.asset, m])).values()];
    const usable = members.filter((m) => m.evidence.review === 'reviewed' && points.has(m.asset));
    const omitted: ThemeMatrixPoint['omitted'] = members
      .filter((m) => !usable.includes(m))
      .map((m) => ({
        asset: m.asset,
        reason:
          m.evidence.review !== 'reviewed'
            ? 'unreviewed'
            : (excluded.get(m.asset) ?? 'no-observation'),
      }));
    const summary = {
      id: theme.id,
      title: theme.title,
      basisDay: matrix.basisDay,
      expectedMembers: members.length,
      usableMembers: usable.length,
      omitted,
    };
    if (!usable.length) {
      result.excluded.push(summary);
      continue;
    }
    const x = median(usable.map((m) => points.get(m.asset)!.x));
    const y = median(usable.map((m) => points.get(m.asset)!.y));
    result.points.push({
      ...summary,
      members: usable.map((m) => m.asset),
      ...coordinates(x, y),
    });
  }
  return result;
}
