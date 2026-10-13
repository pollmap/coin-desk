import type { Market, Quote } from './types';

/** Add truthful metadata at read time, without rewriting or deleting legacy snapshots. */
export function describeStoredQuote(quote: Quote | null, market: Market): Quote | null {
  if (quote && market === 'binance' && quote.timestampKind === undefined)
    return {
      ...quote,
      timestampKind: 'ticker-window',
      actualTradeAt: null,
      sourceEventTime: quote.time,
    };
  return quote;
}

/** Old Binance ticker-window snapshots remain readable, but cannot prove a fresh trade. */
export function actualQuoteTime(quote: Quote | null | undefined, market: Market): number | null {
  if (!quote || !Number.isSafeInteger(quote.time) || quote.time <= 0) return null;
  if (quote.timestampKind === 'ticker-window') return null;
  if (
    market === 'binance' &&
    (quote.timestampKind !== 'trade' || quote.actualTradeAt !== quote.time)
  )
    return null;
  if (quote.timestampKind === 'trade' && quote.actualTradeAt !== quote.time) return null;
  return quote.time;
}

export function quoteTradeFresh(quote: Quote | null | undefined, market: Market, now: number) {
  const time = actualQuoteTime(quote, market);
  return time !== null && time <= now + 60 && now - time <= 300;
}
