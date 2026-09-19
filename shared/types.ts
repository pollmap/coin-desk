export type Asset = 'BTC' | 'ETH' | 'DOGE' | 'SOL' | 'XRP' | 'LINK' | 'ONDO' | 'PEPE';
export type Market = 'binance' | 'upbit';
export type Interval = '1h' | '4h' | '1d' | '1w' | '1M';
export type Period = '1m' | '3m' | '1y' | '3y' | 'all';
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  closed: boolean;
}
export interface Point {
  time: number;
  value: number;
}
export interface Provenance {
  source: string;
  unit: string;
  market: string;
  dataAsOf: number | null;
  fetchedAt: number | null;
  stale: boolean;
  calculationVersion: string;
  priceBasis?: string;
  historyStart?: number | null;
  warning?: string;
  gapCount?: number;
  sourceVersions?: Record<string, number>;
  calculationStart?: number | null;
}
export interface SeriesResponse {
  data: Point[];
  price: Point[];
  meta: Provenance;
  nextCursor: number | null;
}
export interface CandleResponse {
  data: Candle[];
  meta: Provenance;
  nextCursor: number | null;
}
export interface Quote {
  asset: Asset;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  time: number;
  changeBasis?: 'rolling24h' | 'rolling24h-minute';
  referenceAt?: number;
}
export interface Overview {
  quote: Quote | null;
  meta: Provenance;
  metrics: Record<string, number | null>;
  metricsAsOf: number | null;
  technical: { rsi: number | null; sma200: number | null };
  assets: Asset[];
}
export interface Metric {
  id: string;
  title: string;
  english: string;
  unit: string;
  color: string;
  description: string;
  formula: string;
  reference?: number;
  source: string;
}
export interface Drawing {
  id: string;
  kind: 'horizontal' | 'trend';
  points: Point[];
}
export interface Dominance {
  coins: {
    id: string;
    label: string;
    value: number;
    marketCap: number | null;
    asOf: number;
    source?: string;
    timeBasis?: string;
  }[];
  totalMarketCap: number;
  asOf: number;
  fetchedAt: number;
  stale: boolean;
  warning?: string;
  source: string;
  calculationVersion: string;
}
