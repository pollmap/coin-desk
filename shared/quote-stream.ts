import { ASSETS } from './catalog';
import type { Market } from './types';
import type { QuoteStream, LiveQuote } from './market-snapshot';

/** Accept only this market and monotone trade times, including across hub restarts. */
export function mergeQuoteStream(
  previous: QuoteStream | null,
  input: unknown,
  market: Market,
  now: number,
): QuoteStream | null {
  if (!input || typeof input !== 'object') return previous;
  const next = input as QuoteStream;
  if (
    next.market !== market ||
    typeof next.epoch !== 'string' ||
    !next.epoch ||
    !Number.isSafeInteger(next.sequence) ||
    next.sequence < 0 ||
    typeof next.connected !== 'boolean' ||
    !Array.isArray(next.quotes) ||
    next.quotes.length > 8
  )
    return previous;
  const old = previous?.market === market ? previous : null;
  if (old?.epoch === next.epoch && next.sequence <= old.sequence) return old;
  const quotes = new Map((old?.quotes ?? []).map((q) => [q.asset, q]));
  for (const q of next.quotes as LiveQuote[]) {
    if (
      !q ||
      q.market !== market ||
      !ASSETS.some((a) => a.id === q.asset) ||
      !Number.isFinite(q.price) ||
      q.price <= 0 ||
      !Number.isFinite(q.tradedAt) ||
      q.tradedAt <= 0 ||
      q.tradedAt > now + 60 ||
      !Number.isFinite(q.receivedAt) ||
      q.receivedAt <= 0 ||
      q.receivedAt > now + 60
    )
      continue;
    if (q.tradedAt > (quotes.get(q.asset)?.tradedAt ?? 0)) quotes.set(q.asset, q);
  }
  return {
    epoch: next.epoch,
    sequence: next.sequence,
    market,
    connected: next.connected,
    quotes: [...quotes.values()],
  };
}
