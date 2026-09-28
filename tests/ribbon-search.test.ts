import { expect, it } from 'vitest';
import { applyRibbon, ribbonSettings } from '../shared/ribbon';
import { workspaceIndicators } from '../shared/workspace-indicators';
import {
  normalizeResearch,
  mergeResearch,
  validRecipe,
  recipeUrl,
} from '../shared/research-library';
import { buildLibraryIndex, searchDocument, searchLibrary } from '../shared/library-search';

it('applies validated bar ribbons while preserving daily and oscillator overlays', () => {
  expect(applyRibbon(['sma:7:bar', 'sma200', 'rsi'], 'ema', '55, 8, 21').value).toEqual([
    'ema:8:bar',
    'ema:21:bar',
    'ema:55:bar',
    'sma200',
    'rsi',
  ]);
  for (const p of ['7,7', '1,20', '7,1001', '7,Infinity', '7,2.5', '7'])
    expect(applyRibbon([], 'sma', p).error).toBeTruthy();
  expect(applyRibbon(['rsi', 'sma200'], 'sma', '2,3,4,5,6,7,8,9,10').error).toBeTruthy();
  expect(ribbonSettings(['ema:8:bar', 'ema:21:bar', 'sma200'])).toEqual({
    kind: 'ema',
    periods: '8, 21',
  });
});
it('gives each ribbon line a distinct color without changing calculated values or gaps', () => {
  const input = Array.from({ length: 240 }, (_, i) => ({ time: i * 86400, value: 100 + i }));
  const ids = applyRibbon([], 'sma', '7,25,50,100').value;
  const lines = workspaceIndicators(input, input, ids, 'USD', 86400, true);
  expect(new Set(lines.map((l) => l.color)).size).toBe(4);
  expect(lines[0].data.at(-1)?.value).toBe(336);
  const withGap = workspaceIndicators(
    input.filter((_, i) => i !== 220),
    input,
    ids,
    'USD',
    86400,
    true,
  );
  expect(withGap[1].data.some((p) => p.time > 220 * 86400)).toBe(false);
});
it('searches multiword normalized text, exact author and applicable review state in stable date order', () => {
  const rows = [
    normalizeResearch(
      { post_id: '1', account: 'a', text: 'BTC EMA', date_utc: '2024-01-01' },
      'fixture',
    ),
    normalizeResearch(
      {
        post_id: '2',
        account: 'b',
        text: 'BTC long EMA',
        date_utc: '2025-01-01',
        images: [{ url: 'https://pbs.twimg.com/media/a.png' }],
      },
      'fixture',
    ),
    normalizeResearch(
      { post_id: '3', account: 'a', text: 'ETH', review: { text: true, method: true } },
      'fixture',
    ),
  ];
  const index = buildLibraryIndex(rows.map(searchDocument));
  expect(searchLibrary(index, { query: 'ＥＭＡ btc' })).toEqual(['x:2', 'x:1']);
  expect(searchLibrary(index, { review: 'images' })).toEqual(['x:2']);
  expect(searchLibrary(index, { review: 'complete' })).toEqual(['x:3']);
  expect(searchLibrary(index, { author: 'a', asset: 'BTC' })).toEqual(['x:1']);
  expect(searchLibrary(index, { query: 'btc', review: 'complete' })).toEqual([]);
});
it('does not replace full reviewed text and local media references with a collapsed recapture', () => {
  const first = normalizeResearch(
    {
      post_id: '1',
      text: 'BTC full original details',
      images: [{ url: 'https://pbs.twimg.com/media/a.jpg', file: 'images/a.jpg' }],
      review: { text: true, images: true, method: true },
    },
    'folder',
  );
  const next = normalizeResearch(
    {
      post_id: '1',
      text: 'BTC full…',
      text_truncated: true,
      images: [{ url: 'https://pbs.twimg.com/media/a.jpg' }],
    },
    'Chrome',
  );
  const merged = mergeResearch(first, next);
  expect(merged.kind).toBe('duplicate');
  expect(merged.item.text).toBe(first.text);
  expect(merged.item.review.text).toBe(true);
  expect(merged.item.media[0].file).toBe('images/a.jpg');
  expect(
    mergeResearch(first, normalizeResearch({ post_id: '1', text: 'BTC edited' }, 'Chrome')).kind,
  ).toBe('changed');
});
it('restores weekly or monthly research chart intervals and refuses invented reference intraday bars', () => {
  const recipe = validRecipe({
    asset: 'BTC',
    source: 'reference',
    view: 'ribbon',
    interval: '1M',
    indicators: ['sma:6:bar', 'sma:24:bar'],
    verified: true,
  })!;
  expect(recipeUrl(recipe)).toContain('interval=1M');
  expect(validRecipe({ ...recipe, interval: '1h' })).toBeUndefined();
  expect(validRecipe({ ...recipe, source: 'upbit', interval: '1h' })?.interval).toBe('1h');
});
