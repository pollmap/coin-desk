import type { Asset } from './types';
export const DERIVATIVE_ASSETS = [
  'BTC',
  'DOGE',
  'ETH',
  'SOL',
  'XRP',
  'LINK',
  'ONDO',
  'PEPE',
] as const;
export type DerivativeAsset = (typeof DERIVATIVE_ASSETS)[number];
export function derivativeContract(asset: Asset) {
  return {
    symbol: asset === 'PEPE' ? '1000PEPEUSDT' : asset + 'USDT',
    quantityMultiplier: asset === 'PEPE' ? 1000 : 1,
  };
}
