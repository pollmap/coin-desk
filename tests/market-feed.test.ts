import { afterEach, expect, it, vi } from 'vitest';
import feed, { validSpotRequest } from '../worker/market-feed';
import { getQuotes } from '../worker/providers';

afterEach(() => vi.unstubAllGlobals());
it('limits spot requests to known symbols, public methods and bounded candles', () => {
  expect(validSpotRequest('ticker.24hr', { symbols: ['BTCUSDT', 'DOGEUSDT'] })).toBe(true);
  expect(validSpotRequest('ticker.24hr', { symbol: 'BTCUSDT', symbols: ['ETHUSDT'] })).toBe(false);
  expect(validSpotRequest('ticker.24hr', { symbols: ['BTCUSDT', 'BTCUSDT'] })).toBe(false);
  expect(validSpotRequest('order.place', { symbol: 'BTCUSDT' })).toBe(false);
  expect(validSpotRequest('klines', { symbol: 'DOGEUSDT', interval: '1d', limit: 32 })).toBe(true);
  expect(validSpotRequest('klines', { symbol: 'DOGEUSDT', interval: '1m', limit: 32 })).toBe(false);
  expect(validSpotRequest('klines', { symbol: 'UNKNOWN', interval: '1d', limit: 8 })).toBe(false);
  expect(validSpotRequest('klines', { symbol: 'BTCUSDT', interval: '1d', limit: 1000 })).toBe(
    false,
  );
});
it('authenticates the regional adapter and validates every returned quote again', async () => {
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
    Response.json([
      {
        symbol: 'DOGEUSDT',
        lastPrice: '0.1',
        highPrice: '0.12',
        lowPrice: '0.09',
        priceChangePercent: '1',
        quoteVolume: '1000',
        closeTime: Date.now(),
      },
      {
        symbol: 'BTCUSDT',
        lastPrice: '0',
        highPrice: '120',
        lowPrice: '90',
        priceChangePercent: '1',
        quoteVolume: '1000',
        closeTime: Date.now(),
      },
    ]),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await getQuotes(['BTC', 'DOGE'], 'binance', {
    FEED_URL: 'https://feed.test',
    FEED_TOKEN: 'unit-token',
  });
  expect(result.quotes.map((quote) => quote.asset)).toEqual(['DOGE']);
  expect(result.errors.map((error) => error.asset)).toEqual(['BTC']);
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe('/binance');
  expect(fetcher.mock.calls[0][1].headers).toEqual({ 'X-Feed-Token': 'unit-token' });
});
it('does not expose fixed-source routes without the shared token or accept arbitrary upstream URLs', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const path of [
    '/binance?method=ticker.24hr&params=%7B%22symbol%22%3A%22BTCUSDT%22%7D',
    '/mempool',
  ]) {
    expect(
      (await feed.fetch(new Request('https://feed.test' + path), { FEED_TOKEN: 'unit-token' }))
        .status,
    ).toBe(401);
  }
  expect(
    (
      await feed.fetch(
        new Request('https://feed.test/mempool?url=https://other.test', {
          headers: { 'X-Feed-Token': 'unit-token' },
        }),
        { FEED_TOKEN: 'unit-token' },
      )
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it('only forwards registered contracts and bounded history pages', async () => {
  const fetcher = vi.fn(async (_url: string) =>
    Response.json({ retCode: 0, result: { list: [] } }),
  );
  vi.stubGlobal('fetch', fetcher);
  const headers = { 'X-Feed-Token': 'test-secret' };
  const denied = await feed.fetch(
    new Request('https://feed.internal/derivatives?asset=DOGE&metric=open_interest&limit=200'),
    { FEED_TOKEN: 'test-secret' },
  );
  expect(denied.status).toBe(401);
  const invalid = await feed.fetch(
    new Request('https://feed.internal/derivatives?asset=ADA&metric=funding&limit=200', {
      headers,
    }),
    { FEED_TOKEN: 'test-secret' },
  );
  expect(invalid.status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const valid = await feed.fetch(
    new Request('https://feed.internal/derivatives?asset=DOGE&metric=open_interest&limit=200', {
      headers,
    }),
    { FEED_TOKEN: 'test-secret' },
  );
  expect(valid.status).toBe(200);
  const forwarded = new URL(String(fetcher.mock.calls[0]?.[0]));
  expect(forwarded.hostname).toBe('api.bybit.com');
  expect(forwarded.pathname).toBe('/v5/market/open-interest');
  expect(forwarded.searchParams.get('symbol')).toBe('DOGEUSDT');
  expect(forwarded.searchParams.get('intervalTime')).toBe('1h');
  const ratio = await feed.fetch(
    new Request('https://feed.internal/derivatives?asset=BTC&metric=long_account_ratio&limit=200', {
      headers,
    }),
    { FEED_TOKEN: 'test-secret' },
  );
  expect(ratio.status).toBe(200);
  const ratioUrl = new URL(String(fetcher.mock.calls[1]?.[0]));
  expect(ratioUrl.pathname).toBe('/v5/market/account-ratio');
  expect(ratioUrl.searchParams.get('period')).toBe('1h');
});
