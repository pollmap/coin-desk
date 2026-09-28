import { describe, expect, it } from 'vitest';
import {
  GUIDE_ARTICLES,
  GUIDE_PRESETS,
  guideArticle,
  guideHref,
  searchGuides,
} from '../shared/learning-catalog';
import { guideLesson } from '../shared/guide-lessons';
import { rollingVwap, seasonality, powerLaw } from '../shared/advanced-analysis';
import { DAY } from '../shared/math';

describe('guide explanation coverage', () => {
  it.each(GUIDE_ARTICLES)(
    '$id has a concrete method, example and interpretation independent of live data',
    (g) => {
      const l = guideLesson(g);
      expect(l.question).toContain('?');
      expect(l.method.length).toBeGreaterThan(0);
      expect(l.example.length).toBeGreaterThan(0);
      expect(l.conclusion.length).toBeGreaterThan(20);
      expect(l.method.join(' ')).not.toMatch(/추후|준비 중|TBD/);
      expect(l.method.join(' ')).not.toBe(g.summary);
    },
  );
  it('starts from a readable explanation, including the formerly undocumented band', () => {
    expect(GUIDE_PRESETS.some((p) => p.guide === 'rainbow')).toBe(true);
    for (const p of GUIDE_PRESETS) {
      expect(guideArticle(p.guide)).toBeDefined();
      expect(guideHref(p.guide, new URLSearchParams())).toMatch(/^\/learn\//);
    }
    expect(searchGuides('표준편차').some((g) => g.id === 'rainbow')).toBe(true);
  });
  it('checks numerical VWAP and power-law examples against executable calculations', () => {
    const time = Date.UTC(2020, 0, 1) / 1000;
    const bars = [100, 120].map((v, i) => ({
      time: time + i * DAY,
      closeTime: time + (i + 1) * DAY,
      closed: true,
      open: v,
      high: v,
      low: v,
      close: v,
      volume: i ? 3 : 1,
    }));
    expect(rollingVwap(bars, 2)[0].value).toBe(115);
    expect(
      powerLaw([{ time: Date.UTC(2009, 0, 3) / 1000 + 1000 * DAY, value: 1 }])[0].value,
    ).toBeCloseTo(2.79, 2);
  });
  it('checks mean, median and interpolated quartiles from the guide using complete years', () => {
    const start = Date.UTC(2020, 11, 31) / 1000;
    const end = Date.UTC(2024, 0, 1) / 1000;
    let value = 100;
    const points = [];
    for (let t = start; t < end; t += DAY) {
      const d = new Date(t * 1000);
      if (d.getUTCMonth() === 0 && d.getUTCDate() === 1)
        value *= ({ 2021: 0.9, 2022: 1.1, 2023: 1.9 } as Record<number, number>)[
          d.getUTCFullYear()
        ];
      points.push({ time: t, value });
    }
    const result = seasonality(points, end + DAY).summary[0];
    expect(result.mean).toBeCloseTo(30);
    expect(result.median).toBeCloseTo(10);
    expect(result.low).toBeCloseTo(0);
    expect(result.high).toBeCloseTo(50);
  });
});
