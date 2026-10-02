import { describe, expect, it } from 'vitest';
import { mergeQuoteStream } from '../shared/quote-stream';
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
