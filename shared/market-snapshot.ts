import type { Asset, Market, Point, Quote } from './types';

export interface MarketRow {
  asset: Asset;
  quote: Quote | null;
  fetchedAt: number | null;
  status: 'ready' | 'delayed' | 'pending' | 'error' | 'unsupported';
  spark: Point[];
}
export interface MarketSnapshot {
  market: Market;
  currency: 'KRW' | 'USDT';
  asOf: number;
  rows: MarketRow[];
  collection?: {
    healthy: boolean;
    reason: string | null;
    scheduled_at?: number;
    completed_at?: number;
  };
}
/** Stream timestamps use Unix seconds, like the existing chart API. */
export interface LiveQuote {
  asset: Asset;
  market: Market;
  price: number;
  tradedAt: number;
  receivedAt: number;
}
export interface QuoteStream {
  epoch: string;
  sequence: number;
  market: Market;
  connected: boolean;
  quotes: LiveQuote[];
}
