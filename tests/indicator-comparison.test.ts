import { describe, it, expect } from 'vitest';
import {
  comparisonSelection,
  commonObservations,
  indicatorComparisonUrl,
  type IndicatorComparisonRow,
} from '../shared/indicator-comparison';
import { observationGaps } from '../shared/dataset-coverage';
import { DEFAULT_DESK, normalizeDesk, importDesk, workspaceUrl } from '../shared/workspace';

describe('same-indicator contracts', () => {
  it('defaults to BTC/ETH MVRV and validates assets, providers and bounded dates', () => {
    expect(comparisonSelection(new URLSearchParams())).toMatchObject({
      assets: ['BTC', 'ETH'],
      metric: 'net:mvrv',
      source: 'coinmetrics',
      period: '5y',
    });
    for (const q of [
      'assets=BTC',
      'assets=BTC,BTC',
      'assets=BTC,FAKE',
      'assets=BTC,ETH,DOGE,SOL',
      'metric=rainbow',
      'source=upbit',
      'metric=rsi&source=bybit',
      'from=100&to=1',
      'from=-1',
      'to=9999999999',
      'metric=rsi&metric=drawdown',
      'limit=100',
    ])
      expect(() => comparisonSelection(new URLSearchParams(q))).toThrow();
    expect(
      comparisonSelection(new URLSearchParams('assets=ONDO,PENGU&metric=rsi&source=binance')),
    ).toMatchObject({ assets: ['ONDO', 'PENGU'], source: 'binance' });
  });
  it('only counts exact dates shared by every selected asset; never fills gaps', () => {
    const row = (asset: 'BTC' | 'ETH' | 'ONDO', times: number[]): IndicatorComparisonRow => ({
      asset,
      state: 'ready',
      data: times.map((time) => ({ time, value: 1 })),
    });
    expect(commonObservations([row('BTC', [1, 2, 4]), row('ETH', [2, 3, 4])])).toEqual({
      first: 2,
      last: 4,
      observations: 2,
    });
    expect(
      commonObservations([row('BTC', [1, 2, 4]), row('ETH', [2, 4]), row('ONDO', [])]),
    ).toEqual({ first: null, last: null, observations: 0 });
    expect(commonObservations([row('BTC', [1]), row('ETH', [2])])).toEqual({
      first: null,
      last: null,
      observations: 0,
    });
  });
  it('preserves the selected coin, metric, provider, period and pinned date on comparison entry', () => {
    const url = new URL(
      indicatorComparisonUrl(
        'ONDO',
        'rsi',
        new URLSearchParams(
          'price_source=upbit&period=1y&reading_date=1788220800&chart_from=1700000000&chart_to=1789000000',
        ),
      ),
      'https://test.invalid',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      assets: 'ONDO,BTC',
      source: 'upbit',
      metric: 'rsi',
      period: '1y',
      reading_date: '1788220800',
      chart_from: '1700000000',
    });
  });
  it('roundtrips comparison configuration with workspace versions 1 and 2 without moving private content into URLs', () => {
    for (const version of [1, 2]) {
      const desk = normalizeDesk({
        ...DEFAULT_DESK,
        version,
        workspaces: [
          {
            name: 'MVRV 비교',
            asset: 'BTC',
            metric: 'net:mvrv',
            period: '5y',
            dateWindow: { from: 1700000000, to: 1789000000 },
            analysisOptions: {
              comparison_mode: 'indicator',
              comparison_assets: 'BTC,ETH,DOGE',
              comparison_source: 'coinmetrics',
              reading_date: '1788220800',
            },
            note: 'private',
          },
        ],
      });
      const restored = importDesk(JSON.stringify(desk));
      const url = new URL(workspaceUrl(restored.workspaces[0]), 'https://test.invalid');
      expect(url.pathname).toBe('/compare');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        mode: 'indicator',
        assets: 'BTC,ETH,DOGE',
        metric: 'net:mvrv',
        source: 'coinmetrics',
        period: '5y',
        reading_date: '1788220800',
        chart_from: '1700000000',
      });
      expect(url.search).not.toContain('private');
    }
  });
});
describe('observation gaps are evidence, not an invented cause', () => {
  it('deduplicates unsorted observations and reports end-exclusive gap ranges', () => {
    expect(observationGaps([0, 4 * 86400, 86400, 86400], 86400)).toEqual({
      slots: 2,
      classification: 'unverified',
      ranges: [{ from: 2 * 86400, to: 4 * 86400 }],
    });
    expect(observationGaps([], 86400).slots).toBe(0);
  });
  it('never infers a funding settlement interval, and bounds returned ranges', () => {
    expect(observationGaps([0, 3600, 28800], null)).toEqual({
      slots: null,
      classification: 'not-applicable',
      ranges: [],
    });
    const gaps = observationGaps(
      Array.from({ length: 100 }, (_, i) => i * 7200),
      3600,
    );
    expect(gaps.slots).toBe(99);
    expect(gaps.ranges).toHaveLength(20);
  });
});
