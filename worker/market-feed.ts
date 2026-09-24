import { DERIVATIVE_ASSETS, derivativeContract } from '../shared/derivative-contracts';
import type { Asset } from '../shared/types';
/** Allowlisted public market-data adapter. A shared token prevents public proxy use. */
import { binanceRequest, upstream } from './providers';
const spotSymbols = new Set(
  ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE'].map((asset) => asset + 'USDT'),
);
export function validSpotRequest(method: string, params: Record<string, unknown>) {
  if (method === 'ticker.24hr') {
    const symbols = params.symbol ? [params.symbol] : params.symbols;
    return (
      Object.keys(params).length === 1 &&
      Array.isArray(symbols) &&
      symbols.length > 0 &&
      symbols.length <= 8 &&
      new Set(symbols).size === symbols.length &&
      symbols.every((symbol) => typeof symbol === 'string' && spotSymbols.has(symbol))
    );
  }
  return (
    method === 'klines' &&
    Object.keys(params).every((key) =>
      ['symbol', 'interval', 'limit', 'startTime'].includes(key),
    ) &&
    typeof params.symbol === 'string' &&
    spotSymbols.has(params.symbol) &&
    ['1h', '1d'].includes(String(params.interval)) &&
    Number.isInteger(params.limit) &&
    Number(params.limit) >= 1 &&
    Number(params.limit) <= 32 &&
    (params.startTime === undefined ||
      (Number.isSafeInteger(params.startTime) &&
        Number(params.startTime) >= 0 &&
        Number(params.startTime) <= Date.now()))
  );
}
const assets = new Set<string>(DERIVATIVE_ASSETS);
const metrics = new Set([
  'funding',
  'open_interest',
  'long_account_ratio',
  'open_interest_daily',
  'long_account_ratio_daily',
]);
export default {
  async fetch(request: Request, env: { FEED_TOKEN?: string }) {
    if (!env.FEED_TOKEN || request.headers.get('X-Feed-Token') !== env.FEED_TOKEN)
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/binance') {
      try {
        const method = url.searchParams.get('method') || '';
        const encoded = url.searchParams.get('params') || '';
        if (encoded.length > 1000 || url.searchParams.size !== 2)
          return Response.json({ error: 'Invalid feed request' }, { status: 400 });
        const params = JSON.parse(encoded) as Record<string, string | number | string[]>;
        if (
          !params ||
          Array.isArray(params) ||
          typeof params !== 'object' ||
          !validSpotRequest(method, params)
        )
          return Response.json({ error: 'Invalid feed request' }, { status: 400 });
        return Response.json(await binanceRequest(method as 'ticker.24hr' | 'klines', params), {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof SyntaxError ? 'Invalid feed request' : 'Binance connection failed',
          },
          { status: error instanceof SyntaxError ? 400 : 502 },
        );
      }
    }
    if (request.method === 'GET' && url.pathname === '/mempool' && url.searchParams.size === 0) {
      try {
        const [pool, fees] = await Promise.all([
          upstream('https://mempool.space/api/mempool'),
          upstream('https://mempool.space/api/v1/fees/recommended'),
        ]);
        return Response.json({ pool, fees }, { headers: { 'Cache-Control': 'no-store' } });
      } catch {
        return Response.json({ error: 'Mempool connection failed' }, { status: 502 });
      }
    }
    const asset = url.searchParams.get('asset') || '';
    const metric = url.searchParams.get('metric') || '';
    const limit = Number(url.searchParams.get('limit'));
    const endTime = url.searchParams.get('endTime');
    if (
      request.method !== 'GET' ||
      url.pathname !== '/derivatives' ||
      !assets.has(asset) ||
      !metrics.has(metric) ||
      url.searchParams.size !== (endTime === null ? 3 : 4) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      (endTime !== null && (!/^\d{13}$/.test(endTime) || Number(endTime) > Date.now() + 60_000))
    )
      return Response.json({ error: 'Invalid feed request' }, { status: 400 });
    const params = new URLSearchParams({
      category: 'linear',
      symbol: derivativeContract(asset as Asset).symbol,
      limit: String(limit),
    });
    const kind = metric.replace('_daily', '');
    const interval = metric.endsWith('_daily') ? '1d' : '1h';
    if (kind === 'open_interest') params.set('intervalTime', interval);
    if (kind === 'long_account_ratio') params.set('period', interval);
    if (endTime !== null) params.set('endTime', endTime);
    const path =
      kind === 'funding'
        ? '/v5/market/funding/history'
        : kind === 'open_interest'
          ? '/v5/market/open-interest'
          : '/v5/market/account-ratio';
    try {
      const response = await fetch('https://api.bybit.com' + path + '?' + params, {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok)
        return Response.json({ error: 'Bybit HTTP ' + response.status }, { status: 502 });
      const body = await response.text();
      if (body.length > 100_000)
        return Response.json({ error: 'Oversized feed response' }, { status: 502 });
      return new Response(body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch {
      return Response.json({ error: 'Feed connection failed' }, { status: 502 });
    }
  },
};
