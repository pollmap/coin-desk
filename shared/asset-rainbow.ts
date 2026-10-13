import type { Point, Asset } from './types';
import type { PriceBasis } from './analysis-workspace';
import type { RainbowPoint } from './btc-rainbow';
import { DAY } from './math';
import origins from './rainbow-origins.json' with { type: 'json' };

export const ASSET_RAINBOW_VERSION = 'bori-asset-expanding-log-regression-v1';
export const ASSET_RAINBOW_ANCHOR_VERSION = origins.version;
export const ASSET_RAINBOW_MIN_OBSERVATIONS = 730;
export const ASSET_RAINBOW_OFFSETS = Array.from({ length: 10 }, (_, i) => -2.25 + i * 0.5);

export interface AssetRainbowContext {
  asset: Asset;
  basis: PriceBasis;
  unit: 'KRW' | 'USDT' | 'USD';
  origin: number | null;
  anchorVersion: string;
  modelVersion: string;
  dataRevision: string;
  observations: number;
  first: number | null;
  last: number | null;
}

export interface AssetRainbowDiagnostics {
  rows: RainbowPoint[];
  eligibleFits: number;
  rejectedFits: number;
}

/** Frozen v1 source anchor; routine history catalog updates must not move existing model origins. */
export function assetRainbowOrigin(asset: Asset, basis: PriceBasis): number | null {
  const origin = (origins.assets as Record<string, Partial<Record<PriceBasis, number>>>)[asset]?.[
    basis
  ];
  return origin === undefined ? null : origin;
}

function validOrigin(origin: number): boolean {
  return Number.isSafeInteger(origin) && origin >= 0 && origin % DAY === 0;
}

function checkedCutoff(now: number): number {
  if (!(Number.isFinite(now) || now === Infinity) || now < 0)
    throw new Error('Invalid rainbow observation cutoff');
  return now;
}

/** Keep chronological, positive, closed UTC days. Missing days are not interpolated. */
function* observations(points: readonly Point[], origin: number, now: number): Generator<Point> {
  let previous = -1;
  for (const point of points) {
    if (
      !Number.isSafeInteger(point.time) ||
      point.time % DAY !== 0 ||
      point.time < origin ||
      point.time <= previous ||
      point.time + DAY > now ||
      !Number.isFinite(point.value) ||
      point.value <= 0
    )
      continue;
    previous = point.time;
    yield point;
  }
}

/** O(n) expanding OLS; the plotted day is excluded from its own fit. */
export function assetRainbowDiagnostics(
  points: readonly Point[],
  origin: number,
  now = Date.now() / 1000,
): AssetRainbowDiagnostics {
  if (!validOrigin(origin)) throw new Error('Invalid frozen rainbow origin');
  checkedCutoff(now);
  const result: RainbowPoint[] = [];
  let eligibleFits = 0;
  let rejectedFits = 0;
  let n = 0,
    mx = 0,
    my = 0,
    sxx = 0,
    sxy = 0,
    syy = 0,
    first = 0,
    last = 0;
  for (const point of observations(points, origin, now)) {
    const x = Math.log1p((point.time - origin) / DAY);
    const y = Math.log(point.value);
    if (n >= ASSET_RAINBOW_MIN_OBSERVATIONS && sxx > 0) {
      eligibleFits++;
      const b = sxy / sxx;
      const a = my - b * mx;
      const sigma = Math.sqrt(Math.max(0, (syy - b * sxy) / n));
      const logCenter = a + b * x;
      const center = Math.exp(logCenter);
      const bands = ASSET_RAINBOW_OFFSETS.map((offset) => Math.exp(logCenter + offset * sigma));
      const z = sigma > 1e-10 ? (y - logCenter) / sigma : null;
      // Extremely ill-conditioned fits must not put zero or infinite values on a price axis.
      if (
        [a, b, sigma, center, ...bands].every(Number.isFinite) &&
        center > 0 &&
        bands.every((value) => value > 0) &&
        (z === null || Number.isFinite(z))
      )
        result.push({
          time: point.time,
          price: point.value,
          center,
          sigma,
          z,
          bands,
          a,
          b,
          observations: n,
          first,
          last,
        });
      else rejectedFits++;
    }
    n++;
    const dx = x - mx;
    const dy = y - my;
    mx += dx / n;
    my += dy / n;
    sxx += dx * (x - mx);
    sxy += dx * (y - my);
    syy += dy * (y - my);
    if (n === 1) first = point.time;
    last = point.time;
  }
  return { rows: result, eligibleFits, rejectedFits };
}

export function assetRainbow(
  points: readonly Point[],
  origin: number,
  now = Date.now() / 1000,
): RainbowPoint[] {
  return assetRainbowDiagnostics(points, origin, now).rows;
}

/** Fast deterministic observation fingerprint; this is not a security or authenticity hash. */
function fingerprint(parts: Iterable<string>): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const part of parts) {
    for (let index = 0; index < part.length; index++) {
      first = Math.imul(first ^ part.charCodeAt(index), 0x01000193);
      second = Math.imul(second ^ part.charCodeAt(index), 0x85ebca6b);
    }
    first = Math.imul(first ^ 10, 0x01000193);
    second = Math.imul(second ^ 10, 0x85ebca6b);
  }
  return `obs-v1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

/** Context is independent of viewport range; pass the complete source history, not a display slice. */
export function assetRainbowContext(
  asset: Asset,
  basis: PriceBasis,
  points: readonly Point[],
  options: { origin?: number; anchorVersion?: string; now?: number } = {},
): AssetRainbowContext {
  const origin = options.origin ?? assetRainbowOrigin(asset, basis);
  if (origin !== null && !validOrigin(origin)) throw new Error('Invalid frozen rainbow origin');
  const now = checkedCutoff(options.now ?? Date.now() / 1000);
  const anchorVersion = options.anchorVersion ?? origins.version;
  if (!anchorVersion.trim() || anchorVersion.length > 128)
    throw new Error('Invalid rainbow anchor version');
  let count = 0;
  let first: number | null = null;
  let last: number | null = null;
  function* revisionParts(): Generator<string> {
    yield JSON.stringify([asset, basis, origin, anchorVersion, ASSET_RAINBOW_VERSION]);
    if (origin === null) return;
    for (const point of observations(points, origin, now)) {
      count++;
      first ??= point.time;
      last = point.time;
      yield `${point.time}:${point.value}`;
    }
  }
  const dataRevision = fingerprint(revisionParts());
  return {
    asset,
    basis,
    unit: basis === 'upbit' ? 'KRW' : basis === 'binance' ? 'USDT' : 'USD',
    origin,
    anchorVersion,
    modelVersion: ASSET_RAINBOW_VERSION,
    dataRevision,
    observations: count,
    first,
    last,
  };
}
