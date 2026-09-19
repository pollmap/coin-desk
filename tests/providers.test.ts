import { afterEach, expect, it, vi } from 'vitest';
import { binanceRequest, getRecentCandles, getQuotes } from '../worker/providers';
function socket(response?: unknown, event = 'message') {
  const calls: Record<string, unknown>[] = [];
  const closed = vi.fn();
  class Socket {
    listeners: Record<string, (event?: unknown) => void> = {};
    constructor() {
      queueMicrotask(() => this.listeners.open?.());
    }
    addEventListener(name: string, listener: (event?: unknown) => void) {
      this.listeners[name] = listener;
    }
    send(text: string) {
      calls.push(JSON.parse(text));
      if (response !== undefined)
        queueMicrotask(() => this.listeners[event]?.({ data: JSON.stringify(response) }));
    }
    close() {
      closed();
      this.listeners.close?.();
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  return { calls, closed };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('public candle request maps original OHLCV and closes socket', async () => {
  const mock = socket({
    id: 'btc-desk',
    status: 200,
    result: [[1704067200000, '10', '20', '5', '15', '30']],
  });
  const data = await getRecentCandles('BTC', 'binance', '1h');
  expect(data[0]).toEqual({
    time: 1704067200,
    open: 10,
    high: 20,
    low: 5,
    close: 15,
    volume: 30,
    closeTime: 1704070800,
    closed: true,
  });
  expect(mock.calls[0]).toMatchObject({
    method: 'klines',
    params: { symbol: 'BTCUSDT', interval: '1h' },
  });
  expect(mock.closed).toHaveBeenCalledTimes(1);
});
it('a silent source times out and releases its connection', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const mock = socket();
  const result = expect(binanceRequest('ticker.24hr', { symbol: 'BTCUSDT' })).rejects.toThrow(
    'timeout',
  );
  await vi.advanceTimersByTimeAsync(12001);
  await result;
  expect(mock.closed).toHaveBeenCalledTimes(1);
});
it('an upstream rate limit is an error, never a fabricated result', async () => {
  socket({ id: 'btc-desk', status: 429, error: { msg: 'rate limit' } });
  await expect(binanceRequest('klines', { symbol: 'BTCUSDT' })).rejects.toThrow('429');
});
it('one Binance batch request maps symbols exactly and isolates an outdated peer', async () => {
  const ticker = (symbol: string, age = 0) => ({
    symbol,
    lastPrice: '100',
    priceChangePercent: '1',
    quoteVolume: '1000',
    highPrice: '110',
    lowPrice: '90',
    closeTime: Date.now() - age * 1000,
  });
  const mock = socket({
    id: 'btc-desk',
    status: 200,
    result: [ticker('DOGEUSDT', 400), ticker('BTCUSDT')],
  });
  const result = await getQuotes(['BTC', 'DOGE'], 'binance');
  expect(mock.calls).toHaveLength(1);
  expect(mock.calls[0]).toMatchObject({
    method: 'ticker.24hr',
    params: { symbols: ['BTCUSDT', 'DOGEUSDT'] },
  });
  expect(result.quotes.map((q) => q.asset)).toEqual(['BTC']);
  expect(result.errors.map((q) => q.asset)).toEqual(['DOGE']);
  expect(mock.closed).toHaveBeenCalledTimes(1);
});
it('Upbit uses one batched ticker request and preserves a valid peer when one ticker is absent', async () => {
  const timestamp = Date.now();
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.includes('/ticker?')
        ? [
            {
              market: 'KRW-BTC',
              trade_price: 100,
              timestamp,
              trade_timestamp: timestamp,
              acc_trade_price_24h: 1000,
              high_price: 110,
              low_price: 90,
            },
          ]
        : [
            {
              trade_price: 80,
              candle_date_time_utc: new Date(
                Math.floor((timestamp / 1000 - 86400) / 60) * 60000 - 60000,
              )
                .toISOString()
                .slice(0, 19),
            },
          ],
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await getQuotes(['BTC', 'DOGE'], 'upbit');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[0][0])).toContain('markets=KRW-BTC,KRW-DOGE');
  expect(result.quotes[0]).toMatchObject({ asset: 'BTC', change24h: 25 });
  expect(result.errors[0].asset).toBe('DOGE');
});
