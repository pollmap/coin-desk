import type { MarketMatrixResponse, ThemeMatrixResponse } from './market-matrix';

/** Confirmed daily analysis, separate from the current-price stream. */
export interface ThemeMarketResponse extends MarketMatrixResponse {
  themes: ThemeMatrixResponse;
}
