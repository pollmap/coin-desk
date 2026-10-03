import { it, expect } from 'vitest';
import {
  GUIDE_ARTICLES,
  guideArticle,
  guideChartLink,
  guideForMetric,
  guideHref,
  searchGuides,
} from '../shared/learning-catalog';
import { PRIMARY_ASSETS, METRICS } from '../shared/catalog';
import { NETWORK_METRICS } from '../shared/network-catalog';
import { PATTERNS } from '../shared/candle-patterns';
import { ANALYSIS_VIEWS } from '../shared/advanced-analysis';
import {
  validAnalysisOption,
  normalizeDesk,
  workspaceUrl,
  DEFAULT_DESK,
} from '../shared/workspace';
import { belongsToSection } from '../shared/analysis-sections';
it('covers every current core metric, analysis and detector with valid related content', () => {
  expect(new Set(GUIDE_ARTICLES.map((g) => g.id)).size).toBe(GUIDE_ARTICLES.length);
  for (const m of NETWORK_METRICS) expect(guideForMetric('net:' + m.id)).toBeDefined();
  for (const m of METRICS) expect(guideForMetric('btc:' + m.id)).toBeDefined();
  for (const v of ANALYSIS_VIEWS.filter((v) => v !== 'price'))
    expect(guideArticle(v)).toBeDefined();
  for (const p of PATTERNS)
    expect(guideArticle('pattern-' + p.id)?.action).toEqual({ kind: 'pattern', id: p.id });
  for (const g of GUIDE_ARTICLES) {
    expect(
      g.assets.some((a) => PRIMARY_ASSETS.includes(a)),
      g.id,
    ).toBe(true);
    for (const r of g.related) expect(guideArticle(r), g.id + ' → ' + r).toBeDefined();
    expect(g.formula.length).toBeGreaterThan(5);
  }
});
it('routes executable articles to supported assets, sources and the correct primary chart', () => {
  for (const g of GUIDE_ARTICLES)
    for (const a of PRIMARY_ASSETS)
      for (const b of ['reference', 'upbit', 'binance'] as const) {
        const href = guideChartLink(g, a, b);
        const supported = g.assets.includes(a) && (!g.basis || g.basis.includes(b));
        expect(!!href, g.id + a + b).toBe(supported);
        if (!href) continue;
        const u = new URL(href, 'https://example.com');
        expect(u.searchParams.get('asset')).toBe(a);
        expect(u.searchParams.get('price_source')).toBe(b);
        if (g.action.kind === 'panel') {
          expect(u.searchParams.get('panels')).toBe(g.action.id);
          expect(
            belongsToSection(
              g.action.id,
              g.action.section === 'price' ? 'history' : g.action.section,
            ),
          ).toBe(true);
        }
      }
});
it('recognizes Korean, English and common aliases, with no private state carried into links', () => {
  expect(searchGuides('장악형').map((g) => g.id)).toContain('pattern-bullish-engulfing');
  expect(searchGuides('rSi').map((g) => g.id)).toContain('rsi');
  const params = new URLSearchParams(
    'asset=DOGE&price_source=upbit&interval=1w&period=all&chart_from=1700000000&chart_to=1750000000&private_text=secret&library_id=123&related=1&return=https://evil.test',
  );
  const link = guideChartLink(guideArticle('rsi')!, 'DOGE', 'upbit', params)!;
  expect(link).toContain('chart_from=1700000000');
  expect(link).toContain('interval=1w');
  for (const word of ['secret', 'library_id', 'return', 'related'])
    expect(link).not.toContain(word);
  expect(guideHref('rsi', params)).not.toContain('secret');
  expect(guideHref('rsi', new URLSearchParams('market=upbit&asset=DOGE'))).toContain(
    'price_source=upbit',
  );
  params.set('q', 'RSI');
  params.set('category', '추세·모멘텀');
  params.set('saved', '1');
  const browse = new URL(guideHref('rsi', params), 'https://example.com');
  expect(browse.searchParams.get('q')).toBe('RSI');
  expect(browse.searchParams.get('saved')).toBe('1');
  expect(guideChartLink(guideArticle('rsi')!, 'DOGE', 'upbit', params)).not.toContain('saved=');
  expect(
    guideChartLink(guideArticle('pattern-bullish-engulfing')!, 'DOGE', 'reference'),
  ).toBeNull();
});
it('preserves supported pattern choices in local workspace save, restore and public chart URL', () => {
  const desk = normalizeDesk({
    ...DEFAULT_DESK,
    workspaces: [
      {
        name: '패턴',
        asset: 'DOGE',
        market: 'upbit',
        priceSource: 'upbit',
        analysisOptions: {
          patterns: 'bullish-engulfing,doji',
          pattern_trend: 'none',
          private_note: 'secret',
        },
      },
    ],
  });
  const href = workspaceUrl(desk.workspaces[0]);
  expect(href).toContain('patterns=bullish-engulfing%2Cdoji');
  expect(href).toContain('pattern_trend=none');
  expect(href).not.toContain('secret');
  expect(validAnalysisOption('patterns', 'unknown')).toBe(false);
});

it('keeps the explicit comparison through the guide without private context', () => {
  const params = new URLSearchParams(
    'asset=ONDO&metric=view:relative&benchmark_asset=LINK&normalization=ratio&correlation=365&price_source=binance&period=1y&memo=private',
  );
  const guide = new URL(guideHref('relative', params), 'https://example.com');
  const back = new URL(
    guideChartLink(guideArticle('relative')!, 'ONDO', 'binance', guide.searchParams)!,
    'https://example.com',
  );
  expect(back.searchParams.get('benchmark_asset')).toBe('LINK');
  expect(back.searchParams.get('normalization')).toBe('ratio');
  expect(back.searchParams.get('correlation')).toBe('365');
  expect(back.searchParams.has('memo')).toBe(false);
});
