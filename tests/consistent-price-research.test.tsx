import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { matchesCoin, selectedMarket } from '../shared/coin-search';
import { ASSETS } from '../shared/catalog';
import { closeHistory } from '../shared/price-history';
import { RESEARCH_AUTHORS, authorSearch } from '../shared/research';
import {
  parseResearchPosts,
  refreshResearch,
  researchEnabled,
  researchFeed,
} from '../worker/research';
import { AssetSections } from '../src/AssetSections';
import type { CandleResponse } from '../shared/types';
import type { Env } from '../worker/storage';

it.each(['BTC', 'btc', '비트코인', '비트', '비트 코인', 'ＢＴＣ', ' $BTC '])(
  'finds Bitcoin with %s',
  (query) => expect(matchesCoin('BTC', query)).toBe(true),
);
it('supports generic coin search without making DOGE match Bitcoin', () => {
  expect(ASSETS.filter((a) => matchesCoin(a.id, '코인'))).toHaveLength(8);
  expect(matchesCoin('DOGE', '비트')).toBe(false);
  expect(matchesCoin('ETH', '이더')).toBe(true);
});
it('honors a shared market unless the URL explicitly supplies a valid override', () => {
  expect(selectedMarket(null, 'upbit')).toBe('upbit');
  expect(selectedMarket('binance', 'upbit')).toBe('binance');
  expect(selectedMarket('USD', 'upbit')).toBe('upbit');
  expect(selectedMarket(null, null)).toBe('binance');
});
it('retains coin, market, selected range and price axis when navigating analyses', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/chart/DOGE?market=upbit&period=1y&log=0']}>
      <AssetSections asset="DOGE" current="chart" />
    </MemoryRouter>,
  );
  expect(html).toContain('/?asset=DOGE&amp;market=upbit&amp;period=1y&amp;log=0');
  expect(html).toContain('/onchain/DOGE?market=upbit&amp;period=1y&amp;log=0');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).not.toContain('/futures/BTC');
});
it('whole-price series keeps actual quote units and excludes unfinished or invalid closes', () => {
  const response = {
    data: [
      { time: 1, close: 123, closed: true },
      { time: 2, close: 124, closed: false },
      { time: 3, close: NaN, closed: true },
    ],
    meta: { source: 'Upbit', unit: 'KRW' },
    nextCursor: null,
  } as CandleResponse;
  const series = closeHistory(response);
  expect(series.data).toEqual([{ time: 1, value: 123 }]);
  expect(series.meta).toBe(response.meta);
  expect(series.price).toEqual([]);
});
it('keeps the 37 user-specified authors and excludes mentioned affiliations', () => {
  expect(RESEARCH_AUTHORS).toHaveLength(37);
  expect(new Set(RESEARCH_AUTHORS.map((a) => a.handle.toLowerCase())).size).toBe(37);
  expect(RESEARCH_AUTHORS.some((a) => a.handle === 'Crypto_R0D')).toBe(true);
  expect(RESEARCH_AUTHORS.some((a) => a.handle === 'signalbynoise')).toBe(false);
  const url = new URL(authorSearch('CW8900', 'DOGE'));
  expect(url.searchParams.get('q')).toBe('from:CW8900 ($DOGE OR DOGE)');
});
const now = 1800000000;
const payload = {
  includes: {
    users: [
      { id: '1', username: 'cantonmeow' },
      { id: '2', username: 'unknown' },
    ],
  },
  data: [
    {
      id: '123',
      author_id: '1',
      created_at: new Date((now - 60) * 1000).toISOString(),
      text: '$DOGE / BTC chart. Not ETHAN.',
      attachments: { media_keys: ['a'] },
    },
    {
      id: '124',
      author_id: '2',
      created_at: new Date((now - 60) * 1000).toISOString(),
      text: 'BTC',
    },
    {
      id: '125',
      author_id: '1',
      created_at: new Date((now + 600) * 1000).toISOString(),
      text: 'BTC',
    },
    {
      id: '126',
      author_id: '1',
      created_at: new Date((now - 60) * 1000).toISOString(),
      text: 'BTC',
      withheld: { copyright: true },
    },
  ],
};
it('accepts only supplied authors and real post URLs without persisting opinion text', () => {
  const posts = parseResearchPosts(payload, now);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toEqual({
    id: '123',
    handle: 'cantonmeow',
    publishedAt: now - 60,
    url: 'https://x.com/cantonmeow/status/123',
    assets: ['BTC', 'DOGE'],
    media: true,
  });
  expect(posts[0]).not.toHaveProperty('text');
  expect(() => parseResearchPosts({ errors: [{ detail: 'secret' }] }, now)).toThrow(
    'INVALID_X_RESPONSE',
  );
  expect(parseResearchPosts({ meta: { result_count: 0 } }, now)).toEqual([]);
});
it('requires explicit activation, a credential and a bounded daily request limit', () => {
  expect(researchEnabled({ X_BEARER_TOKEN: 'test' })).toBe(false);
  expect(
    researchEnabled({
      X_BEARER_TOKEN: 'test',
      X_COLLECTION_ENABLED: '1',
      X_MAX_REQUESTS_PER_DAY: '25',
    }),
  ).toBe(false);
  expect(
    researchEnabled({
      X_BEARER_TOKEN: 'test',
      X_COLLECTION_ENABLED: '1',
      X_MAX_REQUESTS_PER_DAY: '4',
    }),
  ).toBe(true);
});
it('never calls X or the database when collection has not been connected', async () => {
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  try {
    await refreshResearch({} as Env);
    expect(await researchFeed({} as Env)).toMatchObject({ state: 'disabled', posts: [] });
    expect(upstream).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
