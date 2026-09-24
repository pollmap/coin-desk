import { afterEach, expect, it, vi } from 'vitest';
import feed from '../worker/market-feed';

afterEach(() => vi.unstubAllGlobals());

it('only forwards registered contracts and bounded history pages', async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json({ retCode: 0, result: { list: [] } }));
  vi.stubGlobal('fetch', fetcher);
  const headers = { 'X-Feed-Token': 'test-secret' };
  const denied = await feed.fetch(new Request('https://feed.internal/derivatives?asset=DOGE&metric=open_interest&limit=200'), { FEED_TOKEN: 'test-secret' });
  expect(denied.status).toBe(401);
  const invalid = await feed.fetch(new Request('https://feed.internal/derivatives?asset=SOL&metric=funding&limit=200', { headers }), { FEED_TOKEN: 'test-secret' });
  expect(invalid.status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const valid = await feed.fetch(new Request('https://feed.internal/derivatives?asset=DOGE&metric=open_interest&limit=200', { headers }), { FEED_TOKEN: 'test-secret' });
  expect(valid.status).toBe(200);
  const forwarded = new URL(String(fetcher.mock.calls[0]?.[0]));
  expect(forwarded.hostname).toBe('api.bybit.com');
  expect(forwarded.pathname).toBe('/v5/market/open-interest');
  expect(forwarded.searchParams.get('symbol')).toBe('DOGEUSDT');
  expect(forwarded.searchParams.get('intervalTime')).toBe('1h');
  const ratio = await feed.fetch(new Request('https://feed.internal/derivatives?asset=BTC&metric=long_account_ratio&limit=200', { headers }), { FEED_TOKEN: 'test-secret' });
  expect(ratio.status).toBe(200);
  const ratioUrl = new URL(String(fetcher.mock.calls[1]?.[0]));
  expect(ratioUrl.pathname).toBe('/v5/market/account-ratio');
  expect(ratioUrl.searchParams.get('period')).toBe('1h');
});
