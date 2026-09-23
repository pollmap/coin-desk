import { ASSETS, CALC_VERSION, METRICS } from '../shared/catalog';
import { aggregate, bucket, DAY, rsi } from '../shared/math';
import type {
  Asset,
  CandleResponse,
  Interval,
  Market,
  Overview,
  Provenance,
  Quote,
  SeriesResponse,
} from '../shared/types';
import { getQuote } from './providers';
import {
  claimRefresh,
  dbCandle,
  epoch,
  failure,
  readState,
  putState,
  success,
  QUOTE_REFRESH_SECONDS,
  type Env,
} from './storage';
import { scheduled } from './scheduled';
import { candleHistory } from './candle-history';
import { getDominance, DOMINANCE_VERSION } from './dominance';
import { REFERENCE_ASSETS, REFERENCE_SOURCE, REFERENCE_VERSION } from './reference-price';
import { operationStatus } from './health';
import { NETWORK_ASSETS, NETWORK_METRICS, networkMetric } from '../shared/network-catalog';
import { readNetworkSeries } from './network-data';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
const inFlight = new WeakMap<D1Database, Map<string, Promise<Response>>>();
class RequestError extends Error {}
/** Requests with equivalent selections must share the same cache entry. */
function canonicalRequest(request: Request) {
  const url = new URL(request.url);
  if (url.href.length > 2048) throw new RequestError('Invalid URL length');
  const endpoint = url.pathname.slice('/api/v1/'.length);
  const fields: Record<string, string[]> = {
    overview: ['asset', 'market'],
    candles: ['asset', 'market', 'interval', 'from', 'to', 'limit'],
    series: ['asset', 'metric', 'from', 'to', 'limit'],
    reference: ['asset', 'from', 'to', 'limit'],
    network: ['asset', 'metric', 'from', 'to', 'limit'],
    'network-catalog': ['asset'],
    metrics: ['asset'],
    status: [],
    health: [],
    dominance: [],
    'dominance/history': [],
  };
  if (!fields[endpoint]) return new Request(url, { method: 'GET' });
  for (const key of url.searchParams.keys())
    if (!fields[endpoint].includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new RequestError('Invalid query parameter');
  const defaults: Record<string, string> = {
    asset: 'BTC',
    market: 'binance',
    interval: '1d',
    metric: 'mvrv',
    from: '0',
    limit: '1000',
  };
  for (const key of fields[endpoint]) {
    let value = url.searchParams.get(key) ?? defaults[key];
    if (value === undefined) continue; // Keep a missing "to" stable instead of adding the current second.
    if (key === 'asset') value = value.toUpperCase();
    if (['from', 'to', 'limit'].includes(key)) {
      const parsed = number(
        new URLSearchParams([[key, value]]),
        key,
        0,
        key === 'limit' ? 1000 : epoch() + DAY,
      );
      value = String(parsed);
    }
    url.searchParams.set(key, value);
  }
  url.searchParams.sort();
  return new Request(url, { method: 'GET' });
}
function number(q: URLSearchParams, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const s = q.get(key);
  if (s === null) return fallback;
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 0 || n > max)
    throw new RequestError('Invalid ' + key);
  return n;
}
function selection(q: URLSearchParams) {
  const asset = (q.get('asset') || 'BTC').toUpperCase() as Asset;
  const market = (q.get('market') || 'binance') as Market;
  if (!ASSETS.some((a) => a.id === asset) || !['binance', 'upbit'].includes(market))
    throw new RequestError('Unknown asset or market');
  return { asset, market };
}
const source = (market: Market) => (market === 'binance' ? 'Binance' : 'Upbit');
function meta(market: Market, asOf: number | null, fetched: number | null): Provenance {
  return {
    source: source(market),
    unit: market === 'binance' ? 'USDT' : 'KRW',
    market,
    dataAsOf: asOf,
    fetchedAt: fetched,
    stale: !fetched || epoch() - fetched > 7200,
    calculationVersion: CALC_VERSION,
  };
}

async function overview(env: Env, asset: Asset, market: Market): Promise<Overview> {
  const key = 'quote:' + asset + ':' + market;
  let saved = await env.DB.prepare('SELECT data,fetched_at FROM snapshots WHERE key=?')
    .bind(key)
    .first<{ data: string; fetched_at: number }>();
  let quote: Quote | null = saved ? JSON.parse(saved.data) : null;
  let warning: string | undefined;
  const retry = await env.DB.prepare('SELECT next_attempt FROM ingestion WHERE key=?')
    .bind(key)
    .first<{ next_attempt: number }>();
  try {
    if (
      (!saved || epoch() - saved.fetched_at >= QUOTE_REFRESH_SECONDS) &&
      (retry?.next_attempt || 0) <= epoch() &&
      (await claimRefresh(env.DB, key, QUOTE_REFRESH_SECONDS))
    ) {
      try {
        quote = await getQuote(asset, market);
        saved = { data: JSON.stringify(quote), fetched_at: epoch() };
        await env.DB.prepare('INSERT OR REPLACE INTO snapshots(key,data,fetched_at) VALUES(?,?,?)')
          .bind(key, saved.data, saved.fetched_at)
          .run();
        await success(env.DB, key, quote.time);
      } catch (e) {
        warning = '시세 원천 연결이 지연되고 있습니다. 마지막 정상 값을 표시합니다.';
        await failure(env.DB, key, e).catch(() => undefined);
      }
    }
  } catch {
    // A quota/lease write failure must not prevent reading the saved market data.
    warning = '서버 저장·갱신이 지연되고 있습니다. 마지막 정상 값을 표시합니다.';
  }
  if (saved && epoch() - saved.fetched_at >= QUOTE_REFRESH_SECONDS) {
    // A scheduled refresh may have won the lease after our initial snapshot read.
    const latestSaved = await env.DB.prepare('SELECT data,fetched_at FROM snapshots WHERE key=?')
      .bind(key)
      .first<{ data: string; fetched_at: number }>();
    if (latestSaved && latestSaved.fetched_at > saved.fetched_at) {
      saved = latestSaved;
      quote = JSON.parse(latestSaved.data);
    }
  }
  if ((retry?.next_attempt || 0) > epoch())
    warning = '시세 원천 재시도 대기 중입니다. 마지막 정상 값을 표시합니다.';
  const generation = await readState<string | null>(env.DB, 'onchain_generation', null);
  const latest =
    asset === 'BTC' && generation
      ? await env.DB.prepare(
          'SELECT time,data FROM onchain WHERE generation=? ORDER BY time DESC LIMIT 1',
        )
          .bind(generation)
          .first<{ time: number; data: string }>()
      : null;
  const technicalKey = 'technical:' + asset + ':' + market;
  const cachedTechnical = await readState<{
    computedAt: number;
    data: Overview['technical'];
  } | null>(env.DB, technicalKey, null);
  let technical = cachedTechnical?.data;
  if (
    !cachedTechnical ||
    epoch() - cachedTechnical.computedAt > 3600 ||
    Math.floor(epoch() / DAY) !== Math.floor(cachedTechnical.computedAt / DAY)
  ) {
    const daily = (
      await env.DB.prepare(
        'SELECT time,close FROM candles WHERE asset=? AND market=? AND interval=? AND close_time<=? ORDER BY time DESC LIMIT 500',
      )
        .bind(asset, market, '1d', epoch())
        .all<{ time: number; close: number }>()
    ).results.reverse();
    const techRsi = rsi(daily.map((c) => ({ time: c.time, value: c.close }))).at(-1)?.value ?? null;
    technical = {
      rsi: techRsi,
      sma200: daily.length >= 200 ? daily.slice(-200).reduce((s, c) => s + c.close, 0) / 200 : null,
    };
    // Derived-result caching is optional; read access must survive exhausted writes.
    await putState(env.DB, technicalKey, { computedAt: epoch(), data: technical }).catch(
      () => undefined,
    );
  }
  return {
    quote,
    meta: {
      ...meta(market, quote?.time ?? null, saved?.fetched_at ?? null),
      stale:
        !!warning ||
        !saved ||
        epoch() - saved.fetched_at > 300 ||
        !quote ||
        epoch() - quote.time > 300,
      warning,
    },
    metrics: latest ? JSON.parse(latest.data) : {},
    metricsAsOf: latest?.time ?? null,
    technical: technical!,
    assets: ASSETS.filter((a) => env.ENABLED_ASSETS.split(',').includes(a.id)).map((a) => a.id),
  };
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    q = url.searchParams;
  const { asset, market } = selection(q);
  if (request.method !== 'GET') return response({ error: 'Read-only API' }, 405);
  const endpoint = url.pathname.replace('/api/v1/', '');
  if (endpoint === 'dominance') {
    const data = await getDominance(env);
    return data
      ? response(data)
      : response({ error: '시장 비중 데이터를 아직 가져오지 못했습니다.' }, 503);
  }
  if (endpoint === 'dominance/history') {
    const rows = (
      await env.DB.prepare(
        'SELECT time,data FROM dominance_history ORDER BY time DESC LIMIT 1000',
      ).all<{ time: number; data: string }>()
    ).results.reverse();
    const data = rows
      .filter((r) => JSON.parse(r.data).calculationVersion === DOMINANCE_VERSION)
      .map((r) => ({ time: r.time, coins: JSON.parse(r.data).coins }));
    return response({
      data,
      source: 'CoinLore / DefiLlama',
      unit: '%',
      historyStart: data[0]?.time ?? null,
    });
  }
  if (endpoint === 'metrics')
    return response({
      data: asset === 'BTC' ? METRICS : [],
      asset,
      priceBasis: 'Bitview 추정 USD 가격',
      calculationVersion: CALC_VERSION,
    });
  if (endpoint === 'network-catalog')
    return response({
      asset,
      assets: NETWORK_ASSETS,
      data: NETWORK_METRICS.filter((metric) => networkMetric(asset, metric.id)),
      source: 'Coin Metrics Community',
    });
  if (endpoint === 'status' || endpoint === 'health') {
    const report = await operationStatus(env);
    return endpoint === 'status'
      ? response(report)
      : response(
          {
            ...report.health,
            automation: report.automation,
            coverage: report.coverage,
            sources: report.sources,
          },
          report.health.ok ? 200 : 503,
        );
  }
  if (!env.ENABLED_ASSETS.split(',').includes(asset))
    return response({ error: '아직 수집하지 않은 자산입니다.', code: 'NOT_ENABLED' }, 404);
  if (endpoint === 'overview') return response(await overview(env, asset, market));
  const from = number(q, 'from', 0),
    to = number(q, 'to', epoch() + DAY),
    limit = number(q, 'limit', 1000, 1000);
  if (limit < 1 || from >= to) return response({ error: 'Invalid range' }, 400);
  if (endpoint === 'network') {
    const metric = q.get('metric') || 'mvrv';
    if (!networkMetric(asset, metric))
      throw new RequestError('해당 자산에서 지원하지 않는 온체인 지표입니다.');
    return response(await readNetworkSeries(env.DB, asset, metric, from, to, limit));
  }
  if (endpoint === 'reference') {
    if (!(REFERENCE_ASSETS as readonly string[]).includes(asset))
      return response({ error: '장기 USD 이력은 BTC·DOGE·ETH·XRP·LINK를 지원합니다.' }, 400);
    const [rows, extent, state] = await Promise.all([
      env.DB.prepare(
        'SELECT time,value FROM reference_prices WHERE asset=? AND time>=? AND time<? ORDER BY time LIMIT ?',
      )
        .bind(asset, from, to, limit + 1)
        .all<{ time: number; value: number }>(),
      env.DB.prepare(
        'SELECT (SELECT time FROM reference_prices WHERE asset=? ORDER BY time LIMIT 1) AS first,(SELECT time FROM reference_prices WHERE asset=? ORDER BY time DESC LIMIT 1) AS last',
      )
        .bind(asset, asset)
        .first<{ first: number | null; last: number | null }>(),
      env.DB.prepare('SELECT last_success,data_as_of,error FROM ingestion WHERE key=?')
        .bind('reference:' + asset)
        .first<{ last_success: number; data_as_of: number; error: string | null }>(),
    ]);
    const data = rows.results.slice(0, limit);
    return response({
      data,
      price: [],
      nextCursor: rows.results.length > limit ? data.at(-1)!.time + DAY : null,
      meta: {
        source: REFERENCE_SOURCE,
        unit: 'USD',
        market: asset + ' / USD reference',
        dataAsOf: extent?.last ?? null,
        fetchedAt: state?.last_success ?? null,
        stale:
          !state?.last_success ||
          epoch() - state.last_success > 25200 ||
          !extent?.last ||
          epoch() - extent.last > 3 * DAY ||
          !!state.error,
        historyStart: extent?.first ?? null,
        calculationVersion: REFERENCE_VERSION,
        priceBasis: 'UTC 일별 종가 참조가격 · 거래소 OHLCV 아님',
        warning: state?.error
          ? '장기 USD 가격 갱신이 지연되고 있습니다. 마지막 정상 이력을 표시합니다.'
          : undefined,
      },
    } satisfies SeriesResponse);
  }
  if (endpoint === 'candles') {
    const interval = (q.get('interval') || '1d') as Interval;
    if (!['1h', '4h', '1d', '1w', '1M'].includes(interval))
      return response({ error: 'Invalid interval' }, 400);
    const base = interval === '1h' || interval === '4h' ? '1h' : '1d';
    const multiplier = interval === '4h' ? 4 : interval === '1w' ? 7 : interval === '1M' ? 31 : 1;
    const cap = Math.min(4000, limit * multiplier + multiplier);
    const rows = await candleHistory(
      env,
      asset,
      market,
      base,
      bucket(base === '1h' ? Math.max(from, epoch() - 90 * DAY) : from, interval),
      to,
      cap,
    );
    const grouped = aggregate(rows.map(dbCandle), interval);
    // A SQL page can end mid-week or mid-month; defer that bucket to the next page.
    if (rows.length === cap) grouped.pop();
    const data = grouped.slice(0, limit);
    const extent =
      (await readState<{
        first: number | null;
        last: number | null;
        fetched: number | null;
      } | null>(env.DB, 'history:' + asset + ':' + market + ':' + base, null)) ??
      (await env.DB.prepare(
        'SELECT MIN(time) AS first,MAX(time) AS last,MAX(fetched_at) AS fetched FROM candles WHERE asset=? AND market=? AND interval=?',
      )
        .bind(asset, market, base)
        .first<{ first: number | null; last: number | null; fetched: number | null }>());
    let gaps = 0;
    for (let i = 1; i < rows.length; i++)
      if (rows[i].time - rows[i - 1].time > (base === '1h' ? 3600 : DAY)) gaps++;
    const more = grouped.length > limit || rows.length === cap;
    return response({
      data,
      meta: {
        ...meta(market, extent?.last ?? null, extent?.fetched ?? null),
        stale:
          !extent?.fetched ||
          epoch() - extent.fetched > (base === '1h' ? 7200 : 25200) ||
          !extent.last ||
          epoch() - extent.last > (base === '1h' ? 7200 : 2 * DAY),
        historyStart: extent?.first,
        gapCount: gaps,
        warning: gaps
          ? '원천에 거래가 없거나 누락된 구간이 있습니다. 임의 보간하지 않습니다.'
          : undefined,
      },
      nextCursor: more && data.length ? data.at(-1)!.closeTime : null,
    } satisfies CandleResponse);
  }
  if (endpoint === 'series') {
    const id = q.get('metric') || 'mvrv';
    const metric = METRICS.find((m) => m.id === id);
    if (asset !== 'BTC' || !metric) return response({ error: 'Unsupported metric' }, 400);
    const generation = await readState<string | null>(env.DB, 'onchain_generation', null);
    if (!generation) return response({ error: '온체인 초기 수집 대기', code: 'NO_DATA' }, 503);
    const rows = (
      await env.DB.prepare(
        'SELECT time,data,fetched_at FROM onchain WHERE generation=? AND time>=? AND time<? ORDER BY time LIMIT ?',
      )
        .bind(generation, from, to, limit + 1)
        .all<{ time: number; data: string; fetched_at: number }>()
    ).results;
    const page = rows.slice(0, limit);
    const data: SeriesResponse['data'] = [],
      price: SeriesResponse['price'] = [];
    for (const r of page) {
      const d = JSON.parse(r.data) as Record<string, number | null>;
      if (d[id] !== null && Number.isFinite(d[id])) data.push({ time: r.time, value: d[id]! });
      if (d.price !== null && d.price > 0) price.push({ time: r.time, value: d.price });
    }
    const state = await env.DB.prepare(
      'SELECT last_success,data_as_of,error FROM ingestion WHERE key=?',
    )
      .bind('bitview')
      .first<{ last_success: number; data_as_of: number; error: string | null }>();
    const rebuild = !!(await readState(env.DB, 'onchain_build', null));
    return response({
      data,
      price,
      meta: {
        source: 'Bitview / BRK',
        unit: metric.unit,
        market: 'BTC / USD (onchain oracle)',
        dataAsOf: state?.data_as_of ?? null,
        fetchedAt: state?.last_success ?? null,
        stale: rebuild || !state || epoch() - state.data_as_of > 3 * DAY || !!state.error,
        calculationVersion: CALC_VERSION,
        priceBasis: '추정 USD 가격 · Bitview onchain oracle',
        sourceVersions: await readState(env.DB, 'onchain_versions', {}),
        calculationStart: await readState<number | null>(env.DB, 'onchain_calculation_start', null),
        historyStart: await readState<number | null>(env.DB, 'onchain_history_start', null),
        warning: rebuild
          ? '원천 버전 변경으로 재계산 중입니다. 이전 검증 데이터를 표시합니다.'
          : state?.error
            ? '온체인 갱신 지연'
            : undefined,
      },
      nextCursor: rows.length > limit ? page.at(-1)!.time + DAY : null,
    } satisfies SeriesResponse);
  }
  return response({ error: 'Not found' }, 404);
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (
      url.hostname === 'btc-desk.lch68-workers.workers.dev' &&
      !url.pathname.startsWith('/api/')
    ) {
      url.hostname = 'coin-desk.pages.dev';
      url.protocol = 'https:';
      url.port = '';
      return Response.redirect(url.href, 308);
    }
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!new URL(request.url).pathname.startsWith('/api/v1/'))
      return response({ error: 'Not found' }, 404);
    try {
      if (request.method !== 'GET') return response({ error: 'Read-only API' }, 405);
      const canonical = canonicalRequest(request);
      const cache = (caches as unknown as { default: Cache }).default;
      // Quotes already share durable snapshots and refresh leases. An extra edge
      // cache can keep an old/stale response after the scheduled collector commits.
      const liveStatus = /\/(health|status|overview)$/.test(url.pathname);
      const cached = liveStatus ? undefined : await cache.match(canonical).catch(() => undefined);
      if (cached) return cached;
      let pending = inFlight.get(env.DB);
      if (!pending) {
        pending = new Map();
        inFlight.set(env.DB, pending);
      }
      let task = pending.get(canonical.url);
      if (!task) {
        if (pending.size >= 64) {
          const busy = response(
            { error: '조회가 몰리고 있습니다. 잠시 후 다시 시도해 주세요.', code: 'BUSY' },
            429,
          );
          busy.headers.set('Retry-After', '5');
          return busy;
        }
        task = (async () => {
          const out = await api(canonical, env);
          if (out.ok && !liveStatus) {
            const clone = new Response(out.clone().body, out);
            clone.headers.set(
              'Cache-Control',
              'public, max-age=' + (url.pathname.endsWith('/overview') ? 30 : 300),
            );
            ctx.waitUntil(cache.put(canonical, clone).catch(() => undefined));
          }
          return out;
        })();
        pending.set(canonical.url, task);
        const remove = () => pending!.delete(canonical.url);
        task.then(remove, remove);
      }
      return (await task).clone();
    } catch (e) {
      const message = String(e);
      const bad = e instanceof RequestError;
      return response(
        {
          error: bad ? message : '데이터 조회가 일시적으로 지연되고 있습니다.',
          code: bad ? 'INVALID_REQUEST' : 'SOURCE_UNAVAILABLE',
        },
        bad ? 400 : 503,
      );
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env, Math.floor(_event.scheduledTime / 1000)));
  },
};
