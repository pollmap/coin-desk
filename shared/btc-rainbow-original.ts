import type { Point } from './types';
import { DAY } from './math';
import baseline from './btc-rainbow-original-reference.json' with { type: 'json' };

/** Public Original chart observed 2026-10-18; this is not a claimed V2 model. */
export const ORIGINAL_RAINBOW_SOURCE = 'https://www.blockchaincenter.net/bitcoin-rainbow-chart/';
export const ORIGINAL_RAINBOW_SCRIPT =
  'https://www.blockchaincenter.net/_next/static/chunks/f07b06cf8fa13d78.js';
export const ORIGINAL_RAINBOW_SCRIPT_HASH =
  '1d734930a9b59ff0471179f10df1ae4f3569e759a39c8abd2369fa953c8b3cb9';
export const ORIGINAL_RAINBOW_COEFFICIENTS = [
  2.9, 2.886, 2.872, 2.859, 2.845, 2.8295, 2.815, 2.801, 2.788, 2.775,
] as const;
export const ORIGINAL_RAINBOW_SHIFTS = [
  1400, 1375, 1350, 1320, 1293, 1275, 1250, 1225, 1200, 1175,
] as const;
export const ORIGINAL_RAINBOW_FORMULA = JSON.stringify({
  base: 10,
  logarithm: 'natural',
  coefficients: ORIGINAL_RAINBOW_COEFFICIENTS,
  shifts: ORIGINAL_RAINBOW_SHIFTS,
  intercept: -19.463,
  index: 'row-after-2012-01-01-filter-zero-based',
  boundaries: 'adjacent-center-geometric-mean',
});
export const ORIGINAL_RAINBOW_FORMULA_HASH = baseline.formulaHash;
export interface OriginalRainbowReference {
  schemaVersion: 1;
  modelVersion: string;
  snapshotId: string;
  formulaHash: string;
  sourceScriptHash: string;
  verifiedAt: number;
  /** Ordered actual dates in the official page, not a calendar synthesized from endpoints. */
  dates: string[];
}
export interface OriginalRainbowPoint {
  time: number;
  price: number;
  /** Ten colored centerlines, highest first. They are not ten edges of nine regions. */
  centers: number[];
  /** Nine classification thresholds, highest first. */
  boundaries: number[];
  bandIndex: number;
  referenceIndex: number;
  modelVersion: string;
}
export const ORIGINAL_RAINBOW_BASELINE = baseline as OriginalRainbowReference;
export const originalRainbowVersionValid = (value: string) =>
  /^bc-original-[a-f0-9]{12}-[a-f0-9]{12}$/.test(value);

export function originalRainbowReferenceValid(value: unknown): value is OriginalRainbowReference {
  if (!value || typeof value !== 'object') return false;
  const r = value as OriginalRainbowReference;
  if (
    r.schemaVersion !== 1 ||
    !originalRainbowVersionValid(r.modelVersion ?? '') ||
    !r.modelVersion.startsWith(`bc-original-${ORIGINAL_RAINBOW_FORMULA_HASH.slice(0, 12)}-`) ||
    !/^[a-f0-9]{64}$/.test(r.snapshotId ?? '') ||
    r.formulaHash !== ORIGINAL_RAINBOW_FORMULA_HASH ||
    r.sourceScriptHash !== ORIGINAL_RAINBOW_SCRIPT_HASH ||
    !Number.isSafeInteger(r.verifiedAt) ||
    r.verifiedAt < 0 ||
    !Array.isArray(r.dates) ||
    r.dates.length < 730 ||
    r.dates.length > 12000 ||
    r.dates[0] !== '2012-01-01'
  )
    return false;
  let previous = '';
  for (const date of r.dates) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= previous)
      return false;
    const time = Date.parse(date + 'T00:00:00Z');
    if (
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== date ||
      time / 1000 > Math.floor(r.verifiedAt / DAY) * DAY
    )
      return false;
    previous = date;
  }
  return true;
}

/** Reimplements the published fixed mathematics, not the source webpage or its prices. */
export function originalRainbowLevels(referenceIndex: number) {
  if (!Number.isSafeInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= 12000)
    throw new Error('Invalid original rainbow reference index');
  const centers = ORIGINAL_RAINBOW_COEFFICIENTS.map(
    (a, i) => 10 ** (a * Math.log(referenceIndex + ORIGINAL_RAINBOW_SHIFTS[i]) - 19.463),
  );
  const boundaries = centers.slice(0, -1).map((v, i) => Math.sqrt(v * centers[i + 1]));
  if (![...centers, ...boundaries].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('Unsafe original rainbow result');
  return { centers, boundaries };
}

/** Own USD prices are joined by exact official dates. Missing dates and open days stay absent. */
export function btcOriginalRainbow(
  points: readonly Point[],
  reference: OriginalRainbowReference = ORIGINAL_RAINBOW_BASELINE,
  now = Date.now() / 1000,
): OriginalRainbowPoint[] {
  if (!(Number.isFinite(now) || now === Infinity) || now < 0)
    throw new Error('Invalid rainbow observation cutoff');
  if (!originalRainbowReferenceValid(reference))
    throw new Error('Invalid original rainbow reference');
  const indices = new Map(reference.dates.map((d, i) => [Date.parse(d + 'T00:00:00Z') / 1000, i]));
  const result: OriginalRainbowPoint[] = [];
  let previous = -1;
  for (const point of points) {
    if (
      !Number.isSafeInteger(point.time) ||
      point.time % DAY !== 0 ||
      point.time <= previous ||
      point.time + DAY > now ||
      !Number.isFinite(point.value) ||
      point.value <= 0
    )
      continue;
    previous = point.time;
    const referenceIndex = indices.get(point.time);
    if (referenceIndex === undefined) continue;
    const { centers, boundaries } = originalRainbowLevels(referenceIndex);
    const below = boundaries.findIndex((boundary) => point.value >= boundary);
    result.push({
      time: point.time,
      price: point.value,
      centers,
      boundaries,
      bandIndex: below === -1 ? 9 : below,
      referenceIndex,
      modelVersion: reference.modelVersion,
    });
  }
  return result;
}
