import { ASSET_REGISTRY, supportsMarket } from '../shared/asset-registry';
import { THEMES } from '../shared/knowledge';
import {
  aggregateThemeMatrix,
  calculateMarketMatrix,
  type MarketMatrixInput,
} from '../shared/market-matrix';
import { DAY } from '../shared/math';
import type { ThemeMarketResponse } from '../shared/theme-market';
import type { Asset, Candle, Market } from '../shared/types';
import { epoch, type Env } from './storage';

interface MatrixCandleRow {
  asset: Asset;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  close_time: number;
}

/** One indexed hot-table query; this endpoint never fetches or unpacks history. */
export async function themeMarket(env: Env, market: Market): Promise<ThemeMarketResponse> {
  const asOf = epoch();
  const basisDay = Math.floor(asOf / DAY) * DAY - DAY;
  const currency = market === 'upbit' ? 'KRW' : 'USDT';
  const enabled = new Set(env.ENABLED_ASSETS.split(','));
  const assets = ASSET_REGISTRY.filter(
    (asset) => enabled.has(asset.id) && supportsMarket(asset.id, market),
  ).map((asset) => asset.id);
  const grouped = new Map<Asset, Candle[]>(assets.map((asset) => [asset, []]));
  if (assets.length) {
    const days = Array.from({ length: 8 }, (_, i) => basisDay - (7 - i) * DAY);
    // JSON parameters keep this bounded below D1's parameter ceiling even for
    // 150 assets. The composite primary key selects one source and exact days.
    const result = await env.DB.prepare(
      `SELECT asset,time,open,high,low,close,volume,close_time FROM candles
       WHERE asset IN (SELECT value FROM json_each(?))
         AND market=? AND interval='1d' AND time IN (${days.map(() => '?').join(',')})
         AND close_time<=?
       ORDER BY asset,time LIMIT ?`,
    )
      .bind(JSON.stringify(assets), market, ...days, asOf, assets.length * 8 + 1)
      .all<MatrixCandleRow>();
    if (result.results.length > assets.length * 8)
      throw new Error('Daily matrix observation limit exceeded');
    for (const row of result.results) {
      const candles = grouped.get(row.asset);
      if (!candles) throw new Error('Unexpected matrix asset');
      candles.push({
        time: row.time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        closeTime: row.close_time,
        closed: row.close_time <= asOf,
      });
    }
  }
  const inputs: MarketMatrixInput[] = assets.map((asset) => ({
    asset,
    market,
    currency,
    candles: grouped.get(asset)!,
  }));
  const matrix = calculateMarketMatrix(inputs, { asOf, market, currency, basisDay });
  return { ...matrix, themes: aggregateThemeMatrix(matrix, THEMES) };
}
