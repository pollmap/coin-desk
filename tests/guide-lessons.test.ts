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
import { METRIC_GUIDES } from '../shared/metric-guides';
import { NETWORK_METRICS } from '../shared/network-catalog';

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
  it('distinguishes the fixed daily RSI, advanced bar settings and visible chart range', () => {
    const lesson = guideLesson(guideArticle('rsi')!);
    expect(guideArticle('rsi')!.formula).toContain('기본 RSI 14: 확정 일봉');
    expect(lesson.method.join(' ')).toContain('기본 RSI 14는 확정 일봉, N = 14');
    expect(lesson.method.join(' ')).toContain('고급 기술 설정에서는 봉 간격과 N을 따로');
    expect(lesson.method.join(' ')).toContain('표시 기간(1개월·1년 등)은 계산 기간 N을 바꾸지');
    expect(lesson.terms.find(([name]) => name === 'N')?.[1]).toContain('15개 종가');
    expect(METRIC_GUIDES.rsi.example).toContain('확정 일봉의 14개 변화');
    expect(METRIC_GUIDES.rsi.example).toContain('주봉 RSI 14는 14주 변화');
  });
  it('keeps public navigation and save instructions consistent with the focused chart', () => {
    for (const id of ['start', 'tool-dates', 'workspace', 'library', 'freshness']) {
      const article = guideArticle(id)!;
      const lesson = guideLesson(article);
      const publicText = [
        article.title,
        article.summary,
        article.read,
        article.formula,
        article.caution,
        ...article.steps,
        lesson.question,
        ...lesson.method,
        ...lesson.example,
        lesson.conclusion,
      ].join(' ');
      expect(publicText, id).not.toMatch(
        /날짜로 이동|시작·종료일을 입력|보이는 구간.*공유|작업공간 저장·불러오기|차트 아래.*저장|설정 버전|IndexedDB|수집 성공 시각/,
      );
    }
    const navigation = guideLesson(guideArticle('tool-dates')!);
    expect(navigation.method.join(' ')).toContain('기간 버튼');
    expect(navigation.method.join(' ')).toContain('확대');
    expect(navigation.method.join(' ')).toContain('내 저장');
    expect(navigation.conclusion).toContain('계산 기간을 바꾸지');
    expect(guideLesson(guideArticle('workspace')!).conclusion).toContain('현재 기기에 저장');
  });
  it('explains model inputs without promising removed metadata panels', () => {
    expect(guideLesson(guideArticle('btc-rainbow')!).data.join(' ')).not.toMatch(
      /계산 버전을 화면|표본 시작·끝 날짜.*표시/,
    );
    expect(guideLesson(guideArticle('cycles')!).data.join(' ')).not.toContain('따로 표시');
    for (const metric of NETWORK_METRICS) {
      const terms = guideLesson(guideArticle('net-' + metric.id)!).terms;
      expect(
        terms.map(([term]) => term),
        metric.id,
      ).not.toContain(metric.sourceMetric);
      expect(terms.flat().join(' '), metric.id).not.toContain('원천 지표 코드');
    }
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
