import { describe, it, expect } from 'vitest';
import fixture from './fixtures/supertrend-reference.json';
import { supertrend, supertrendSettings, validSupertrendOption } from '../shared/supertrend';
import { ASSETS } from '../shared/catalog';
import { supportsMarket } from '../shared/asset-registry';
import { indicatorDefinition, indicatorUrl } from '../shared/indicator-catalog';
import {
  guideArticle,
  guideChartLink,
  guideContext,
  searchGuides,
} from '../shared/learning-catalog';
import { normalizeDesk, workspaceUrl } from '../shared/workspace';
import { rankSearch } from '../shared/search';
import { bucket, bucketEnd } from '../shared/math';
import type { Candle, Interval } from '../shared/types';

const bars = fixture.bars as Candle[];
const now = bars.at(-1)!.closeTime + 1;
describe('OHLC Supertrend', () => {
  it.each(fixture.cases)(
    'matches independent Decimal reference for ATR $period and factor $multiplier',
    ({ period, multiplier, expected }) => {
      const actual = supertrend(bars, '1d', { period, multiplier }, now);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((row, i) => {
        expect(row.time).toBe(expected[i].time);
        expect(row.direction).toBe(expected[i].direction);
        for (const key of ['atr', 'upper', 'lower', 'value'] as const)
          expect(row[key]).toBeCloseTo(expected[i][key], 10);
      });
      expect(new Set(actual.map((r) => r.direction)).size).toBe(2);
    },
  );
  it('does not use future or unfinished bars or revise past results', () => {
    const first = bars.slice(0, 45);
    expect(supertrend(bars, '1d', undefined, first.at(-1)!.closeTime)).toEqual(
      supertrend(first, '1d', undefined, now),
    );
    expect(supertrend([...first, { ...bars[45], closed: false }], '1d', undefined, now)).toEqual(
      supertrend(first, '1d', undefined, now),
    );
    const firstResults = supertrend(first, '1d', undefined, now);
    expect(supertrend(bars, '1d', undefined, now).slice(0, firstResults.length)).toEqual(
      firstResults,
    );
  });
  it('restarts ATR after a missing or invalid OHLC candle without interpolation', () => {
    const missing = bars.filter((_, i) => i !== 30);
    const result = supertrend(missing, '1d', undefined, now);
    expect(result.filter((r) => r.time > bars[29].time && r.time < bars[40].time)).toEqual([]);
    expect(result.find((r) => r.time === bars[40].time)?.atr).toBeCloseTo(
      supertrend(bars.slice(31), '1d', undefined, now)[0].atr,
      12,
    );
    const bad = bars.map((b, i) => (i === 30 ? { ...b, high: b.low - 1 } : b));
    expect(supertrend(bad, '1d', undefined, now)).toEqual(result);
  });
  it('handles flat OHLC, equality, tiny asset units and insufficient samples', () => {
    const flat = bars.slice(0, 20).map((b) => ({ ...b, open: 12, high: 12, low: 12, close: 12 }));
    const result = supertrend(flat, '1d', undefined, now);
    expect(result).toHaveLength(11);
    expect(result.every((r) => r.atr === 0 && r.value === 12 && r.direction === 'down')).toBe(true);
    expect(supertrend(bars.slice(0, 9), '1d', undefined, now)).toEqual([]);
    const scale = 1e-7,
      tiny = bars.map((b) => ({
        ...b,
        open: b.open * scale,
        high: b.high * scale,
        low: b.low * scale,
        close: b.close * scale,
      }));
    supertrend(tiny, '1d', undefined, now).forEach((r, i) => {
      expect(r.value / scale).toBeCloseTo(fixture.cases[0].expected[i].value, 10);
      expect(r.direction).toBe(fixture.cases[0].expected[i].direction);
    });
  });
  it.each(['1h', '4h', '1w', '1M'] as Interval[])(
    'uses the selected actual %s candles and resets missing intervals',
    (interval) => {
      let time = bucket(bars[0].time, interval);
      const input = bars.slice(0, 22).map((b) => {
        const row = { ...b, time, closeTime: bucketEnd(time, interval) };
        time = row.closeTime;
        return row;
      });
      const actual = supertrend(input, interval, undefined, time + 1);
      expect(actual.map((r) => r.value)).toEqual(
        supertrend(bars.slice(0, 22), '1d', undefined, now).map((r) => r.value),
      );
      const missing = supertrend(
        input.filter((_, i) => i !== 10),
        interval,
        undefined,
        time + 1,
      );
      expect(missing[1].time).toBe(input[20].time);
    },
  );
});
describe('Supertrend selection, explanation and saved settings', () => {
  it('offers a supported actual-candle market for each of the 150 coins', () => {
    expect(ASSETS).toHaveLength(150);
    const d = indicatorDefinition('view:supertrend')!;
    expect(d.assets).toHaveLength(150);
    for (const a of ASSETS) {
      const p = new URL(
        indicatorUrl(a.id, d.id, new URLSearchParams('price_source=reference')),
        'https://test.invalid',
      ).searchParams;
      expect(p.get('metric')).toBe(d.id);
      expect(supportsMarket(a.id, p.get('price_source') as 'binance' | 'upbit')).toBe(true);
      expect(p.get('interval')).toBe('1w');
      expect(p.get('period')).toBe('all');
      expect(p.get('log')).toBe('0');
    }
  });
  it('supports Korean and English search without switching the selected coin', () => {
    for (const q of ['도지 슈퍼트렌드', '펭귄 supertrend']) {
      const hit = rankSearch(new URLSearchParams({ q, kind: 'indicator' }))[0];
      expect(hit.metric).toBe('view:supertrend');
      expect(hit.asset).toBe(q.startsWith('도지') ? 'DOGE' : 'PENGU');
    }
    expect(searchGuides('Supertrend').map((g) => g.id)).toContain('supertrend');
  });
  it('preserves source, interval, custom ATR parameters and range in guide and saved analysis', () => {
    const params = new URLSearchParams(
      'asset=DOGE&metric=view:supertrend&price_source=upbit&interval=1w&st_period=7&st_multiplier=2.5&period=all&chart_from=1700000000&chart_to=1790000000',
    );
    const link = guideChartLink(
      guideArticle('supertrend')!,
      'DOGE',
      'upbit',
      guideContext(params),
    )!;
    expect(link).toContain('metric=view%3Asupertrend');
    expect(link).toContain('st_period=7');
    expect(link).toContain('interval=1w');
    expect(guideChartLink(guideArticle('supertrend')!, 'DOGE', 'reference')).toBeNull();
    const desk = normalizeDesk({
      version: 2,
      favorites: [],
      cards: [],
      workspaces: [
        {
          name: '추세',
          asset: 'DOGE',
          metric: 'view:supertrend',
          priceSource: 'upbit',
          interval: '1w',
          period: 'all',
          analysisOptions: { st_period: '7', st_multiplier: '2.5', memo: 'private' },
        },
      ],
    });
    expect(workspaceUrl(desk.workspaces[0])).toContain('st_multiplier=2.5');
    expect(workspaceUrl(desk.workspaces[0])).not.toContain('private');
  });
  it('rejects invalid settings and restores explicit documented defaults', () => {
    expect(
      supertrendSettings(new URLSearchParams('st_period=10.5&st_multiplier=Infinity')),
    ).toEqual({ period: 10, multiplier: 3 });
    for (const value of ['0', '1001', 'NaN', '-1', '3.1'])
      expect(validSupertrendOption('st_period', value)).toBe(false);
    expect(supertrend(bars, '1d', { period: 10, multiplier: NaN }, now)).toEqual([]);
  });
});
