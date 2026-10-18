import { describe, it, expect } from 'vitest';
import {
  btcOriginalRainbow,
  originalRainbowLevels,
  originalRainbowReferenceValid,
  ORIGINAL_RAINBOW_BASELINE as baseline,
  ORIGINAL_RAINBOW_FORMULA,
  ORIGINAL_RAINBOW_FORMULA_HASH,
  ORIGINAL_RAINBOW_SCRIPT,
} from '../shared/btc-rainbow-original';
import { btcRainbow } from '../shared/btc-rainbow';
import {
  originalDatesFromPage,
  createOriginalReference,
  originalReferenceHash,
  verifyOriginalReference,
  fetchOriginalReference,
} from '../worker/rainbow-original-reference';
import { DAY } from '../shared/math';

const time = (date: string) => Date.parse(date + 'T00:00:00Z') / 1000;
const point = (date: string, value = 100) => ({ time: time(date), value });
const closed = time('2026-10-20');
function page(dates: string[], module = 79555) {
  // Synthetic wire fixture, no upstream code or price values are retained.
  const stream = [
    '5:' +
      JSON.stringify([
        '$',
        'div',
        null,
        { children: [{ data: dates.map((d) => ({ time: d, price: 1 })) }] },
      ]),
    '19:' +
      JSON.stringify([
        '$',
        'div',
        null,
        {
          id: 'rainbow-chart-original',
          children: [['$', '$L1d', null, { data: '$5:props:children:0:data' }]],
        },
      ]),
    '1d:I' + JSON.stringify([module, [new URL(ORIGINAL_RAINBOW_SCRIPT).pathname], 'default']),
  ].join('\n');
  return '<script>self.__next_f.push(' + JSON.stringify([1, stream]) + ')</script>';
}

describe('BlockchainCenter public Original fixed model', () => {
  it('pins only the actual date mapping and math definition with independently reproducible hashes', async () => {
    expect(await originalReferenceHash(ORIGINAL_RAINBOW_FORMULA)).toBe(
      ORIGINAL_RAINBOW_FORMULA_HASH,
    );
    expect(await verifyOriginalReference(baseline)).toEqual(baseline);
    expect(baseline.dates).toHaveLength(5400);
    expect(baseline.dates[0]).toBe('2012-01-01');
    expect(baseline.dates.at(-1)).toBe('2026-10-18');
    expect(Object.keys(baseline)).not.toContain('prices');
    await expect(
      verifyOriginalReference({ ...baseline, snapshotId: '0'.repeat(64) }),
    ).rejects.toThrow();
  });
  it('matches published fixed mathematics at three actual row indices, with ten lines and nine thresholds', () => {
    for (const [index, upper, lower] of [
      [0, 35.096175672804605, 1.4240984336239124],
      [3977, 280329.65513459465, 18001.729978377323],
      [5399, 1343195.9771489804, 85444.82565669004],
    ]) {
      const levels = originalRainbowLevels(index);
      expect(levels.centers).toHaveLength(10);
      expect(levels.boundaries).toHaveLength(9);
      expect(levels.centers[0]).toBeCloseTo(upper, 6);
      expect(levels.centers[9]).toBeCloseTo(lower, 6);
      levels.boundaries.forEach((value, i) => {
        expect(Math.log(value)).toBeCloseTo(
          (Math.log(levels.centers[i]) + Math.log(levels.centers[i + 1])) / 2,
          12,
        );
        expect(value).toBeLessThan(levels.centers[i]);
        expect(value).toBeGreaterThan(levels.centers[i + 1]);
      });
    }
    expect(baseline.dates.indexOf('2022-11-21')).toBe(3977);
    expect(() => originalRainbowLevels(-1)).toThrow();
  });
  it('never substitutes calendar days or the local series ordinal for missing official dates', () => {
    const missing = ['2024-05-24', '2024-05-26', '2024-05-27', '2024-10-30', '2024-10-31'];
    expect(missing.every((date) => !baseline.dates.includes(date))).toBe(true);
    expect(
      btcOriginalRainbow(
        missing.map((d) => point(d)),
        baseline,
        closed,
      ),
    ).toEqual([]);
    const rows = btcOriginalRainbow([point('2024-05-25'), point('2026-10-18')], baseline, closed);
    expect(rows[1].referenceIndex).toBe(5399);
    expect((rows[1].time - time('2012-01-01')) / DAY).toBe(5404);
    expect(rows[1].centers).toEqual(originalRainbowLevels(5399).centers);
    expect(rows[0].referenceIndex).toBe((time('2024-05-25') - time('2012-01-01')) / DAY - 1);
  });
  it('uses owned prices only on matching closed days, keeps boundaries independent of price and rejects invalid samples', () => {
    const rows = btcOriginalRainbow(
      [
        point('2011-12-31'),
        point('2022-11-21'),
        point('2022-11-21', 200),
        point('2026-10-17', NaN),
        point('2026-10-18'),
        point('2026-10-19'),
      ],
      baseline,
      time('2026-10-18') + 3600,
    );
    expect(rows).toHaveLength(1);
    const changed = btcOriginalRainbow([point('2022-11-21', 1e9)], baseline, closed)[0];
    expect(changed.centers).toEqual(rows[0].centers);
    expect(changed.bandIndex).toBe(0);
    expect(rows[0].bandIndex).toBe(9);
    expect(() => btcOriginalRainbow([], baseline, NaN)).toThrow();
    expect(
      originalRainbowReferenceValid({ ...baseline, dates: [...baseline.dates, '2026-02-30'] }),
    ).toBe(false);
  });
  it('extends only verified dates; a historical correction creates a new model version without mutating prior data', async () => {
    const before = structuredClone(baseline);
    const appended = await createOriginalReference(
      [...baseline.dates, '2026-10-19'],
      baseline,
      closed,
    );
    expect(appended.modelVersion).toBe(baseline.modelVersion);
    expect(appended.snapshotId).not.toBe(baseline.snapshotId);
    const sample = [point('2022-11-21'), point('2026-10-18')];
    expect(btcOriginalRainbow(sample, appended, closed)).toEqual(
      btcOriginalRainbow(sample, baseline, closed),
    );
    const revised = await createOriginalReference(
      [...baseline.dates, '2024-05-24'].sort(),
      baseline,
      closed,
    );
    expect(revised.modelVersion).not.toBe(baseline.modelVersion);
    expect(btcOriginalRainbow(sample, revised, closed)[1].referenceIndex).toBe(5400);
    expect(baseline).toEqual(before);
  });
});

describe('public reference parser and bounded validation', () => {
  it('resolves the Original component RSC data reference and does not guess a nearby dataset', () => {
    expect(originalDatesFromPage(page(['2011-12-31', ...baseline.dates]))).toEqual(baseline.dates);
    expect(() => originalDatesFromPage(page(baseline.dates, 84073))).toThrow('module_changed');
    expect(() =>
      originalDatesFromPage(page(baseline.dates).replace('rainbow-chart-original', 'other')),
    ).toThrow('component_missing');
    expect(() => originalDatesFromPage(page(['2012-01-01', '2012-01-01']))).toThrow(
      'dates_invalid',
    );
    expect(() => originalDatesFromPage('x'.repeat(1048577))).toThrow('body_limit');
  });
  it('fails closed for unknown script hashes and bounds each network call without accepting redirects', async () => {
    const requests: string[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(url));
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(
        String(url) === ORIGINAL_RAINBOW_SCRIPT ? 'unknown changed script' : page(baseline.dates),
      );
    }) as typeof fetch;
    await expect(fetchOriginalReference(baseline, fake, closed)).rejects.toThrow('source_changed');
    expect(requests).toHaveLength(2);
    await expect(
      fetchOriginalReference(
        baseline,
        (async () =>
          new Response('small', {
            headers: { 'content-length': '1048577' },
          })) as typeof fetch,
        closed,
      ),
    ).rejects.toThrow('body_limit');
  });
});

describe('legacy BTC expanding model safeguards', () => {
  it('excludes open/future UTC days and rejects unsafe outputs without changing normal historical fits', () => {
    const start = time('2012-01-01');
    const prices = Array.from({ length: 740 }, (_, i) => ({
      time: start + i * DAY,
      value: 50 + i / 3,
    }));
    expect(btcRainbow(prices, start + 735 * DAY)).toEqual(
      btcRainbow(prices.slice(0, 735), Infinity),
    );
    expect(() => btcRainbow(prices, NaN)).toThrow();
    const extreme = prices.map((p, i) => ({ ...p, value: i % 2 ? 1e300 : 1e-300 }));
    const result = btcRainbow(extreme, Infinity);
    expect(
      result.every((r) => [r.center, ...r.bands].every((v) => Number.isFinite(v) && v > 0)),
    ).toBe(true);
    expect(result).toEqual([]);
  });
});
