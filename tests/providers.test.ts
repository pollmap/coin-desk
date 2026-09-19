import { afterEach, expect, it, vi } from 'vitest';
import { binanceRequest, getRecentCandles } from '../worker/providers';
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
