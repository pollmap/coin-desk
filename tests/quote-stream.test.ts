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
  it('orders same-millisecond Upbit fills by provider event time, without making an old trade fresh', () => {
    const original = {
      ...packet(),
      quotes: [{ ...packet().quotes[0], tradedAt: now - 400, sourceEventTime: now - 399 }],
    };
    const first = mergeQuoteStream(null, original, 'upbit', now)!;
    const correction = {
      ...original,
      sequence: 2,
      quotes: [{ ...original.quotes[0], price: 101, sourceEventTime: now - 398 }],
    };
    const next = mergeQuoteStream(first, correction, 'upbit', now)!;
    expect(next.quotes[0].price).toBe(101);
    expect(next.quotes[0].tradedAt).toBe(now - 400);
    const shown = quoteRowView(
      { asset: 'BTC', quote: null, fetchedAt: null, status: 'pending', spark: [] },
      next,
      'upbit',
      'live',
      now,
    );
    expect(shown.displayPrice).toBe(101);
    expect(shown.displayTime).toBe(now - 400);
    expect(shown.live).toBe(false);
    expect(shown.stale).toBe(true);
    for (const q of [
      { ...correction.quotes[0], price: 1, sourceEventTime: now - 399 },
      { ...correction.quotes[0], price: 1, sourceEventTime: now + 61 },
      { ...correction.quotes[0], price: 1, sourceEventTime: now - 401 },
      { ...correction.quotes[0], price: 1, sourceEventTime: NaN },
      { ...packet().quotes[0], price: 1, tradedAt: now - 401, sourceEventTime: now },
      { ...packet().quotes[0], price: 1, tradedAt: now - 400 },
    ]) {
      expect(
        mergeQuoteStream(next, { ...packet(3), quotes: [q] }, 'upbit', now)!.quotes[0],
      ).toEqual(next.quotes[0]);
    }
    const legacy = mergeQuoteStream(null, packet(), 'upbit', now)!;
    expect(
      mergeQuoteStream(
        legacy,
        { ...packet(2), quotes: [{ ...packet().quotes[0], price: 102, tradedAt: now + 1 }] },
        'upbit',
        now,
      )!.quotes[0].price,
    ).toBe(102);
  });

  it('does not replace a newer REST snapshot with an older fractional trade in the same second', () => {
    const row: MarketRow = {
      asset: 'BTC',
      status: 'ready',
      fetchedAt: now + 1,
      spark: [],
      quote: {
        asset: 'BTC',
        price: 102,
        change24h: 0,
        volume24h: 1,
        high24h: 102,
        low24h: 100,
        time: now,
        timestampKind: 'trade',
        actualTradeAt: now,
        sourceEventTime: now + 1,
      },
    };
    const stream = {
      ...packet(),
      quotes: [
        {
          ...packet().quotes[0],
          price: 101,
          tradedAt: now + 0.1,
          sourceEventTime: now + 0.2,
          receivedAt: now + 0.3,
        },
      ],
    };
    const shown = quoteRowView(row, stream, 'upbit', 'live', now + 1);
    expect(shown.displayPrice).toBe(102);
    expect(shown.displayTime).toBe(now);
    expect(shown.live).toBe(false);
    expect(shown.stale).toBe(false);
    for (const eventTime of [now + 1, now + 1.9, undefined]) {
      const uncertain = {
        ...stream,
        quotes: [{ ...stream.quotes[0], sourceEventTime: eventTime }],
      };
      expect(quoteRowView(row, uncertain, 'upbit', 'live', now + 2).displayPrice).toBe(102);
    }
    const legacy = { ...row, quote: { ...row.quote!, sourceEventTime: undefined } };
    expect(quoteRowView(legacy, stream, 'upbit', 'live', now + 1).displayPrice).toBe(102);
  });

  it('accepts an unambiguously later trade or provider correction without changing freshness rules', () => {
    const row: MarketRow = {
      asset: 'BTC',
      status: 'ready',
      fetchedAt: now + 1,
      spark: [],
      quote: {
        asset: 'BTC',
        price: 102,
        change24h: 0,
        volume24h: 1,
        high24h: 102,
        low24h: 100,
        time: now,
        timestampKind: 'trade',
        actualTradeAt: now,
        sourceEventTime: now + 1,
      },
    };
    for (const tick of [
      { ...packet().quotes[0], price: 103, tradedAt: now + 1.1, sourceEventTime: now + 1.2 },
      { ...packet().quotes[0], price: 104, tradedAt: now + 0.1, sourceEventTime: now + 2.1 },
    ]) {
      const stream = { ...packet(), quotes: [tick] };
      const shown = quoteRowView(row, stream, 'upbit', 'live', now + 3);
      expect(shown.displayPrice).toBe(tick.price);
      expect(shown.live).toBe(true);
      expect(quoteRowView(row, stream, 'upbit', 'polling', now + 3).live).toBe(false);
      expect(quoteRowView(row, stream, 'upbit', 'live', tick.tradedAt + 301).live).toBe(false);
    }
  });
});
