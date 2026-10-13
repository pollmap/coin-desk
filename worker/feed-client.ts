import type { Asset } from '../shared/types';
export interface QuoteTradeEvidence {
  asset: Asset;
  market: 'binance';
  price: number;
  tradedAt: number;
  lastTradeId: number;
}
export interface FeedConfig {
  FEED_URL?: string;
  FEED_TOKEN?: string;
  FEED_SERVICE?: Fetcher;
  QUOTE_TRADES?: (assets: Asset[]) => Promise<QuoteTradeEvidence[]>;
  BINANCE_REQUEST?: (
    method: 'ticker.24hr' | 'klines' | 'trades.aggregate',
    params: Record<string, string | number | string[]>,
    timeoutMs: number,
  ) => Promise<unknown>;
}
export async function feedRequest(
  env: FeedConfig,
  path: string,
  params = new URLSearchParams(),
  timeoutMs = 15000,
): Promise<unknown> {
  const url = (env.FEED_URL || 'https://internal-feed') + path + (params.size ? '?' + params : '');
  const init: RequestInit = {
    signal: AbortSignal.timeout(timeoutMs),
    headers: env.FEED_TOKEN ? { 'X-Feed-Token': env.FEED_TOKEN } : {},
  };
  const response = env.FEED_SERVICE
    ? await env.FEED_SERVICE.fetch(new Request(url, init))
    : await fetch(url, init);
  if (!response.ok) throw new Error('Market feed HTTP ' + response.status);
  return response.json();
}
