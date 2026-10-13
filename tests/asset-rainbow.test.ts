import { describe, expect, it } from 'vitest';
import {
  assetRainbow,
  assetRainbowDiagnostics,
  assetRainbowContext,
  assetRainbowOrigin,
  ASSET_RAINBOW_MIN_OBSERVATIONS,
  ASSET_RAINBOW_OFFSETS,
  ASSET_RAINBOW_VERSION,
  ASSET_RAINBOW_ANCHOR_VERSION,
} from '../shared/asset-rainbow';
import frozenOrigins from '../shared/rainbow-origins.json';
import { btcRainbow } from '../shared/btc-rainbow';
import { DAY } from '../shared/math';
import type { Point } from '../shared/types';

const origin = Date.UTC(2017, 8, 25) / 1000;
const history = (count: number, start = origin): Point[] =>
  Array.from({ length: count }, (_, index) => ({
    time: start + index * DAY,
    value: Math.exp(1.1 + 0.72 * Math.log1p(index) + 0.15 * Math.sin(index / 17)),
  }));

function batchRegression(prior: Point[], time: number, anchor: number) {
  const x = prior.map((point) => Math.log1p((point.time - anchor) / DAY));
  const y = prior.map((point) => Math.log(point.value));
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const b =
    x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0) /
    x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const a = meanY - b * meanX;
  const sigma = Math.sqrt(
    y.reduce((sum, value, index) => sum + (value - a - b * x[index]) ** 2, 0) / y.length,
  );
  const logCenter = a + b * Math.log1p((time - anchor) / DAY);
  return { a, b, sigma, center: Math.exp(logCenter) };
}

describe('source-specific expanding asset rainbow', () => {
  it('matches independent two-pass OLS and residual variance across increasing samples', () => {
    const points = history(810);
    const rows = assetRainbow(points, origin, Infinity);
    expect(rows).toHaveLength(80);
    for (const offset of [0, 19, 79]) {
      const row = rows[offset];
      const expected = batchRegression(points.slice(0, 730 + offset), row.time, origin);
      expect(row.a).toBeCloseTo(expected.a, 10);
      expect(row.b).toBeCloseTo(expected.b, 10);
      expect(row.sigma).toBeCloseTo(expected.sigma, 10);
      expect(row.center).toBeCloseTo(expected.center, 9);
      expect(row.observations).toBe(730 + offset);
      expect(row.first).toBe(origin);
      expect(row.last).toBe(row.time - DAY);
      expect(row.bands).toHaveLength(10);
      row.bands.forEach((value, index) =>
        expect(value).toBeCloseTo(
          expected.center * Math.exp(ASSET_RAINBOW_OFFSETS[index] * expected.sigma),
          9,
        ),
      );
    }
    expect(ASSET_RAINBOW_MIN_OBSERVATIONS).toBe(730);
    expect(ASSET_RAINBOW_OFFSETS).toEqual([
      -2.25, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75, 2.25,
    ]);
  });

  it('excludes the displayed observation and never changes past fits after future appends', () => {
    const points = history(800);
    const rows = assetRainbow(points, origin, Infinity);
    const changed = points.map((point, index) =>
      index >= 760 ? { ...point, value: point.value * 9 } : point,
    );
    expect(assetRainbow(changed, origin, Infinity).slice(0, 30)).toEqual(rows.slice(0, 30));
    const changedCurrent = points.map((point, index) =>
      index === 730 ? { ...point, value: 90000 } : point,
    );
    expect(assetRainbow(changedCurrent, origin, Infinity)[0].center).toBe(rows[0].center);
    expect(assetRainbow(history(900), origin, Infinity).slice(0, rows.length)).toEqual(rows);
  });

  it('counts valid observations, permits missing dates, and never interpolates', () => {
    const points = history(745).filter((_, index) => index !== 50);
    const rows = assetRainbow(points, origin, Infinity);
    expect(rows[0].time).toBe(origin + 731 * DAY);
    expect(rows[0].observations).toBe(730);
    const expected = batchRegression(points.slice(0, 730), rows[0].time, origin);
    expect(rows[0].b).toBeCloseTo(expected.b, 10);
    expect(assetRainbow(history(730), origin, Infinity)).toEqual([]);
  });

  it('ignores duplicate/backward dates and invalid prices without poisoning the fit', () => {
    const points = history(750);
    const duplicate = [
      ...points.slice(0, 200),
      { ...points[199], value: 900000 },
      ...points.slice(200),
    ];
    const backward = [...points.slice(0, 200), points[10], ...points.slice(200)];
    expect(assetRainbow(duplicate, origin, Infinity)).toEqual(
      assetRainbow(points, origin, Infinity),
    );
    expect(assetRainbow(backward, origin, Infinity)).toEqual(
      assetRainbow(points, origin, Infinity),
    );
    const bad = points.map((point, index) =>
      index === 10
        ? { ...point, value: 0 }
        : index === 11
          ? { ...point, value: Infinity }
          : index === 12
            ? { ...point, time: point.time + 5 }
            : index === 13
              ? { ...point, value: NaN }
              : point,
    );
    expect(assetRainbow(bad, origin, Infinity)).toEqual(
      assetRainbow(
        points.filter((_, index) => ![10, 11, 12, 13].includes(index)),
        origin,
        Infinity,
      ),
    );
    expect(points[199].value).not.toBe(900000);
  });

  it('excludes unfinished/future UTC days using the explicit cutoff', () => {
    const points = history(760);
    const cutoff = points[745].time + DAY - 1;
    expect(assetRainbow(points, origin, cutoff)).toEqual(
      assetRainbow(points.slice(0, 745), origin, Infinity),
    );
    expect(assetRainbow(points, origin, points[745].time + DAY)).toEqual(
      assetRainbow(points.slice(0, 746), origin, Infinity),
    );
  });

  it('keeps flat prices finite and has no standardised position when variance is zero', () => {
    const points = history(750).map((point) => ({ ...point, value: 0.00000012 }));
    const rows = assetRainbow(points, origin, Infinity);
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.sigma === 0 && row.z === null && row.b === 0)).toBe(true);
    expect(
      rows.every((row) => row.bands.every((value) => Math.abs(value / 0.00000012 - 1) < 1e-12)),
    ).toBe(true);
  });

  it('requires an explicit valid frozen origin and accepts epoch-zero origins', () => {
    for (const invalid of [-DAY, origin + 1, NaN, Infinity])
      expect(() => assetRainbow(history(731), invalid, Infinity)).toThrow('origin');
    expect(() => assetRainbow(history(731), origin, NaN)).toThrow('cutoff');
    expect(assetRainbow(history(731, 0), 0, Infinity)[0].first).toBe(0);
  });

  it('does not silently move an origin after earlier history is recovered', () => {
    const points = history(760);
    const older = Array.from({ length: 30 }, (_, index) => ({
      time: origin - (30 - index) * DAY,
      value: 1.2 + index / 20,
    }));
    expect(assetRainbow([...older, ...points], origin, Infinity)).toEqual(
      assetRainbow(points, origin, Infinity),
    );
    const old = assetRainbowContext('BTC', 'upbit', points, {
      origin,
      anchorVersion: 'first-v1',
      now: Infinity,
    });
    const unchanged = assetRainbowContext('BTC', 'upbit', [...older, ...points], {
      origin,
      anchorVersion: 'first-v1',
      now: Infinity,
    });
    expect(unchanged).toEqual(old);
    const newContext = assetRainbowContext('BTC', 'upbit', [...older, ...points], {
      origin: origin - 30 * DAY,
      anchorVersion: 'first-v2',
      now: Infinity,
    });
    expect(newContext.origin).not.toBe(old.origin);
    expect(newContext.dataRevision).not.toBe(old.dataRevision);
    expect(assetRainbow([...older, ...points], origin - 30 * DAY, Infinity)[0].center).not.toBe(
      assetRainbow(points, origin, Infinity)[0].center,
    );
  });

  it('fingerprints source, unit, origin, version and accepted content deterministically', () => {
    const points = history(740);
    const context = assetRainbowContext('BTC', 'upbit', points, { now: Infinity });
    expect(context.origin).toBe(assetRainbowOrigin('BTC', 'upbit'));
    expect(context.unit).toBe('KRW');
    expect(context.modelVersion).toBe(ASSET_RAINBOW_VERSION);
    expect(context.anchorVersion).toBe('bori-rainbow-anchor-v1');
    expect(ASSET_RAINBOW_ANCHOR_VERSION).toBe(frozenOrigins.version);
    expect(context.observations).toBe(740);
    expect(context).toEqual(
      assetRainbowContext(
        'BTC',
        'upbit',
        points.map((point) => ({ ...point })),
        { now: Infinity },
      ),
    );
    expect(
      assetRainbowContext('BTC', 'binance', points, { origin, now: Infinity }).dataRevision,
    ).not.toBe(context.dataRevision);
    expect(assetRainbowContext('BTC', 'reference', points, { origin, now: Infinity }).unit).toBe(
      'USD',
    );
    const modified = points.map((point, index) =>
      index === 15 ? { ...point, value: point.value + 0.1 } : point,
    );
    expect(assetRainbowContext('BTC', 'upbit', modified, { now: Infinity }).dataRevision).not.toBe(
      context.dataRevision,
    );
    expect(() => assetRainbowContext('BTC', 'upbit', points, { anchorVersion: '' })).toThrow(
      'version',
    );
  });

  it('distinguishes historical source revisions from future-only appends', () => {
    const points = history(790);
    const changed = points.map((point, index) =>
      index === 740 ? { ...point, value: point.value * 3 } : point,
    );
    const before = assetRainbow(points, origin, Infinity);
    const after = assetRainbow(changed, origin, Infinity);
    expect(after.slice(0, 10).map((row) => row.center)).toEqual(
      before.slice(0, 10).map((row) => row.center),
    );
    expect(after[11].center).not.toBe(before[11].center);
    expect(
      assetRainbowContext('BTC', 'upbit', changed, { origin, now: Infinity }).dataRevision,
    ).not.toBe(assetRainbowContext('BTC', 'upbit', points, { origin, now: Infinity }).dataRevision);
  });

  it('retains the existing BTC genesis model as a distinct calculation', () => {
    const points = history(760);
    expect(assetRainbow(points, origin, Infinity)[0].center).not.toBe(btcRainbow(points)[0].center);
  });

  it('keeps missing source anchors null and records the verified source snapshot', () => {
    expect(frozenOrigins.sourceVersion).toBe('verified-history-start-v1');
    expect(frozenOrigins.reviewedAt).toBeTruthy();
    const missing = Object.entries(frozenOrigins.assets).find(
      ([, sources]) => !('upbit' in sources),
    );
    expect(missing).toBeDefined();
    const asset = missing![0] as Parameters<typeof assetRainbowOrigin>[0];
    expect(assetRainbowOrigin(asset, 'upbit')).toBeNull();
    const context = assetRainbowContext(asset, 'upbit', history(800), { now: Infinity });
    expect(context.origin).toBeNull();
    expect(context.observations).toBe(0);
    expect(context.first).toBeNull();
    expect(context.last).toBeNull();
  });

  it('reports numerically rejected fits separately from insufficient history', () => {
    const points = history(731).map((point, index) => ({
      ...point,
      value: index === 729 ? 1e308 : Number.MIN_VALUE,
    }));
    const result = assetRainbowDiagnostics(points, origin, Infinity);
    expect(result.eligibleFits).toBe(1);
    expect(result.rejectedFits).toBe(1);
    expect(result.rows).toEqual([]);
    expect(assetRainbowDiagnostics(points.slice(0, 730), origin, Infinity)).toEqual({
      rows: [],
      eligibleFits: 0,
      rejectedFits: 0,
    });
  });
});
