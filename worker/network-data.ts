import type { Asset, Point, SeriesResponse } from '../shared/types';
import { DAY } from '../shared/math';
import {
  isNetworkAsset,
  networkMetric,
  networkMetrics,
  networkUnit,
  NETWORK_HISTORY,
  NETWORK_SOURCE,
  NETWORK_VERSION,
  type NetworkAsset,
} from '../shared/network-catalog';
import { upstream } from './providers';
import { epoch, readState, successStatement, type Env } from './storage';

export interface NetworkDay {
  time: number;
  values: Record<string, number>;
  statuses?: Record<string, string>;
}
interface Month {
  bucket: number;
  payload: string;
  fetched_at: number;
}
interface Coverage {
  metric: string;
  first: number;
  last: number;
  observations: number;
  fetched_at: number;
}
export const networkMonth = (time: number) => {
  const date = new Date(time * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
};
const nextMonth = (time: number) => {
  const date = new Date(time * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
};
const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0 && value % DAY === 0;
export const networkSourceMetrics = (asset: NetworkAsset) => [
  'PriceUSD',
  ...networkMetrics(asset).flatMap((metric) => (metric.sourceMetric ? [metric.sourceMetric] : [])),
];

/** Subtract exchange flow decimals before binary float conversion to avoid cancellation. */
export function decimalDifference(left: string | number, right: string | number): number {
  const parse = (value: string | number) => {
    const text = String(value);
    const parts = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!parts) throw new Error('Invalid exchange decimal');
    const exponent = Number(parts[3] || 0);
    const shift = exponent - (parts[2]?.length || 0);
    if (!Number.isSafeInteger(shift) || Math.abs(shift) > 40)
      throw new Error('Unsupported exchange decimal scale');
    return { digits: BigInt(parts[1] + (parts[2] || '')), shift };
  };
  const a = parse(left),
    b = parse(right);
  const scale = Math.max(0, -a.shift, -b.shift);
  const value =
    Number(a.digits * 10n ** BigInt(a.shift + scale) - b.digits * 10n ** BigInt(b.shift + scale)) /
    10 ** scale;
  if (!Number.isFinite(value)) throw new Error('Invalid exchange netflow');
  return value;
}

/** Null means unavailable; zero is a valid count/fee. Derived results never combine providers. */
export function parseNetwork(
  input: unknown,
  asset: NetworkAsset,
  closedBefore = epoch(),
): NetworkDay[] {
  const body = input as { data?: unknown };
  if (!body || !Array.isArray(body.data) || body.data.length > 10000)
    throw new Error('Invalid Coin Metrics network response');
  const fields = [
    ['price', 'PriceUSD'],
    ...networkMetrics(asset).flatMap((metric) =>
      metric.sourceMetric ? [[metric.id, metric.sourceMetric]] : [],
    ),
  ];
  const seen = new Set<number>();
  const rows: NetworkDay[] = [];
  for (const candidate of body.data) {
    const raw = candidate as Record<string, unknown>;
    if (!raw || raw.asset !== asset.toLowerCase() || typeof raw.time !== 'string')
      throw new Error('Network response asset/time mismatch');
    const time = Date.parse(raw.time) / 1000;
    if (!validTime(time) || seen.has(time)) throw new Error('Invalid or duplicate UTC network day');
    seen.add(time);
    const values: Record<string, number> = {};
    const statuses: Record<string, string> = {};
    for (const [id, field] of fields) {
      if (!(field in raw)) throw new Error('Missing network response field: ' + field);
      const value = raw[field];
      if (value === null) continue;
      if (
        !['string', 'number'].includes(typeof value) ||
        (typeof value === 'string' && !value.trim())
      )
        throw new Error('Invalid network value: ' + field);
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0 || (id === 'price' && numeric === 0))
        throw new Error('Invalid network value: ' + field);
      values[id] = numeric;
      if (typeof raw[field + '-status'] === 'string') statuses[id] = String(raw[field + '-status']);
    }
    if (values.exchange_inflow !== undefined && values.exchange_outflow !== undefined)
      values.exchange_netflow = decimalDifference(
        raw.FlowInExNtv as string | number,
        raw.FlowOutExNtv as string | number,
      );
    if (values.mvrv > 0) {
      if (values.market_cap !== undefined) values.realized_cap = values.market_cap / values.mvrv;
      if (values.price !== undefined) values.realized_price = values.price / values.mvrv;
      values.nupl = 1 - 1 / values.mvrv;
    }
    if (!Object.values(values).every(Number.isFinite))
      throw new Error('Non-finite derived network value');
    if (time + DAY <= closedBefore)
      rows.push({ time, values, ...(Object.keys(statuses).length ? { statuses } : {}) });
  }
  return rows.sort((a, b) => a.time - b.time);
}

function decodeMonth(month: Month): NetworkDay[] {
  const rows = JSON.parse(month.payload) as NetworkDay[];
  if (!Array.isArray(rows) || rows.length > 31) throw new Error('Invalid stored network month');
  let previous = -1;
  for (const row of rows) {
    if (
      !row ||
      !validTime(row.time) ||
      row.time <= previous ||
      networkMonth(row.time) !== month.bucket ||
      !row.values ||
      typeof row.values !== 'object' ||
      Array.isArray(row.values) ||
      !Object.values(row.values).every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      ) ||
      (row.statuses !== undefined &&
        (typeof row.statuses !== 'object' ||
          Array.isArray(row.statuses) ||
          !Object.values(row.statuses).every((value) => typeof value === 'string')))
    )
      throw new Error('Invalid stored network observation');
    previous = row.time;
  }
  return rows;
}

export async function readNetworkSeries(
  db: D1Database,
  asset: Asset,
  metricId: string,
  from: number,
  to: number,
  limit: number,
): Promise<SeriesResponse> {
  const metric = networkMetric(asset, metricId);
  if (
    !isNetworkAsset(asset) ||
    !metric ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > 4102444800 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error('Unsupported network metric or range');
  const coverage = await db
    .prepare('SELECT * FROM network_coverage WHERE asset=? AND metric=?')
    .bind(asset, metricId)
    .first<Coverage>();
  const ingestion = await db
    .prepare('SELECT last_success,error FROM ingestion WHERE key=?')
    .bind('network:' + asset)
    .first<{ last_success: number | null; error: string | null }>();
  const scanFrom = Math.max(from, coverage?.first ?? from);
  // At most 40 small monthly rows per public request; long or sparse histories use cursors.
  const result =
    coverage && scanFrom < to
      ? await db
          .prepare(
            'SELECT bucket,payload,fetched_at FROM network_months WHERE asset=? AND bucket>=? AND bucket<? ORDER BY bucket LIMIT 40',
          )
          .bind(asset, networkMonth(scanFrom), to)
          .all<Month>()
      : { results: [] as Month[] };
  const data: Point[] = [];
  const price: Point[] = [];
  let nextCursor: number | null = null;
  let sourceStatus: string | undefined;
  outer: for (const month of result.results) {
    for (const row of decodeMonth(month)) {
      if (row.time < scanFrom || row.time >= to || row.time + DAY > epoch()) continue;
      const value = row.values[metricId];
      if (value === undefined) continue;
      if (data.length === limit) {
        nextCursor = data.at(-1)!.time + DAY;
        break outer;
      }
      data.push({ time: row.time, value });
      if (row.statuses?.[metricId]) sourceStatus = row.statuses[metricId];
      if (metricId === 'exchange_netflow')
        sourceStatus =
          row.statuses?.exchange_inflow || row.statuses?.exchange_outflow || sourceStatus;
      if (row.values.price !== undefined) price.push({ time: row.time, value: row.values.price });
    }
  }
  if (nextCursor === null && result.results.length === 40) {
    const candidate = nextMonth(result.results.at(-1)!.bucket);
    if (candidate < to && candidate <= (coverage?.last ?? -1)) nextCursor = candidate;
  }
  const asOf = coverage?.last ?? null;
  const fetchedAt = ingestion?.last_success ?? coverage?.fetched_at ?? null;
  const warnings = [
    metric.derived
      ? metricId === 'exchange_netflow'
        ? '같은 원천의 거래소 유입량에서 유출량을 뺀 계산값입니다.'
        : '같은 원천의 MVRV로 역산했습니다. CapRealUSD 원본 직접 수집·독립 검산이 아닙니다.'
      : '',
    ingestion?.error ? '최근 수집 실패로 마지막 정상 데이터를 제공합니다.' : '',
    !coverage ? '해당 지표의 저장 데이터가 없습니다. 값을 0으로 대체하지 않습니다.' : '',
    metricId.startsWith('exchange_')
      ? '거래소 주소 식별 및 원천의 관측 상태에 따라 과거 수치가 수정될 수 있습니다.'
      : '',
  ].filter(Boolean);
  return {
    data,
    price,
    nextCursor,
    meta: {
      source: NETWORK_SOURCE,
      unit: networkUnit(asset, metricId),
      market: asset + ' on-chain / Coin Metrics',
      dataAsOf: asOf,
      fetchedAt,
      historyStart: coverage?.first ?? null,
      stale:
        asOf === null ||
        epoch() - asOf > 3 * DAY ||
        fetchedAt === null ||
        epoch() - fetchedAt > 7 * 3600 ||
        Boolean(ingestion?.error),
      calculationVersion: NETWORK_VERSION,
      sourceStatus,
      priceBasis: '동일 원천 Coin Metrics PriceUSD · 일별 USD 기준가격 · 거래소 OHLCV 아님',
      warning: warnings.join(' ') || undefined,
      gapCount: data.reduce(
        (count, point, index) =>
          count + (index ? Math.max(0, (point.time - data[index - 1].time) / DAY - 1) : 0),
        0,
      ),
    },
  };
}

/** Each run fetches at most 60 days and commits data, coverage and cursor atomically. */
export async function updateNetworkData(env: Env, asset: NetworkAsset): Promise<void> {
  if (!isNetworkAsset(asset)) throw new Error('Unsupported network asset');
  const db = env.DB;
  const now = epoch();
  const end = Math.floor(now / DAY) * DAY;
  const historyStart = Date.parse(NETWORK_HISTORY[asset]) / 1000;
  const existingCoverage = (
    await db.prepare('SELECT * FROM network_coverage WHERE asset=?').bind(asset).all<Coverage>()
  ).results;
  const latest = Math.max(historyStart, ...existingCoverage.map((row) => row.last));
  const progressKey = 'network-cursor:' + asset;
  const checkpoint = await readState<number | null>(db, progressKey, null);
  if (
    checkpoint !== null &&
    (!validTime(checkpoint) || checkpoint < historyStart || checkpoint > end)
  )
    throw new Error('Invalid saved network cursor');
  // Re-read 32 days to incorporate revisions. Bootstrap uses the CLI for full initial history.
  const from = checkpoint ?? Math.max(historyStart, latest - 31 * DAY);
  const params = new URLSearchParams({
    assets: asset.toLowerCase(),
    metrics: networkSourceMetrics(asset).join(','),
    frequency: '1d',
    start_time: new Date(from * 1000).toISOString(),
    end_time: new Date(end * 1000).toISOString(),
    end_inclusive: 'false',
    page_size: '60',
    paging_from: 'start',
  });
  const input = await upstream(
    'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?' + params,
  );
  const body = input as { data?: unknown[]; next_page_url?: unknown; next_page_token?: unknown };
  if (!Array.isArray(body?.data) || body.data.length > 60)
    throw new Error('Oversized network source page');
  const rows = parseNetwork(input, asset, end);
  if (!rows.length) throw new Error('Empty completed network source page');
  if (rows.length !== body.data.length || rows.some((row) => row.time < from || row.time >= end))
    throw new Error('Network source range mismatch');
  if (!existingCoverage.length && checkpoint === null && rows[0].time !== historyStart)
    throw new Error('Initial network response did not include the documented history start');
  const buckets = [...new Set(rows.map((row) => networkMonth(row.time)))];
  const stored = (
    await db
      .prepare(
        'SELECT bucket,payload,fetched_at FROM network_months WHERE asset=? AND bucket IN (' +
          buckets.map(() => '?').join(',') +
          ')',
      )
      .bind(asset, ...buckets)
      .all<Month>()
  ).results;
  const months = new Map<number, Map<number, NetworkDay>>();
  for (const bucket of buckets) months.set(bucket, new Map());
  for (const month of stored)
    months.set(month.bucket, new Map(decodeMonth(month).map((row) => [row.time, row])));
  const stats = new Map<string, { first: number; last: number; added: number }>();
  const known = new Set(['price', ...networkMetrics(asset).map((metric) => metric.id)]);
  for (const row of rows) {
    const month = months.get(networkMonth(row.time))!;
    const previous = month.get(row.time);
    // A provider retracting an already valid observation needs a deliberate rebuild, not a silent stale fill.
    if (
      previous &&
      Object.keys(previous.values).some((key) => known.has(key) && row.values[key] === undefined)
    )
      throw new Error('Network source removed a stored value; full rebuild required');
    for (const id of Object.keys(row.values)) {
      const stat = stats.get(id) ?? { first: row.time, last: row.time, added: 0 };
      stat.first = Math.min(stat.first, row.time);
      stat.last = Math.max(stat.last, row.time);
      stat.added += previous?.values[id] === undefined ? 1 : 0;
      stats.set(id, stat);
    }
    month.set(row.time, row);
  }
  if (!stats.size) throw new Error('All network observations are missing');
  const statements: D1PreparedStatement[] = [];
  for (const [bucket, month] of months) {
    const payload = JSON.stringify([...month.values()].sort((a, b) => a.time - b.time));
    statements.push(
      db
        .prepare(
          'INSERT INTO network_months(asset,bucket,payload,fetched_at) VALUES(?,?,?,?) ON CONFLICT(asset,bucket) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at WHERE network_months.payload<>excluded.payload',
        )
        .bind(asset, bucket, payload, now),
    );
  }
  for (const [id, stat] of stats) {
    if (!stat.added && !existingCoverage.some((row) => row.metric === id))
      throw new Error('Missing network coverage; full rebuild required');
    statements.push(
      db
        .prepare(
          'INSERT INTO network_coverage(asset,metric,first,last,observations,fetched_at) VALUES(?,?,?,?,?,?) ON CONFLICT(asset,metric) DO UPDATE SET first=MIN(network_coverage.first,excluded.first),last=MAX(network_coverage.last,excluded.last),observations=network_coverage.observations+?,fetched_at=excluded.fetched_at WHERE network_coverage.first>excluded.first OR network_coverage.last<excluded.last OR ?>0',
        )
        .bind(
          asset,
          id,
          stat.first,
          stat.last,
          Math.max(1, stat.added),
          now,
          stat.added,
          stat.added,
        ),
    );
  }
  const cursor = rows.at(-1)!.time + DAY;
  const more =
    Boolean(body.next_page_token || body.next_page_url || rows.length === 60) && cursor < end;
  if (more)
    statements.push(
      db
        .prepare(
          'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        )
        .bind(progressKey, JSON.stringify(cursor)),
    );
  else statements.push(db.prepare('DELETE FROM state WHERE key=?').bind(progressKey));
  const asOf = Math.max(
    ...existingCoverage.map((row) => row.last),
    ...[...stats.values()].map((row) => row.last),
  );
  statements.push(successStatement(db, 'network:' + asset, asOf, now));
  if (more)
    statements.push(
      db
        .prepare('UPDATE ingestion SET next_attempt=? WHERE key=?')
        .bind(now + 60, 'network:' + asset),
    );
  statements.push(
    db
      .prepare('INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)')
      .bind('network:' + asset, NETWORK_SOURCE, now, JSON.stringify(input)),
  );
  await db.batch(statements);
}
