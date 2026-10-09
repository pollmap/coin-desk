import { describe, expect, it } from 'vitest';
import { mergeQuoteStream, quoteRowView } from '../shared/quote-stream';
import type { MarketRow } from '../shared/market-snapshot';
const now = 1800000000;
const packet = (sequence = 1) => ({
  epoch: 'one',
  sequence,
  market: 'upbit' as const,
  connected: true,
  quotes: [
    { asset: 'BTC' as const, market: 'upbit' as const, price: 100, tradedAt: now, receivedAt: now },
  ],
});
describe('quote stream isolation', () => {
  it('keeps an older first trade visible with a delay state when there is no minute snapshot', () => {
    const row: MarketRow = {
      asset: 'BTC',
      quote: null,
      fetchedAt: null,
      status: 'pending',
      spark: [],
    };
    const stream = packet();
    stream.quotes[0].tradedAt = now - 301;
    const shown = quoteRowView(row, stream, 'upbit', 'live', now);
    expect(shown.displayPrice).toBe(100);
    expect(shown.displayTime).toBe(now - 301);
    expect(shown.live).toBe(false);
    expect(shown.stale).toBe(true);
    expect(quoteRowView(row, stream, 'binance', 'live', now).displayPrice).toBeUndefined();
  });
  it('preserves the last trade after disconnection and expires live status at the original 300 seconds', () => {
    const row: MarketRow = {
      asset: 'BTC',
      quote: null,
      fetchedAt: null,
      status: 'pending',
      spark: [],
    };
    const stream = packet();
    expect(quoteRowView(row, stream, 'upbit', 'live', now + 300).live).toBe(true);
    const expired = quoteRowView(row, stream, 'upbit', 'live', now + 301);
    expect(expired.live).toBe(false);
    expect(expired.displayPrice).toBe(100);
    const offline = quoteRowView(row, stream, 'upbit', 'polling', now + 1);
    expect(offline.live).toBe(false);
    expect(offline.displayPrice).toBe(100);
  });
  it('ignores malformed, foreign-market and duplicate sequence events', () => {
    const first = mergeQuoteStream(null, packet(), 'upbit', now)!;
    for (const value of [
      null,
      {},
      { ...packet(2), market: 'binance' },
      { ...packet(2), quotes: [null] },
      packet(),
    ]) {
      const next = mergeQuoteStream(first, value, 'upbit', now)!;
      expect(next.quotes).toEqual(first.quotes);
    }
  });
  it('preserves later trades across hub restart and isolates each asset', () => {
    const first = mergeQuoteStream(null, packet(), 'upbit', now)!;
    const next = mergeQuoteStream(
      first,
      {
        ...packet(),
        epoch: 'two',
        quotes: [{ ...packet().quotes[0], price: 1, tradedAt: now - 1 }],
      },
      'upbit',
      now,
    )!;
    expect(next.quotes[0].price).toBe(100);
    expect(next.epoch).toBe('two');
    expect(
      mergeQuoteStream(
        first,
        { ...packet(2), quotes: [{ ...packet().quotes[0], price: 200, tradedAt: now + 1 }] },
        'upbit',
        now,
      )!.quotes[0].price,
    ).toBe(200);
  });
  it('rejects nonfinite, future and invalid-symbol prices while exposing disconnection', () => {
    const next = mergeQuoteStream(
      null,
      {
        ...packet(),
        connected: false,
        quotes: [
          { ...packet().quotes[0], price: Infinity },
          { ...packet().quotes[0], asset: '1000PEPE' },
          { ...packet().quotes[0], tradedAt: now + 61 },
        ],
      },
      'upbit',
      now,
    )!;
    expect(next.quotes).toEqual([]);
    expect(next.connected).toBe(false);
  });
});
