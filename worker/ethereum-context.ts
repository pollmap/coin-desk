import type { Point, SeriesResponse } from '../shared/types';
import { claimRefresh, epoch, failure, success, type Env } from './storage';
import { DAY } from '../shared/math';
export const ETH_CONTEXT = {
  tvl: { title: 'Ethereum DeFi TVL', url: 'https://api.llama.fi/v2/historicalChainTvl/Ethereum' },
  stablecoins: {
    title: 'Ethereum 스테이블코인 공급',
    url: 'https://stablecoins.llama.fi/stablecoincharts/Ethereum',
  },
} as const;
export function parseEthereumContext(
  input: unknown,
  metric: keyof typeof ETH_CONTEXT,
  now = epoch(),
): Point[] {
  if (!Array.isArray(input) || input.length > 15000) throw new Error('Invalid Ethereum history');
  const seen = new Set<number>();
  return input
    .map((row) => {
      const time = Number(row.date);
      const supply = row.totalCirculatingUSD;
      const components =
        supply && typeof supply === 'object' && !Array.isArray(supply) ? Object.values(supply) : [];
      const value =
        metric === 'tvl'
          ? row.tvl
          : components.length &&
              components.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
            ? (components as number[]).reduce((sum, v) => sum + v, 0)
            : NaN;
      if (
        !Number.isSafeInteger(time) ||
        time < 0 ||
        time % DAY !== 0 ||
        seen.has(time) ||
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0
      )
        throw new Error('Invalid Ethereum observation');
      seen.add(time);
      return { time, value };
    })
    .filter((p) => p.time + DAY <= now)
    .sort((a, b) => a.time - b.time);
}
export async function refreshEthereumContext(env: Env) {
  if (!(await claimRefresh(env.DB, 'ethereum-context', 3600))) return;
  for (const metric of ['tvl', 'stablecoins'] as const) {
    const key = 'chain:ETH:' + metric;
    try {
      const response = await fetch(ETH_CONTEXT[metric].url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('DefiLlama HTTP ' + response.status);
      const rows = parseEthereumContext(await response.json(), metric);
      if (!rows.length) throw new Error('Empty Ethereum history');
      const buckets = new Map<number, Point[]>();
      for (const p of rows) {
        const d = new Date(p.time * 1000),
          bucket = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
        buckets.set(bucket, [...(buckets.get(bucket) ?? []), p]);
      }
      // One bounded statement per dataset, not a query per monthly bucket.
      await env.DB.prepare(
        "INSERT INTO chain_history(asset,metric,bucket,payload,fetched_at) SELECT 'ETH',?,CAST(json_extract(value,'$.bucket') AS INTEGER),json_extract(value,'$.payload'),? FROM json_each(?) WHERE 1 ON CONFLICT(asset,metric,bucket) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at WHERE chain_history.payload!=excluded.payload",
      )
        .bind(
          metric,
          epoch(),
          JSON.stringify(
            [...buckets].map(([bucket, points]) => ({ bucket, payload: JSON.stringify(points) })),
          ),
        )
        .run();
      await success(env.DB, key, rows.at(-1)!.time);
    } catch (e) {
      await failure(env.DB, key, e);
    }
  }
}
export async function ethereumContext(
  env: Env,
  metric: keyof typeof ETH_CONTEXT,
): Promise<SeriesResponse> {
  const rows = (
    await env.DB.prepare(
      "SELECT payload,fetched_at FROM chain_history WHERE asset='ETH' AND metric=? ORDER BY bucket",
    )
      .bind(metric)
      .all<{ payload: string; fetched_at: number }>()
  ).results;
  const data = rows.flatMap((r) => JSON.parse(r.payload) as Point[]);
  const state = await env.DB.prepare('SELECT last_success,error FROM ingestion WHERE key=?')
    .bind('chain:ETH:' + metric)
    .first<{ last_success: number; error: string | null }>();
  return {
    data,
    price: [],
    nextCursor: null,
    meta: {
      source: 'DefiLlama · Ethereum',
      unit: 'USD',
      market: 'Ethereum chain',
      dataAsOf: data.at(-1)?.time ?? null,
      fetchedAt: state?.last_success ?? null,
      stale: !data.length || epoch() - data.at(-1)!.time > 3 * DAY || !!state?.error,
      calculationVersion: 'defillama-ethereum-v1',
      historyStart: data[0]?.time,
      warning: state?.error ? '원천 갱신 지연 · 마지막 정상 자료' : undefined,
    },
  };
}
