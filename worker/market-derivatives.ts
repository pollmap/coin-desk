import { DERIVATIVE_ASSETS } from '../shared/derivative-contracts';
import type {
  MarketDerivativeMetric,
  MarketDerivativeRow,
  MarketDerivatives,
} from '../shared/market-derivatives';
import type { Asset } from '../shared/types';

const metrics: MarketDerivativeMetric[] = ['funding', 'open_interest', 'long_account_ratio'];
/** Latest-point PK seeks only. Reading this summary never requests an upstream refresh. */
export async function marketDerivatives(
  db: D1Database,
  enabled: Asset[],
  now: number,
): Promise<MarketDerivatives> {
  const assets = DERIVATIVE_ASSETS.filter((asset) => enabled.includes(asset));
  const rows = await db.batch<{
    time: number;
    value: number;
    last_success: number | null;
    error: string | null;
  }>(
    assets.flatMap((asset) =>
      metrics.map((metric) =>
        db
          .prepare(
            `SELECT s.time,s.value,i.last_success,i.error FROM derivative_series s
       LEFT JOIN ingestion i ON i.key=?
       WHERE s.asset=? AND s.metric=? AND s.time<=? ORDER BY s.time DESC LIMIT 1`,
          )
          .bind('derivatives:' + asset + ':' + metric, asset, metric, now),
      ),
    ),
  );
  return {
    source: 'Bybit',
    asOf: now,
    data: assets.map((asset, index) => {
      const result: MarketDerivativeRow = {
        asset,
        funding: null,
        open_interest: null,
        long_account_ratio: null,
      };
      metrics.forEach((metric, i) => {
        const row = rows[index * metrics.length + i].results[0];
        if (row)
          result[metric] = {
            time: row.time,
            value: row.value,
            checkedAt: row.last_success,
            stale: !!row.error || now - row.time > (metric === 'funding' ? 36 : 3) * 3600,
          };
      });
      return result;
    }),
  };
}
