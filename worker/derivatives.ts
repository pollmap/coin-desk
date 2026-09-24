import type { Asset, Point, SeriesResponse } from '../shared/types';
import { DAY } from '../shared/math';
import { upstream } from './providers';
import { epoch, readState, successStatement, type Env } from './storage';

export const DERIVATIVE_ASSETS = ['BTC', 'DOGE', 'ETH'] as const;
export const DERIVATIVE_METRICS = ['funding', 'open_interest', 'long_account_ratio'] as const;
export type DerivativeAsset = (typeof DERIVATIVE_ASSETS)[number];
export type DerivativeMetric = (typeof DERIVATIVE_METRICS)[number];
export const DERIVATIVE_VERSION = 'bybit-usdt-perpetual-v3';
const origin = 'https://api.bybit.com';
const fundingFloor = Date.parse('2019-01-01T00:00:00Z');
const key = (asset: Asset, metric: string) => `derivatives:${asset}:${metric}`;
export const derivativeAsset = (asset: Asset): asset is DerivativeAsset =>
  DERIVATIVE_ASSETS.some((item) => item === asset);
export const derivativeMetric = (metric: string): metric is DerivativeMetric =>
  DERIVATIVE_METRICS.some((item) => item === metric);

/** Bybit V5 returns newest first. Reject mixed symbols and invalid observations. */
export function parseDerivativeRows(
  input: unknown,
  asset: DerivativeAsset,
  metric: DerivativeMetric,
  now = epoch(),
): Point[] {
  const response = input as Record<string, unknown> | null;
  const result = response?.result as Record<string, unknown> | null;
  const rows = result?.list;
  if (
    !response || response.retCode !== 0 || !result ||
    (metric !== 'long_account_ratio' && result.category !== 'linear') ||
    !Array.isArray(rows) || rows.length > 200 ||
    (metric === 'open_interest' && result.symbol !== asset + 'USDT')
  ) throw new Error('Invalid derivatives response');
  const points: Point[] = [];
  let previous = Infinity;
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object') throw new Error('Invalid derivatives row');
    const row = candidate as Record<string, unknown>;
    if (metric !== 'open_interest' && row.symbol !== asset + 'USDT')
      throw new Error('Derivatives symbol mismatch');
    const timestamp = metric === 'funding' ? row.fundingRateTimestamp : row.timestamp;
    const observed = metric === 'funding' ? row.fundingRate : metric === 'open_interest' ? row.openInterest : row.buyRatio;
    if (typeof timestamp !== 'string' || typeof observed !== 'string' || !observed.trim())
      throw new Error('Invalid derivatives observation');
    const milliseconds = Number(timestamp);
    const value = Number(observed);
    if (
      !Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds >= previous ||
      milliseconds > (now + 60) * 1000 || !Number.isFinite(value) ||
      (metric === 'open_interest' && value < 0) || (metric === 'funding' && Math.abs(value) > 1) ||
      (metric === 'long_account_ratio' && (value < 0 || value > 1 ||
        typeof row.sellRatio !== 'string' || !Number.isFinite(Number(row.sellRatio)) ||
        Math.abs(value + Number(row.sellRatio) - 1) > 0.02))
    ) throw new Error('Invalid derivatives observation');
    previous = milliseconds;
    points.push({ time: Math.floor(milliseconds / 1000), value: metric === 'open_interest' ? value : Math.round(value * 100 * 1e8) / 1e8 });
  }
  return points.reverse();
}

/** One bounded reverse-history page per Cron run; recent observations refresh during backfill. */
export async function updateDerivatives(env: Env, asset: DerivativeAsset, metric: DerivativeMetric) {
  const now = epoch();
  const id = key(asset, metric);
  const coverage = await env.DB.prepare(
    'SELECT MIN(time) AS first,MAX(time) AS last FROM derivative_series WHERE asset=? AND metric=?',
  ).bind(asset, metric).first<{ first: number | null; last: number | null }>();
  const cursor = await readState<number | null>(env.DB, 'cursor:' + id, null);
  const refreshRecent = !!coverage?.last && now - coverage.last > (metric === 'funding' ? 12 * 3600 : 2 * 3600);
  const backfill = cursor !== null && !refreshRecent;
  const firstPage = !coverage?.last;
  const size = backfill || firstPage ? 200 : metric === 'funding' ? 20 : 30;
  const params = new URLSearchParams({ category: 'linear', symbol: asset + 'USDT', limit: String(size) });
  if (metric === 'open_interest') params.set('intervalTime', '1h');
  if (metric === 'long_account_ratio') params.set('period', '1h');
  if (backfill) params.set('endTime', String(cursor));
  const path = metric === 'funding' ? '/v5/market/funding/history' : metric === 'open_interest' ? '/v5/market/open-interest' : '/v5/market/account-ratio';
  // Cron egress is rejected by Bybit on this host. A Seoul-placed fetch Worker
  // performs the allowlisted request; its endpoint requires a shared secret.
  const raw = env.FEED_URL && env.FEED_TOKEN
    ? await (async () => {
        const response = await fetch(env.FEED_URL + '/derivatives?' +
          new URLSearchParams({ asset, metric, limit: String(size), ...(backfill ? { endTime: String(cursor) } : {}) }),
          { signal: AbortSignal.timeout(12000), headers: { 'X-Feed-Token': env.FEED_TOKEN! } });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(detail.error || 'Feed HTTP ' + response.status);
        }
        return response.json();
      })()
    : await upstream(origin + path + '?' + params);
  const parsed = parseDerivativeRows(raw, asset, metric, now);
  if (!parsed.length && !coverage?.last) throw new Error('No derivatives history available');
  const floor = metric === 'funding' ? fundingFloor : (now - 30 * DAY) * 1000;
  const points = parsed.filter((point) => point.time * 1000 >= floor);
  const fetched = epoch();
  const statements: D1PreparedStatement[] = points.map((point) =>
    env.DB.prepare(
      'INSERT INTO derivative_series(asset,metric,time,value,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(asset,metric,time) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at WHERE derivative_series.value<>excluded.value',
    ).bind(asset, metric, point.time, point.value, fetched),
  );
  const last = Math.max(coverage?.last ?? 0, points.at(-1)?.time ?? 0);
  const more = (backfill || firstPage) && parsed.length === size && parsed[0].time * 1000 > floor;
  if (more) statements.push(
    env.DB.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind('cursor:' + id, JSON.stringify(parsed[0].time * 1000 - 1)),
  );
  else if (!refreshRecent) statements.push(env.DB.prepare('DELETE FROM state WHERE key=?').bind('cursor:' + id));
  statements.push(successStatement(env.DB, id, last, fetched));
  if (more || (refreshRecent && cursor !== null)) statements.push(
    env.DB.prepare('UPDATE ingestion SET next_attempt=? WHERE key=?').bind(fetched + 60, id),
  );
  const rawId = backfill || firstPage ? `${id}:history:${parsed[0]?.time ?? now}` : `${id}:latest`;
  statements.push(env.DB.prepare(
    'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
  ).bind(rawId, 'Bybit V5 public market data', fetched, JSON.stringify(raw)));
  for (let i = 0; i < statements.length; i += 40) await env.DB.batch(statements.slice(i, i + 40));
}

export async function readDerivativeSeries(
  db: D1Database, asset: DerivativeAsset, metric: DerivativeMetric,
  from: number, to: number, limit: number,
): Promise<SeriesResponse> {
  const [rows, extent, state] = await Promise.all([
    db.prepare('SELECT time,value FROM derivative_series WHERE asset=? AND metric=? AND time>=? AND time<? ORDER BY time LIMIT ?')
      .bind(asset, metric, from, to, limit + 1).all<Point>(),
    db.prepare('SELECT MIN(time) AS first,MAX(time) AS last FROM derivative_series WHERE asset=? AND metric=?')
      .bind(asset, metric).first<{ first: number | null; last: number | null }>(),
    db.prepare('SELECT last_success,error FROM ingestion WHERE key=?')
      .bind(key(asset, metric)).first<{ last_success: number | null; error: string | null }>(),
  ]);
  const data = rows.results.slice(0, limit);
  const age = metric === 'funding' ? 36 * 3600 : 3 * 3600;
  return {
    data, price: [], range: { from, to },
    nextCursor: rows.results.length > limit ? data.at(-1)!.time + 1 : null,
    meta: {
      source: 'Bybit V5 public market data',
      unit: metric === 'open_interest' ? asset : '%',
      market: asset + 'USDT linear perpetual · Bybit only',
      dataAsOf: extent?.last ?? null,
      fetchedAt: state?.last_success ?? null,
      historyStart: extent?.first ?? null,
      stale: !extent?.last || epoch() - extent.last > age || !!state?.error,
      calculationVersion: DERIVATIVE_VERSION,
      warning: !extent?.last && state?.error
        ? 'Bybit 원천 연결에 실패했습니다. 실제 관측을 아직 확보하지 못했으며 추정값을 표시하지 않습니다.'
        : state?.error
          ? '선물 원천 갱신이 지연되어 마지막 정상 관측을 표시합니다.'
          : metric === 'long_account_ratio'
            ? 'Bybit의 롱 포지션 보유 계정 수 / 전체 포지션 보유 계정 수입니다. 포지션 규모나 전체 시장의 롱 비중이 아닙니다. 최근 30일을 먼저 확보합니다.'
          : metric === 'open_interest'
            ? '미결제약정은 Bybit 한 거래소의 계약 양방향 합계이며 단위는 해당 코인 수량입니다. 최근 30일을 먼저 확보하고 이후 서버에 축적합니다.'
            : '펀딩비는 Bybit 한 거래소의 실제 정산 비율입니다. 과거 이력은 서버가 작은 페이지로 추가하고 있습니다.',
    },
  };
}
