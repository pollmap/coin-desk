import { ASSETS } from './catalog';
import type { Market } from './types';
import type { QuoteStream, LiveQuote, MarketRow } from './market-snapshot';

/** Keep the last known trade visible without promoting an old trade to live. */
export function quoteRowView(
  row: MarketRow,
  stream: QuoteStream | null,
  market: Market,
  transport: string,
  now: number,
) {
  const tick =
    stream?.market === market
      ? stream.quotes.find((q) => q.asset === row.asset && q.market === market)
      : undefined;
  const preferred =
    row.status !== 'unsupported' &&
    !!tick &&
    Number.isFinite(tick.price) &&
    tick.price > 0 &&
    tick.tradedAt <= now + 60 &&
    tick.tradedAt >= (row.quote?.time ?? 0);
  const live =
    preferred && transport === 'live' && stream?.connected === true && now - tick.tradedAt <= 300;
  return {
    ...row,
    live,
    displayPrice: preferred ? tick.price : row.quote?.price,
    displayTime: preferred ? tick.tradedAt : row.quote?.time,
    stale: !live && (!row.quote || now - row.quote.time > 300 || now - (row.fetchedAt ?? 0) > 300),
  };
}

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
    next.quotes.length > ASSETS.length
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
