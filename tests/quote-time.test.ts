import { afterEach, expect, it, vi } from 'vitest';
import { getQuotes, StaleQuoteError, UnknownTradeTimestampError } from '../worker/providers';
import { actualQuoteTime, quoteTradeFresh } from '../shared/quote-freshness';
import { quoteRowView, mergeQuoteStream } from '../shared/quote-stream';
import type { Asset, Quote } from '../shared/types';

const now = 1800000000;
const ticker = (asset: Asset, age = 0) => ({
  symbol: asset + 'USDT',
  lastPrice: '100',
  priceChangePercent: '1',
  quoteVolume: '1000',
  highPrice: '110',
  lowPrice: '90',
  closeTime: now * 1000,
  lastId: asset === 'BTC' ? 11 : 12,
  age,
});
function source(rows: unknown[], aggregates: unknown[] = []) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  class Socket {
    listeners: Record<string, (e?: unknown) => void> = {};
    constructor() {
      queueMicrotask(() => this.listeners.open?.());
    }
    addEventListener(name: string, fn: (e?: unknown) => void) {
      this.listeners[name] = fn;
    }
    send(text: string) {
      const call = JSON.parse(text);
      calls.push(call);
      queueMicrotask(() =>
        this.listeners.message?.({
          data: JSON.stringify({
            id: 'btc-desk',
            status: 200,
            result: call.method === 'ticker.24hr' ? rows : aggregates,
          }),
        }),
      );
    }
    close() {
      this.listeners.close?.();
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  return calls;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('a fresh ticker window cannot rescue an old actual last trade, while a valid peer remains fresh', async () => {
  const calls = source([ticker('BTC'), ticker('DOGE')]);
  const result = await getQuotes(['BTC', 'DOGE'], 'binance', {
    QUOTE_TRADES: async () => [
      { asset: 'BTC', market: 'binance', price: 100, tradedAt: now - 300, lastTradeId: 11 },
      { asset: 'DOGE', market: 'binance', price: 100, tradedAt: now - 301, lastTradeId: 12 },
    ],
  });
  expect(calls).toHaveLength(1);
  expect(result.requestFailed).toBe(false);
  expect(result.quotes[0]).toMatchObject({
    time: now - 300,
    timestampKind: 'trade',
    actualTradeAt: now - 300,
    sourceEventTime: now,
    lastTradeId: 11,
  });
  expect(result.errors[0].error).toBeInstanceOf(StaleQuoteError);
  expect(JSON.parse(JSON.stringify(result.quotes[0]))).toEqual(result.quotes[0]);
});
it('uses one bounded aggregate-trade request when the hub is unavailable', async () => {
  const calls = source([ticker('BTC')], [{ l: 11, p: '100', T: (now - 12) * 1000 }]);
  const result = await getQuotes(['BTC'], 'binance', {
    QUOTE_TRADES: async () => {
      throw Error('offline');
    },
  });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({
    method: 'trades.aggregate',
    params: { symbol: 'BTCUSDT', endTime: now * 1000, limit: 1 },
  });
  expect(result.quotes[0].time).toBe(now - 12);
});
it.each([
  { l: 12, p: '100', T: now * 1000 },
  { l: 11, p: '101', T: now * 1000 },
  { l: 11, p: '100', T: (now + 1) * 1000 },
  { l: 11, p: '100' },
])('requires matching raw trade ID, price and a real timestamp %j', async (proof) => {
  source([ticker('BTC')], [proof]);
  const out = await getQuotes(['BTC'], 'binance');
  expect(out.quotes).toEqual([]);
  expect(out.requestFailed).toBe(false);
  expect(out.errors[0].error).toBeInstanceOf(UnknownTradeTimestampError);
});
it('legacy ticker timestamps stay readable but do not block a genuine live trade or prove freshness', () => {
  const old: Quote = {
    asset: 'BTC',
    price: 100,
    time: now,
    change24h: 1,
    volume24h: 1,
    high24h: 110,
    low24h: 90,
  };
  expect(actualQuoteTime(old, 'binance')).toBeNull();
  expect(quoteTradeFresh(old, 'binance', now)).toBe(false);
  expect(actualQuoteTime(old, 'upbit')).toBe(now);
  const stream = {
    epoch: 'a',
    sequence: 1,
    market: 'binance' as const,
    connected: true,
    quotes: [
      {
        asset: 'BTC' as const,
        market: 'binance' as const,
        price: 101,
        tradedAt: now - 1,
        receivedAt: now,
        lastTradeId: 11,
      },
    ],
  };
  const out = quoteRowView(
    { asset: 'BTC', quote: old, fetchedAt: now, status: 'delayed', spark: [] },
    stream,
    'binance',
    'live',
    now,
  );
  expect(out.displayPrice).toBe(101);
  expect(out.live).toBe(true);
  const newer = mergeQuoteStream(
    stream,
    { ...stream, sequence: 2, quotes: [{ ...stream.quotes[0], price: 102, lastTradeId: 12 }] },
    'binance',
    now,
  );
  expect(newer!.quotes[0].price).toBe(102);
});
it('bounds auxiliary proof concurrency to two and stops the entire batch after four seconds', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now * 1000);
  const ids: Asset[] = ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE'];
  let active = 0,
    maximum = 0,
    proofs = 0;
  class Socket {
    listeners: Record<string, (e?: unknown) => void> = {};
    proof = false;
    constructor() {
      queueMicrotask(() => this.listeners.open?.());
    }
    addEventListener(name: string, fn: (e?: unknown) => void) {
      this.listeners[name] = fn;
    }
    send(text: string) {
      const request = JSON.parse(text);
      if (request.method === 'ticker.24hr')
        queueMicrotask(() =>
          this.listeners.message?.({
            data: JSON.stringify({
              id: 'btc-desk',
              status: 200,
              result: ids.map((a) => ticker(a)),
            }),
          }),
        );
      else {
        this.proof = true;
        proofs++;
        active++;
        maximum = Math.max(maximum, active);
      }
    }
    close() {
      if (this.proof) {
        active--;
        this.proof = false;
      }
      this.listeners.close?.();
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const result = getQuotes(ids, 'binance');
  await vi.advanceTimersByTimeAsync(4001);
  const out = await result;
  expect(maximum).toBe(2);
  expect(proofs).toBeLessThanOrEqual(8);
  expect(active).toBe(0);
  expect(out.errors).toHaveLength(8);
  expect(out.requestFailed).toBe(false);
  expect(out.errors.every((e) => e.error instanceof UnknownTradeTimestampError)).toBe(true);
});

it('cannot overwrite a verified Binance snapshot with an older trade in the same second', () => {
  const quote = {
    asset: 'BTC',
    price: 100,
    change24h: 1,
    volume24h: 1000,
    high24h: 110,
    low24h: 90,
    time: now,
    timestampKind: 'trade',
    actualTradeAt: now,
    lastTradeId: 11,
  } satisfies Quote;
  const row = { asset: 'BTC' as Asset, status: 'ready' as const, quote, fetchedAt: now, spark: [] };
  const stream = {
    epoch: 'live',
    sequence: 1,
    market: 'binance' as const,
    connected: true,
    quotes: [
      {
        asset: 'BTC' as Asset,
        market: 'binance' as const,
        price: 90,
        tradedAt: now + 0.1,
        receivedAt: now + 0.2,
        lastTradeId: 10,
      },
    ],
  };
  expect(quoteRowView(row, stream, 'binance', 'live', now + 1).displayPrice).toBe(100);
  const current = { ...stream, quotes: [{ ...stream.quotes[0], price: 101, lastTradeId: 12 }] };
  expect(quoteRowView(row, current, 'binance', 'live', now + 1).displayPrice).toBe(101);
  const unproven = { ...stream, quotes: [{ ...stream.quotes[0], lastTradeId: undefined }] };
  expect(quoteRowView(row, unproven, 'binance', 'live', now + 1).displayPrice).toBe(100);
});
