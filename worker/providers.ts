import type { Asset, Candle, Market, Quote } from '../shared/types';
import { BASE_SERIES } from '../shared/catalog';
import { DAY, validCandle } from '../shared/math';
export async function upstream(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'BTCDesk/0.1 (public market data dashboard)',
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
export async function getQuote(asset: Asset, market: Market): Promise<Quote> {
  if (market === 'binance') {
    const d = (await binanceRequest('ticker.24hr', { symbol: asset + 'USDT' })) as Record<
      string,
      string | number
    >;
    const q = {
      asset,
      price: Number(d.lastPrice),
      change24h: Number(d.priceChangePercent),
      volume24h: Number(d.quoteVolume),
      high24h: Number(d.highPrice),
      low24h: Number(d.lowPrice),
      time: Math.floor(Number(d.closeTime) / 1000),
      changeBasis: 'rolling24h' as const,
    };
    if (
      ![q.price, q.change24h, q.volume24h, q.high24h, q.low24h, q.time].every(Number.isFinite) ||
      q.price <= 0
    )
      throw new Error('Invalid quote');
    return q;
  }
  const d = (
    (await upstream('https://api.upbit.com/v1/ticker?markets=KRW-' + asset)) as Record<
      string,
      number
    >[]
  )[0];
  if (!d || !Number.isFinite(d.trade_price) || d.trade_price <= 0) throw new Error('Invalid quote');
  const target = Math.floor(d.timestamp / 1000) - DAY;
  const reference = (
    (await upstream(
      'https://api.upbit.com/v1/candles/minutes/1?market=KRW-' +
        asset +
        '&count=1&to=' +
        encodeURIComponent(new Date(target * 1000).toISOString()),
    )) as Record<string, number | string>[]
  )[0];
  const referencePrice = Number(reference?.trade_price),
    referenceAt = Date.parse(String(reference?.candle_date_time_utc) + 'Z') / 1000;
  if (
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    !Number.isFinite(referenceAt) ||
    target - referenceAt > 300 ||
    referenceAt > target
  )
    throw new Error('24h reference minute unavailable');
  return {
    asset,
    price: d.trade_price,
    change24h: (d.trade_price / referencePrice - 1) * 100,
    volume24h: d.acc_trade_price_24h,
    high24h: d.high_price,
    low24h: d.low_price,
    time: Math.floor(d.timestamp / 1000),
    changeBasis: 'rolling24h-minute',
    referenceAt,
  };
}
export async function getRecentCandles(
  asset: Asset,
  market: Market,
  interval: '1h' | '1d',
  since?: number,
): Promise<Candle[]> {
  const step = interval === '1h' ? 3600 : DAY;
  let out: Candle[] = [];
  const catching = since !== undefined && Date.now() / 1000 - since > 6 * step;
  const count = catching ? 32 : 8;
  if (market === 'binance') {
    const raw = (await binanceRequest('klines', {
      symbol: asset + 'USDT',
      interval,
      limit: count,
      ...(catching ? { startTime: since! * 1000 } : {}),
    })) as (string | number)[][];
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
  if (!out.length || !out.every(validCandle) || new Set(out.map((c) => c.time)).size !== out.length)
    throw new Error('OHLC validation failed');
  return out.sort((a, b) => a.time - b.time);
}
// Binance's public WebSocket API uses the same exchange data and requires no key.
// Each job opens one bounded request and closes the connection after its response.
export function binanceRequest(
  method: 'ticker.24hr' | 'klines',
  params: Record<string, string | number>,
): Promise<unknown> {
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
    const timer = setTimeout(() => finish(new Error('Binance WebSocket timeout')), 12000);
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
