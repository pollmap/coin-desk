import { describe, expect, it } from 'vitest';
import {
  GUIDE_ARTICLES,
  GUIDE_PRESETS,
  guideArticle,
  guideForMetric,
  guideChartLink,
} from '../shared/learning-catalog';
import { guideLesson } from '../shared/guide-lessons';
import { guideReading, REVIEWED_GUIDE_IDS } from '../shared/guide-reading';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import IndicatorReading from '../src/IndicatorReading';

describe('beginner reading review', () => {
  it('renders the common price help and an always available context-preserving dictionary link', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(IndicatorReading, {
          metric: 'view:price',
          asset: 'DOGE',
          params: new URLSearchParams('price_source=upbit&period=5y&log=0'),
        }),
      ),
    );
    expect(html).toContain('캔들 하나');
    expect(html).toContain('/learn/candles?');
    expect(html).toContain('asset=DOGE');
    expect(html).toContain('price_source=upbit');
    expect(html).toContain('period=5y');
    expect(html).toContain('log=0');
    expect(html).not.toContain('<details open');
    expect(html.indexOf('guide-example')).toBeLessThan(html.indexOf('guide-method'));
  });
  it('requires an explicit definition, reading rule and distinction for every article', () => {
    expect([...REVIEWED_GUIDE_IDS].sort()).toEqual(GUIDE_ARTICLES.map((a) => a.id).sort());
    for (const article of GUIDE_ARTICLES) {
      const reading = guideReading(article.id);
      const lesson = guideLesson(article);
      expect(reading.meaning.length, article.id).toBeGreaterThan(20);
      expect(reading.lookFor.length, article.id).toBeGreaterThan(20);
      expect(reading.distinction.length, article.id).toBeGreaterThan(20);
      expect(new Set(Object.values(reading)).size, article.id).toBe(3);
      expect(lesson.example.length, article.id).toBeGreaterThan(0);
      expect(Object.values(reading).join(' '), article.id).not.toMatch(
        /수집 시각|체크포인트|API|캐시|계산 버전|준비 중|TBD/,
      );
    }
    expect(() => guideReading('unreviewed')).toThrow('Missing beginner reading');
  });
  it('starts with candle anatomy and proportional axes without BTC-only wording', () => {
    expect(GUIDE_PRESETS.slice(0, 2).map((p) => p.guide)).toEqual(['candles', 'log-scale']);
    expect(GUIDE_PRESETS.some((p) => /BTC/.test(p.title))).toBe(false);
    expect(guideReading('candles').lookFor).toContain('몸통');
    expect(guideReading('log-scale').lookFor).toContain('100→200과 200→400');
  });
  it('distinguishes address, transfer, account and monetary aggregates', () => {
    expect(guideReading('net-active_addresses').distinction).toContain('이용자 수와 다릅니다');
    expect(guideReading('net-transfers').distinction).toContain('한 거래에 여러 전송');
    expect(guideReading('futures-long_account_ratio').distinction).toContain('계약 수량');
    expect(guideReading('volume').distinction).toContain('거래대금');
    expect(guideReading('chain-tvl').distinction).toContain('자금 순유입');
  });
  it('keeps derived valuation and realized spending measures distinct', () => {
    expect(guideReading('net-realized_cap').distinction).toContain('독립적인');
    expect(guideReading('net-nupl').distinction).toContain('손실만의 비율');
    expect(guideReading('btc-sopr_24h').distinction).toContain('아직 움직이지 않은');
    expect(guideReading('btc-lth_mvrv').distinction).toContain('SOPR');
    expect(guideReading('net-mvrv').distinction).toContain('실제 매수 원가');
  });
  it('explains Original separately and preserves asset-restricted chart links', () => {
    const original = guideForMetric('view:btc_rainbow_original')!;
    expect(original.id).toBe('btc-rainbow-original');
    expect(guideLesson(original).method.join(' ')).toContain('2.8295');
    expect(guideReading(original.id).distinction).toContain('2022년 V2');
    expect(guideReading('asset-rainbow').distinction).toContain('복사한 모델이 아닙니다');
    expect(guideChartLink(original, 'DOGE', 'reference', new URLSearchParams())).toBeNull();
    const link = guideChartLink(
      original,
      'BTC',
      'reference',
      new URLSearchParams('period=5y&log=0'),
    )!;
    const query = new URL(link, 'https://example.test').searchParams;
    expect(query.get('metric')).toBe('view:btc_rainbow_original');
    expect(query.get('period')).toBe('5y');
    expect(query.get('log')).toBe('0');
    expect(guideArticle('btc-rainbow')).toBeDefined();
  });
});
