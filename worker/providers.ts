import type { Asset, Candle, Market, Quote } from '../shared/types';
import { BASE_SERIES } from '../shared/catalog';
import { DAY, validCandle } from '../shared/math';
import { feedRequest, type FeedConfig, type QuoteTradeEvidence } from './feed-client';
export class UnknownTradeTimestampError extends Error {
  constructor() {
    super('QUOTE_TRADE_TIME_UNKNOWN: ticker window does not prove last trade time');
    this.name = 'UnknownTradeTimestampError';
  }
}
export class StaleQuoteError extends Error {
  constructor() {
    super('QUOTE_STALE: last trade exceeds 300 seconds');
    this.name = 'StaleQuoteError';
  }
}
export function validateQuote(q: Quote): Quote {
  const now = Math.floor(Date.now() / 1000);
  const validChange =
    q.change24h === null
      ? typeof q.changeUnavailableReason === 'string' && q.changeUnavailableReason.length > 0
      : Number.isFinite(q.change24h) && q.change24h > -100;
  if (
    ![q.price, q.volume24h, q.high24h, q.low24h, q.time].every(Number.isFinite) ||
    !validChange ||
    q.price <= 0 ||
    q.volume24h < 0 ||
    q.low24h <= 0 ||
    q.low24h > q.price ||
    q.high24h < q.price ||
    !Number.isSafeInteger(q.time) ||
    q.time <= 0 ||
    q.time > now + 60
  )
    throw new Error('Invalid or outdated quote');
  if (q.timestampKind === 'ticker-window') throw new UnknownTradeTimestampError();
  if (
    q.timestampKind === 'trade' &&
    (q.actualTradeAt !== q.time ||
      !Number.isSafeInteger(q.sourceEventTime) ||
      q.sourceEventTime! < q.time ||
      q.sourceEventTime! > now + 60)
  )
    throw new Error('Invalid quote timestamp evidence');
  // A valid HTTP response with an old trade is not a failed request. Keep the
  // freshness requirement, but let the collector check again next minute.
  if (now - q.time > 300) throw new StaleQuoteError();
  return q;
}
export async function upstream(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'CoinDesk/0.3 (public market data dashboard)',
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 2000);
    let detail = '';
    try {
      detail = String(JSON.parse(body).msg || '').slice(0, 160);
    } catch {
      detail = body.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
    }
    throw new Error('Source HTTP ' + response.status + (detail ? ': ' + detail : ''));
  }
  return response.json();
}
export async function getQuote(asset: Asset, market: Market, feed?: FeedConfig): Promise<Quote> {
  if (market === 'binance') {
    const d = (await binanceRequest('ticker.24hr', { symbol: asset + 'USDT' }, feed)) as Record<
      string,
      unknown
    >;
    const trades = await hubTrades([asset], feed);
    return binanceQuote(
      asset,
      d,
      await confirmBinanceTrade(asset, d, trades, Date.now() + 4000, feed),
    );
  }
  const d = (
    (await upstream('https://api.upbit.com/v1/ticker?markets=KRW-' + asset)) as Record<
      string,
      number
    >[]
  )[0];
  return upbitQuote(asset, d);
}
/** Match the ticker's exact price and raw last trade ID, not its rolling window closeTime. */
function evidenceMatches(d: Record<string, unknown>, trade: QuoteTradeEvidence) {
  return (
    trade.lastTradeId === Number(d.lastId) &&
    trade.price === Number(d.lastPrice) &&
    Number.isFinite(trade.tradedAt) &&
    trade.tradedAt > 0 &&
    // Hub API uses seconds; restore integer milliseconds before comparing the window edge.
    Math.round(trade.tradedAt * 1000) <= Number(d.closeTime)
  );
}
function binanceQuote(asset: Asset, d: Record<string, unknown>, trade: QuoteTradeEvidence): Quote {
  if (!evidenceMatches(d, trade)) throw new UnknownTradeTimestampError();
  const time = Math.floor(trade.tradedAt);
  return validateQuote({
    asset,
    price: Number(d.lastPrice),
    change24h: Number(d.priceChangePercent),
    volume24h: Number(d.quoteVolume),
    high24h: Number(d.highPrice),
    low24h: Number(d.lowPrice),
    time,
    timestampKind: 'trade',
    actualTradeAt: time,
    sourceEventTime: Math.floor(Number(d.closeTime) / 1000),
    lastTradeId: Number(d.lastId),
    changeBasis: 'rolling24h',
    rangeBasis: 'rolling24h',
  });
}
async function hubTrades(assets: Asset[], feed?: FeedConfig): Promise<QuoteTradeEvidence[]> {
  if (!feed?.QUOTE_TRADES) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      feed.QUOTE_TRADES(assets),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new UnknownTradeTimestampError()), 600);
      }),
    ]);
    return Array.isArray(rows) ? rows.slice(0, assets.length * 64) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
async function confirmBinanceTrade(
  asset: Asset,
  d: Record<string, unknown>,
  trades: QuoteTradeEvidence[],
  deadline: number,
  feed?: FeedConfig,
): Promise<QuoteTradeEvidence> {
  if (
    !Number.isSafeInteger(Number(d.lastId)) ||
    Number(d.lastId) < 0 ||
    !Number.isSafeInteger(Number(d.closeTime)) ||
    Number(d.closeTime) <= 0
  )
    throw new UnknownTradeTimestampError();
  const cached = trades.find(
    (t) => t.asset === asset && t.market === 'binance' && evidenceMatches(d, t),
  );
  if (cached) return cached;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new UnknownTradeTimestampError();
  try {
    // At most one 4-weight public request per missing asset. No historical pagination.
    const rows = await binanceRequest(
      'trades.aggregate',
      {
        symbol: asset + 'USDT',
        endTime: Number(d.closeTime),
        limit: 1,
      },
      feed,
      Math.min(1500, remaining),
    );
    if (!Array.isArray(rows) || rows.length !== 1) throw new UnknownTradeTimestampError();
    const r = rows[0] as Record<string, unknown>;
    const trade: QuoteTradeEvidence = {
      asset,
      market: 'binance',
      price: Number(r.p),
      tradedAt: Number(r.T) / 1000,
      lastTradeId: Number(r.l),
    };
    if (!evidenceMatches(d, trade)) throw new UnknownTradeTimestampError();
    return trade;
  } catch (error) {
    // An auxiliary timestamp failure is individual, never an exchange-wide ticker outage.
    if (error instanceof StaleQuoteError) throw error;
    throw new UnknownTradeTimestampError();
  }
}
async function upbitQuote(asset: Asset, d: Record<string, number>): Promise<Quote> {
  if (
    !d ||
    !Number.isFinite(d.trade_price) ||
    d.trade_price <= 0 ||
    !Number.isFinite(d.timestamp) ||
    !Number.isFinite(d.trade_timestamp)
  )
    throw new Error('Invalid quote');
  const target = Math.floor(d.timestamp / 1000) - DAY;
  const quote = validateQuote({
    asset,
    price: d.trade_price,
    change24h: null,
    changeUnavailableReason:
      '24시간 전 기준 시각의 5분 이내에 확정된 거래 분봉이 없어 등락률을 표시하지 않습니다.',
    volume24h: d.acc_trade_price_24h,
    high24h: d.high_price,
    low24h: d.low_price,
    time: Math.floor(d.trade_timestamp / 1000),
    timestampKind: 'trade',
    actualTradeAt: Math.floor(d.trade_timestamp / 1000),
    sourceEventTime: Math.floor(d.timestamp / 1000),
    changeBasis: 'rolling24h-minute',
    rangeBasis: 'utc-day',
    referenceAt: null,
  });
  try {
    const reference = (
      (await upstream(
        'https://api.upbit.com/v1/candles/minutes/1?market=KRW-' +
          asset +
          '&count=1&to=' +
          encodeURIComponent(new Date(Math.floor(target / 60) * 60000).toISOString()),
      )) as Record<string, number | string>[]
    )[0];
    const referencePrice = Number(reference?.trade_price);
    const referenceAt = Date.parse(String(reference?.candle_date_time_utc) + 'Z') / 1000;
    quote.referenceAt = Number.isFinite(referenceAt) ? referenceAt : null;
    if (
      !Number.isFinite(referencePrice) ||
      referencePrice <= 0 ||
      !Number.isFinite(referenceAt) ||
      target - referenceAt > 300 ||
      referenceAt + 60 > target
    )
      return quote;
    const change24h = (d.trade_price / referencePrice - 1) * 100;
    if (!Number.isFinite(change24h) || change24h <= -100) return quote;
    return validateQuote({ ...quote, change24h, changeUnavailableReason: undefined });
  } catch {
    return {
      ...quote,
      changeUnavailableReason: '24시간 전 비교 가격을 가져오지 못해 등락률을 표시하지 않습니다.',
    };
  }
}
/** A single ticker request for a bounded group; one bad asset never discards its peers. */
export async function getQuotes(assets: Asset[], market: Market, feed?: FeedConfig) {
  if (!assets.length || assets.length > 8 || new Set(assets).size !== assets.length)
    throw new Error('Invalid quote batch size');
  let rows: Record<string, unknown>[];
  try {
    const raw =
      market === 'binance'
        ? await binanceRequest(
            'ticker.24hr',
            { symbols: assets.map((asset) => asset + 'USDT') },
            feed,
          )
        : await upstream(
            'https://api.upbit.com/v1/ticker?markets=' +
              assets.map((asset) => 'KRW-' + asset).join(','),
          );
    if (!Array.isArray(raw)) throw new Error('Invalid batch ticker response');
    rows = raw;
  } catch (error) {
    return {
      quotes: [] as Quote[],
      errors: assets.map((asset) => ({ asset, error })),
      requestFailed: true,
    };
  }
  const trades = market === 'binance' ? await hubTrades(assets, feed) : [];
  const deadline = Date.now() + 4000;
  const results: Array<{ quote?: Quote; asset?: Asset; error?: unknown }> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: market === 'binance' ? 2 : assets.length }, async () => {
      while (next < assets.length) {
        const index = next++,
          asset = assets[index];
        try {
          const matches = rows.filter((row) =>
            market === 'binance' ? row.symbol === asset + 'USDT' : row.market === 'KRW-' + asset,
          );
          if (matches.length !== 1) throw new Error('Missing or duplicate batch ticker');
          const quote =
            market === 'binance'
              ? binanceQuote(
                  asset,
                  matches[0],
                  await confirmBinanceTrade(asset, matches[0], trades, deadline, feed),
                )
              : await upbitQuote(asset, matches[0] as Record<string, number>);
          results[index] = { quote };
        } catch (error) {
          results[index] = { asset, error };
        }
      }
    }),
  );
  return {
    quotes: results.flatMap((row) => (row.quote ? [row.quote] : [])),
    errors: results.flatMap((row) => (row.asset ? [{ asset: row.asset, error: row.error }] : [])),
    requestFailed: false,
  };
}
export async function getRecentCandles(
  asset: Asset,
  market: Market,
  interval: '1h' | '1d',
  since?: number,
  feed?: FeedConfig,
): Promise<Candle[]> {
  const step = interval === '1h' ? 3600 : DAY;
  let out: Candle[] = [];
  const catching = since !== undefined && Date.now() / 1000 - since > 6 * step;
  const count = catching ? 32 : 8;
  if (market === 'binance') {
    const raw = (await binanceRequest(
      'klines',
      {
        symbol: asset + 'USDT',
        interval,
        limit: count,
        ...(catching ? { startTime: since! * 1000 } : {}),
      },
      feed,
    )) as (string | number)[][];
    if (!Array.isArray(raw)) throw new Error('Invalid candles');
    out = raw.map((r) => ({
      time: Number(r[0]) / 1000,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[0]) / 1000 + step,
      closed: Number(r[0]) / 1000 + step <= Date.now() / 1000,
    }));
  } else {
    const raw = (await upstream(
      'https://api.upbit.com/v1/candles/' +
        (interval === '1h' ? 'minutes/60' : 'days') +
        '?market=KRW-' +
        asset +
        '&count=' +
        count +
        (catching
          ? '&to=' + encodeURIComponent(new Date((since! + count * step) * 1000).toISOString())
          : ''),
    )) as Record<string, number | string>[];
    if (!Array.isArray(raw)) throw new Error('Invalid candles');
    out = raw.map((r) => {
      const t = Date.parse(String(r.candle_date_time_utc) + 'Z') / 1000;
      return {
        time: t,
        open: Number(r.opening_price),
        high: Number(r.high_price),
        low: Number(r.low_price),
        close: Number(r.trade_price),
        volume: Number(r.candle_acc_trade_volume),
        closeTime: t + step,
        closed: t + step <= Date.now() / 1000,
      };
    });
  }
  if (
    !out.length ||
    !out.every(
      (c) =>
        validCandle(c) &&
        Number.isSafeInteger(c.time) &&
        c.time >= 0 &&
        c.time % step === 0 &&
        c.time <= Date.now() / 1000 + 60,
    ) ||
    new Set(out.map((c) => c.time)).size !== out.length
  )
    throw new Error('OHLC validation failed');
  return out.sort((a, b) => a.time - b.time);
}
// Keep the supported WebSocket transport. Public REST returned 403 on the deployed host.
export function binanceRequest(
  method: 'ticker.24hr' | 'klines' | 'trades.aggregate',
  params: Record<string, string | number | string[]>,
  feed?: FeedConfig,
  timeoutMs = 12000,
): Promise<unknown> {
  if (feed?.BINANCE_REQUEST) return feed.BINANCE_REQUEST(method, params, timeoutMs);
  if (feed?.FEED_SERVICE || (feed?.FEED_URL && feed.FEED_TOKEN))
    return feedRequest(
      feed,
      '/binance',
      new URLSearchParams({ method, params: JSON.stringify(params) }),
      timeoutMs,
    );
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('wss://ws-api.binance.com:443/ws-api/v3');
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* A failed handshake may already be closed. */
      }
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Binance WebSocket timeout')), timeoutMs);
    socket.addEventListener('open', () =>
      socket.send(JSON.stringify({ id: 'btc-desk', method, params })),
    );
    socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.id !== 'btc-desk') return;
        if (data.status !== 200)
          finish(
            new Error(
              'Binance API ' + data.status + ': ' + String(data.error?.msg || '').slice(0, 160),
            ),
          );
        else finish(undefined, data.result);
      } catch {
        finish(new Error('Invalid Binance response'));
      }
    });
    socket.addEventListener('error', () =>
      finish(new Error('Binance WebSocket connection failed')),
    );
    socket.addEventListener('close', () => finish(new Error('Binance closed before response')));
  });
}
export interface BitviewBlock {
  version: number;
  start: number;
  end: number;
  data: (number | string | null)[];
  stamp: string;
}
export async function bitviewPage(
  base: string,
  start: string | number,
  limit: number,
): Promise<{
  rows: { time: number; data: Record<string, number | null> }[];
  versions: Record<string, number>;
  next: number;
  finished: boolean;
  raw: BitviewBlock[];
}> {
  const q = new URLSearchParams({
    series: BASE_SERIES.join(','),
    index: 'day1',
    start: String(start),
    limit: String(limit),
  });
  const raw = (await upstream(base + '/api/series/bulk?' + q)) as BitviewBlock[];
  if (!Array.isArray(raw) || raw.length !== BASE_SERIES.length)
    throw new Error('Unexpected Bitview response');
  const first = raw[0];
  if (raw.some((r) => r.start !== first.start || r.data.length !== first.data.length))
    throw new Error('Bitview dates are not aligned');
  const rows = first.data
    .map((date, i) => {
      const t = Date.parse(String(date) + 'T00:00:00Z') / 1000;
      if (!Number.isFinite(t)) throw new Error('Invalid source date');
      const data: Record<string, number | null> = {};
      BASE_SERIES.forEach((key, j) => {
        if (j) {
          const v = raw[j].data[i];
          data[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
        }
      });
      return { time: t, data };
    })
    .filter((r) => r.time + DAY <= Date.now() / 1000);
  if (rows.some((r, i) => i > 0 && r.time - rows[i - 1].time !== DAY))
    throw new Error('Bitview dates contain gaps or duplicates');
  const versions = Object.fromEntries(BASE_SERIES.map((key, i) => [key, raw[i].version]));
  return { rows, versions, next: first.end, finished: first.data.length < limit, raw };
}
