import type { Asset, Market } from './types';

export interface LiveChartPrice {
  asset: Asset;
  market: Market;
  price: number;
  time: number;
  stale: boolean;
}

/** A separate reference line, never a fabricated OHLC or historical observation. */
export function eligibleChartPrice(
  quote: LiveChartPrice | null | undefined,
  asset: string,
  unit: string,
  now = Date.now() / 1000,
): quote is LiveChartPrice {
  return (
    !!quote &&
    quote.asset === asset &&
    !quote.stale &&
    (quote.market === 'upbit' ? unit === 'KRW' : unit === 'USDT') &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    Number.isFinite(quote.time) &&
    quote.time >= now - 300 &&
    quote.time <= now + 60
  );
}
