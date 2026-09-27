import { expect, it } from 'vitest';
import {
  classifyText,
  mergeResearch,
  normalizeResearch,
  parseCsv,
  recipeUrl,
  validRecipe,
  recipeMetrics,
} from '../shared/research-library';
import { normalizeDesk, workspaceUrl } from '../shared/workspace';
const post = {
  post_id: '1234567',
  account: 'analyst',
  text: 'DOGE RSI and BTC',
  date_utc: '2026-09-20T00:00:00Z',
  post_url: 'https://x.com/analyst/status/1234567',
  images: [{ url: 'https://pbs.twimg.com/media/a.jpg', file: 'images/a.jpg' }],
};
it('opens supported on-chain and futures metrics without mixing coin coverage', () => {
  const recipe = validRecipe({
    asset: 'DOGE',
    view: 'price',
    source: 'upbit',
    section: 'onchain',
    metric: 'net:mvrv',
    verified: true,
  })!;
  const url = new URL(recipeUrl(recipe, post.date_utc), 'https://coin-desk.pages.dev');
  expect(url.pathname).toBe('/onchain/DOGE');
  expect(url.searchParams.get('panels')).toBe('net:mvrv');
  expect(url.searchParams.get('price_source')).toBe('upbit');
  expect(recipeMetrics('DOGE', 'onchain').some((m) => m.id.startsWith('btc:'))).toBe(false);
  const futures = validRecipe({ ...recipe, section: 'futures', metric: 'futures:funding' })!;
  expect(recipeUrl(futures)).toContain('/futures/DOGE?');
  expect(validRecipe({ ...recipe, metric: 'btc:invalid' })?.metric).not.toBe('btc:invalid');
});
it('preserves original and revisions while deduplicating origins', () => {
  const first = normalizeResearch(post, 'folder');
  expect(first.assets).toEqual(['BTC', 'DOGE']);
  expect(first.review.method).toBe(false);
  expect(mergeResearch(first, normalizeResearch(post, 'Chrome')).kind).toBe('duplicate');
  const change = mergeResearch(
    first,
    normalizeResearch({ ...post, text: 'ETH revised' }, 'Chrome'),
  );
  expect(change.kind).toBe('changed');
  expect(change.item.revisions[0].text).toBe(post.text);
  expect(change.item.origins).toEqual(['folder', 'Chrome']);
  expect(change.item.assets).toEqual(['ETH']);
  expect(change.item.review.text).toBe(false);
});
it('rejects malformed IDs, unsafe URLs and parent path media', () => {
  expect(() => normalizeResearch({ text: 'no id' }, 'x')).toThrow();
  const p = normalizeResearch(
    {
      ...post,
      post_url: 'javascript:alert(1)',
      images: [{ file: '../../secret' }, { url: 'javascript:alert(1)' }],
    },
    'x',
  );
  expect(p.url).toBe('');
  expect(p.media).toHaveLength(1);
  expect(p.media[0].url).toBeUndefined();
  expect(
    validRecipe({ asset: 'DOGE', view: 'powerlaw', source: 'reference', verified: true }),
  ).toBeUndefined();
});
it('does not classify substrings as RSI and parses quoted CSV newlines', () => {
  expect(classifyText('version')).toEqual({ assets: [], methods: [] });
  expect(parseCsv('post_id,text\r\n123,"hello,\nworld"\r\n')[0].text).toBe('hello,\nworld');
  expect(() => parseCsv('post_id,text\n123,"open')).toThrow();
});
it('links a public chart window without private ID/text/origin and upgrades workspace v1', () => {
  const link = recipeUrl(
    { asset: 'DOGE', source: 'reference', view: 'seasonality', verified: true },
    post.date_utc,
  );
  expect(link).not.toContain(post.post_id);
  expect(link).toContain('chart_to=');
  expect(new URL(link, 'https://coin-desk.pages.dev').searchParams.get('chart_to')).toBe(
    String(Date.parse('2026-09-19T00:00:00Z') / 1000),
  );
  const desk = normalizeDesk({
    version: 1,
    favorites: ['BTC'],
    cards: [],
    workspaces: [
      {
        name: 'Test',
        asset: 'DOGE',
        market: 'upbit',
        interval: '1d',
        period: 'all',
        indicators: [],
        log: true,
        cards: [],
        view: 'dashboard',
        visual: 'seasonality',
        dateWindow: { from: 1600000000, to: 1700000000 },
        annotations: [],
      },
    ],
  });
  expect(desk.version).toBe(2);
  expect(workspaceUrl(desk.workspaces[0])).toContain('chart_from=1600000000');
  expect(workspaceUrl(desk.workspaces[0])).not.toContain('annotations');
});
