import { describe, expect, it } from 'vitest';
import { ASSETS } from '../shared/catalog';
import { relativePair } from '../shared/relative-pair';
import { INDICATORS_CATALOG } from '../shared/indicator-catalog';
import { guideArticle } from '../shared/learning-catalog';
import { normalizeDesk, workspaceUrl } from '../shared/workspace';
import { alignComparison, rollingCorrelation } from '../shared/advanced-analysis';
describe('selected-coin pair and saved compatibility', () => {
  it('keeps all eight selected assets and excludes self comparisons', () => {
    for (const { id } of ASSETS) {
      expect(relativePair(id, new URLSearchParams())).toEqual({
        asset: id,
        benchmark: id === 'BTC' ? 'ETH' : 'BTC',
        migrated: false,
      });
      expect(relativePair(id, new URLSearchParams('benchmark_asset=' + id)).benchmark).not.toBe(id);
    }
  });
  it('migrates old explicit correlation targets but lets the new field win', () => {
    expect(relativePair('ONDO', new URLSearchParams('correlation_asset=DOGE'))).toEqual({
      asset: 'DOGE',
      benchmark: 'BTC',
      migrated: true,
    });
    expect(
      relativePair('ONDO', new URLSearchParams('correlation_asset=ETH&benchmark_asset=SOL')),
    ).toEqual({ asset: 'ONDO', benchmark: 'SOL', migrated: false });
  });
  it('preserves a non-core benchmark through v1/v2 normalization and share URL', () => {
    for (const version of [1, 2]) {
      const desk = normalizeDesk({
        version,
        workspaces: [
          {
            name: '온도와 링크',
            asset: 'ONDO',
            market: 'binance',
            metric: 'view:relative',
            analysisOptions: { benchmark_asset: 'LINK' },
          },
        ],
      });
      const url = new URL(workspaceUrl(desk.workspaces[0]), 'https://example.com');
      expect(url.searchParams.get('asset')).toBe('ONDO');
      expect(url.searchParams.get('benchmark_asset')).toBe('LINK');
    }
  });
  it('calculates the actual pair ratio and common-date normalization independently', () => {
    const base = 1609459200,
      make = (values: number[]) => values.map((value, i) => ({ time: base + i * 86400, value }));
    const inputs = [
      { name: 'BTC', data: make([10, 20, 15]) },
      { name: 'ONDO', data: make([2, 6, 3]) },
    ];
    expect(alignComparison(inputs, 'ratio')[1].data.map((p) => p.value)).toEqual([0.2, 0.3, 0.2]);
    expect(alignComparison(inputs, 'index')[1].data.map((p) => p.value)).toEqual([100, 300, 150]);
    expect(alignComparison(inputs, 'percent')[1].data.map((p) => p.value)).toEqual([0, 200, 50]);
    const cut = [inputs[0], { ...inputs[1], data: inputs[1].data.slice(1) }];
    expect(alignComparison(cut, 'index')[1].data.map((p) => p.value)).toEqual([100, 50]);
  });
  it('matches an independent Pearson calculation and never changes history with future observations', () => {
    const a = Array.from({ length: 95 }, (_, i) => ({
      time: 1609459200 + i * 86400,
      value: 20 + i + Math.sin(i),
    }));
    const b = a.map((p, i) => ({ ...p, value: 40 + i / 2 + Math.cos(i) * 2 }));
    const r = (x: typeof a) => x.slice(1).map((p, i) => Math.log(p.value / x[i].value));
    const x = r(a.slice(0, 31)),
      y = r(b.slice(0, 31));
    const avg = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length,
      mx = avg(x),
      my = avg(y);
    const expected =
      x.reduce((s, n, i) => s + (n - mx) * (y[i] - my), 0) /
      Math.sqrt(
        x.reduce((s, n) => s + (n - mx) ** 2, 0) * y.reduce((s, n) => s + (n - my) ** 2, 0),
      );
    expect(rollingCorrelation(a, b, 30)[0].value).toBeCloseTo(expected, 12);
    expect(rollingCorrelation(a, b, 30).slice(0, 35)).toEqual(
      rollingCorrelation(a.slice(0, 65), b.slice(0, 65), 30),
    );
    expect(
      rollingCorrelation(
        a,
        a.map((p) => ({ ...p, value: 1 })),
        30,
      ),
    ).toEqual([]);
  });
  it('provides actual explanations for every exposed indicator', () => {
    for (const d of INDICATORS_CATALOG) {
      expect(guideArticle(d.guide), d.id).toBeDefined();
      for (const field of [
        d.shortMeaning,
        d.baselineMeaning,
        d.observationCadence,
        d.measurementScope,
        d.formula,
      ])
        expect(field, d.id).toBeTruthy();
      expect(d.formula, d.id).not.toBe('확정 가격 이력으로 계산');
    }
  });
});
