import type { ResearchMarket } from '../../shared/report-types';
import { boundedJson, decimal, D, DAY, iso, object, observation, type Observation } from './core';
import type { ProviderOptions } from './providers';

export const INDEXER = 'https://sentry.exchange.grpc-web.injective.network';
export const CHRONOS = INDEXER + '/api/chronos/v1';
const MARKET_ID = /^0x[0-9a-f]{64}$/;
const SOURCE = 'https://docs.injective.network/developers-native/query-indexer/spot';
export interface InjectiveClient {
  fetchMarkets(params: { marketStatuses: string[] }): Promise<unknown>;
  fetchTrades(params: {
    marketId: string;
    executionSide: 'taker';
    startTime?: number;
    endTime?: number;
    pagination: { limit: number; skip?: number };
  }): Promise<unknown>;
  fetchOrderbookV2(marketId: string): Promise<unknown>;
}
export async function createInjectiveClients(
  signal?: AbortSignal,
): Promise<{ spot: InjectiveClient; derivative: InjectiveClient }> {
  // Server-only lazy dependency. No signing, wallet, account or transaction tool is exposed.
  const { IndexerGrpcSpotApi, IndexerGrpcDerivativesApi } =
    await import('@injectivelabs/sdk-ts/client/indexer');
  const settings = { timeout: 20000, abort: signal };
  return {
    spot: new IndexerGrpcSpotApi(INDEXER, settings),
    derivative: new IndexerGrpcDerivativesApi(INDEXER, settings),
  };
}
export function normalizeMarkets(
  raw: unknown,
  kind: 'spot' | 'derivative',
  at: number,
): ResearchMarket[] {
  if (!Array.isArray(raw) || raw.length > 2000) throw new Error('INVALID_MARKETS');
  const ids = new Set<string>();
  return raw.map((input) => {
    const r = object(input),
      quote = object(r.quoteToken),
      base = kind === 'spot' ? object(r.baseToken) : null;
    if (
      !MARKET_ID.test(r.marketId) ||
      ids.has(r.marketId) ||
      r.marketStatus !== 'active' ||
      typeof r.ticker !== 'string' ||
      r.ticker.length > 100 ||
      typeof r.quoteDenom !== 'string' ||
      r.quoteDenom.length > 250 ||
      !Number.isInteger(quote.decimals) ||
      quote.decimals < 0 ||
      quote.decimals > 30 ||
      typeof quote.symbol !== 'string' ||
      quote.symbol.length > 30 ||
      (base &&
        (!Number.isInteger(base.decimals) ||
          base.decimals < 0 ||
          base.decimals > 30 ||
          typeof r.baseDenom !== 'string'))
    )
      throw new Error('INVALID_MARKET_METADATA');
    ids.add(r.marketId);
    return {
      id: r.marketId,
      chain: 'injective',
      network: 'mainnet',
      venue: 'injective',
      kind:
        kind === 'spot'
          ? 'spot'
          : r.isPerpetual === true
            ? 'perpetual'
            : r.expiryFuturesMarketInfo
              ? 'expiry_future'
              : 'other_derivative',
      ticker: r.ticker,
      baseDenom: kind === 'spot' ? r.baseDenom : null,
      quoteDenom: r.quoteDenom,
      quoteSymbol: quote.symbol,
      baseDecimals: base ? base.decimals : null,
      quoteDecimals: quote.decimals,
      status: r.marketStatus,
      sourceUrl: SOURCE,
      verifiedAt: iso(at),
    };
  });
}
export interface NormalizedTrade {
  id: string;
  marketId: string;
  time: number;
  price: string;
  quantity: string;
  notional: string;
}
export function normalizeTrade(
  input: unknown,
  market: ResearchMarket,
  at: number,
): NormalizedTrade {
  const r = object(input);
  if (
    r.marketId !== market.id ||
    r.executionSide !== 'taker' ||
    typeof r.tradeId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,150}$/.test(r.tradeId) ||
    !Number.isSafeInteger(r.executedAt) ||
    r.executedAt < 1e12 ||
    r.executedAt > at * 1000 + 300000
  )
    throw new Error('INVALID_TRADE');
  const spot = market.kind === 'spot';
  const price = new D(decimal(spot ? r.price : r.executionPrice, { positive: true })).mul(
    new D(10).pow(spot ? market.baseDecimals! - market.quoteDecimals : -market.quoteDecimals),
  );
  const quantity = new D(decimal(spot ? r.quantity : r.executionQuantity, { positive: true })).div(
    new D(10).pow(spot ? market.baseDecimals! : 0),
  );
  return {
    id: r.tradeId,
    marketId: market.id,
    time: r.executedAt,
    price: price.toFixed(),
    quantity: quantity.toFixed(),
    notional: price.mul(quantity).toFixed(),
  };
}
export interface TradeCheckpoint {
  version: 1;
  marketId: string;
  start: number;
  end: number;
  skip: number;
  ids: string[];
  notional: string;
  count: number;
  complete: boolean;
  limited: boolean;
  lastPage: string | null;
  firstTrade: number | null;
  lastTrade: number | null;
}
export function emptyTradeCheckpoint(
  market: ResearchMarket,
  start: number,
  end: number,
): TradeCheckpoint {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end - start !== DAY ||
    start % DAY
  )
    throw new Error('INVALID_TRADE_WINDOW');
  return {
    version: 1,
    marketId: market.id,
    start,
    end,
    skip: 0,
    ids: [],
    notional: '0',
    count: 0,
    complete: false,
    limited: false,
    lastPage: null,
    firstTrade: null,
    lastTrade: null,
  };
}
/** Fixed completed UTC day; countback/rolling-24h snapshots are never summed. */
export async function resumeTradeWindow(
  client: InjectiveClient,
  market: ResearchMarket,
  prior: TradeCheckpoint,
  at: number,
  pages = 2,
  now = () => at,
): Promise<TradeCheckpoint> {
  if (
    prior.version !== 1 ||
    prior.marketId !== market.id ||
    prior.end > at ||
    prior.end - prior.start !== DAY ||
    prior.skip < 0 ||
    prior.ids.length > 5000
  )
    throw new Error('INVALID_CHECKPOINT');
  const next = { ...prior, ids: [...prior.ids] };
  const ids = new Set(next.ids);
  for (let page = 0; page < Math.min(pages, 5) && !next.complete && !next.limited; page++) {
    const raw = object(
      await client.fetchTrades({
        marketId: market.id,
        executionSide: 'taker',
        startTime: next.start * 1000,
        endTime: next.end * 1000 - 1,
        pagination: { skip: next.skip, limit: 100 },
      }),
    );
    if (!Array.isArray(raw.trades) || raw.trades.length > 100)
      throw new Error('INVALID_TRADE_PAGE');
    const receivedAt = now();
    const rows = raw.trades.map((r: unknown) => normalizeTrade(r, market, receivedAt));
    if (rows.some((r: NormalizedTrade) => r.time < next.start * 1000 || r.time >= next.end * 1000))
      throw new Error('INVALID_TRADE_WINDOW');
    const fingerprint = rows.map((r: NormalizedTrade) => r.id).join('|');
    if (rows.length && fingerprint === next.lastPage) {
      next.limited = true;
      break;
    }
    for (const row of rows) {
      if (ids.has(row.id)) continue;
      ids.add(row.id);
      next.count++;
      next.notional = new D(next.notional).plus(row.notional).toFixed();
      next.firstTrade = Math.min(next.firstTrade ?? row.time, row.time);
      next.lastTrade = Math.max(next.lastTrade ?? row.time, row.time);
    }
    next.skip += raw.trades.length;
    next.lastPage = fingerprint;
    next.ids = [...ids];
    if (raw.trades.length < 100) next.complete = true;
    // Provider pagination caps are not evidence of a complete day. A bounded partial stays partial.
    // The live indexer reports total=1000 at its search cap. Reaching that boundary
    // is not proof that the fixed day was exhausted, even if the next page is empty.
    if (next.skip >= 1000) {
      next.limited = true;
      next.complete = false;
    }
  }
  return next;
}
export async function tradeObservation(
  market: ResearchMarket,
  checkpoint: TradeCheckpoint,
  at: number,
): Promise<Observation> {
  return observation({
    reportScope: 'injective',
    provider: 'injective-trades',
    entityId: 'market:' + market.id,
    entityType: 'market',
    metric: 'observed_taker_notional',
    value: checkpoint.notional,
    unit: market.quoteSymbol,
    source: 'Injective Indexer',
    sourceUrl: SOURCE,
    scope:
      market.ticker +
      ' · 관측 taker 체결, ' +
      (market.kind === 'spot' ? '현물' : '파생 명목 거래대금'),
    dataAsOf: checkpoint.lastTrade ? iso(Math.floor(checkpoint.lastTrade / 1000)) : null,
    fetchedAt: iso(at),
    observedAt: checkpoint.start,
    periodStart: iso(checkpoint.start),
    periodEnd: iso(checkpoint.end),
    status: checkpoint.complete && !checkpoint.limited ? 'verified' : 'partial',
  });
}
export async function collectMarketSnapshot(
  client: InjectiveClient,
  market: ResearchMarket,
  at: number,
  now = () => at,
): Promise<Observation[]> {
  const trades = object(
    await client.fetchTrades({
      marketId: market.id,
      executionSide: 'taker',
      pagination: { limit: 1 },
    }),
  );
  if (!Array.isArray(trades.trades) || !trades.trades.length) return [];
  at = now();
  const trade = normalizeTrade(trades.trades[0], market, at),
    time = Math.floor(trade.time / 1000);
  const base = {
    reportScope: 'injective' as const,
    provider: 'injective',
    entityId: 'market:' + market.id,
    entityType: 'market' as const,
    source: 'Injective Indexer',
    sourceUrl: SOURCE,
    scope: market.ticker + ' · ' + (market.kind === 'spot' ? '현물' : '파생'),
    dataAsOf: iso(time),
    fetchedAt: iso(at),
    observedAt: time,
    periodStart: null,
    periodEnd: null,
  };
  const output = [
    await observation({
      ...base,
      metric: 'last_trade_price',
      value: trade.price,
      unit: market.quoteSymbol,
      status: at - time <= 300 ? 'verified' : 'partial',
    }),
  ];
  const book = object(await client.fetchOrderbookV2(market.id));
  const bookAt = now();
  if (
    !Array.isArray(book.buys) ||
    !Array.isArray(book.sells) ||
    !book.buys.length ||
    !book.sells.length
  )
    return output;
  // V2 price levels retain normal chain-format strings; stale individual levels are excluded.
  const level = (r: unknown) => {
    const v = object(r),
      t = Number(v.timestamp);
    if (
      !Number.isSafeInteger(t) ||
      t < 1e12 ||
      t > bookAt * 1000 + 300000 ||
      bookAt * 1000 - t > 300000
    )
      return null;
    const raw = decimal(v.price, { positive: true });
    return new D(raw).mul(
      new D(10).pow(
        market.kind === 'spot'
          ? market.baseDecimals! - market.quoteDecimals
          : -market.quoteDecimals,
      ),
    );
  };
  const bid = level(book.buys[0]),
    ask = level(book.sells[0]);
  if (bid && ask && ask.gte(bid))
    output.push(
      await observation({
        ...base,
        observedAt: bookAt,
        fetchedAt: iso(bookAt),
        dataAsOf: null,
        metric: 'spread_bps',
        value: ask.minus(bid).div(ask.plus(bid).div(2)).mul(10000).toFixed(12),
        unit: 'bps',
        status: 'verified',
      }),
    );
  return output;
}
export async function collectChronosHistory(
  market: ResearchMarket,
  at: number,
  options: ProviderOptions = {},
): Promise<Observation[]> {
  const input = await boundedJson(
    CHRONOS + '/market/history?marketIDs=' + market.id + '&resolution=1440&countback=30',
    options,
  );
  at = options.now?.() ?? at;
  // The official response is an array. No made-up candle or zero-filled absent day is created.
  if (!Array.isArray(input) || input.length > 1) throw new Error('INVALID_CHRONOS_HISTORY');
  if (!input.length) return [];
  const row = object(input[0]);
  if (
    row.marketID !== market.id ||
    !Array.isArray(row.t) ||
    !Array.isArray(row.c) ||
    row.t.length !== row.c.length ||
    row.t.length > 100
  )
    throw new Error('INVALID_CHRONOS_HISTORY');
  const seen = new Set<number>(),
    result: Observation[] = [];
  for (let i = 0; i < row.t.length; i++) {
    const t = Number(row.t[i]);
    if (!Number.isSafeInteger(t) || t < 0 || t % DAY || seen.has(t))
      throw new Error('INVALID_CHRONOS_TIME');
    seen.add(t);
    if (t + DAY > at) continue;
    result.push(
      await observation({
        reportScope: 'injective',
        provider: 'injective-chronos',
        entityId: 'market:' + market.id,
        entityType: 'market',
        metric: 'close',
        value: decimal(row.c[i], { positive: true }),
        unit: market.quoteSymbol,
        source: 'Injective Chronos',
        sourceUrl: 'https://api.injective.exchange',
        scope: market.ticker + ' · 확정 일봉 종가',
        dataAsOf: iso(t),
        fetchedAt: iso(at),
        observedAt: t,
        periodStart: iso(t),
        periodEnd: iso(t + DAY),
        status: 'verified',
      }),
    );
  }
  return result;
}
