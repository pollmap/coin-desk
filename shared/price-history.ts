import type { CandleResponse, SeriesResponse } from './types';
/** Preserve the traded quote unit; do not splice or convert reference prices. */
export function closeHistory(response: CandleResponse): SeriesResponse {
  return {
    data: response.data
      .filter((p) => p.closed && Number.isFinite(p.close) && p.close > 0)
      .map((p) => ({ time: p.time, value: p.close })),
    price: [],
    meta: response.meta,
    nextCursor: response.nextCursor,
  };
}
