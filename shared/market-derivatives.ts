import type { Asset, Point } from './types';
export type MarketDerivativeMetric = 'funding' | 'open_interest' | 'long_account_ratio';
export interface MarketDerivativeValue extends Point {
  stale: boolean;
  checkedAt: number | null;
}
export interface MarketDerivativeRow {
  asset: Asset;
  funding: MarketDerivativeValue | null;
  open_interest: MarketDerivativeValue | null;
  long_account_ratio: MarketDerivativeValue | null;
}
export interface MarketDerivatives {
  source: 'Bybit';
  asOf: number;
  data: MarketDerivativeRow[];
}
