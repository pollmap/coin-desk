import { ASSET_REGISTRY } from '../server-dist/assets.mjs';
import { randomBytes } from 'node:crypto';
import { memoryCache } from '../scripts/local-db.mjs';
import { dirname } from 'node:path';
import { historyCapacity } from './history-capacity.mjs';
import { publicBinanceSession } from './binance-session.mjs';

/** Private, selected-asset proof read; arbitrary remote hosts are never accepted. */
export function quoteTradeReader(base, fetcher = fetch) {
  if (!base) return undefined;
  const url = new URL(base);
  if (
    url.protocol !== 'http:' ||
    !['quote-hub', '127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Quote proof hub must use the private service or loopback address');
  return async (assets) => {
    if (
      !Array.isArray(assets) ||
      !assets.length ||
      assets.length > 8 ||
      new Set(assets).size !== assets.length ||
      assets.some((id) => !ASSET_REGISTRY.find((a) => a.id === id)?.markets.binance)
    )
      throw new Error('Invalid quote proof assets');
    const endpoint = new URL('/snapshot', url);
    endpoint.search = new URLSearchParams({
      market: 'binance',
      assets: assets.join(','),
    }).toString();
    const response = await fetcher(endpoint, { signal: AbortSignal.timeout(500) });
    if (!response.ok) throw new Error('Quote trade proof unavailable');
    const text = await response.text();
    if (text.length > 131072) throw new Error('Quote trade proof exceeds limit');
    const body = JSON.parse(text);
    if (
      body.market !== 'binance' ||
      !Array.isArray(body.trades) ||
      body.trades.length > assets.length * 64
    )
      throw new Error('Invalid quote trade proof');
    return body.trades.filter((t) => t.market === 'binance' && assets.includes(t.asset));
  };
}

export async function createEnvironment(DB, options = {}) {
  const feed = options.feed ?? (await import('../server-dist/feed.mjs')).default;
  const token = randomBytes(32).toString('hex');
  globalThis.caches = { default: memoryCache() };
  return {
    DB,
    RUNTIME_KIND: 'vps',
    READ_ONLY_API: true,
    QUOTE_TRADES: quoteTradeReader(options.quoteHubUrl ?? process.env.COIN_DESK_QUOTE_HUB),
    BINANCE_REQUEST: (options.binanceSession ?? publicBinanceSession).request,
    HISTORY_ALLOWED: historyCapacity(
      dirname(process.env.COIN_DESK_DB || '/app/data/coin-desk.sqlite'),
    ),
    BITVIEW_BASE_URL: process.env.BITVIEW_BASE_URL || 'https://bitview.space',
    ENABLED_ASSETS: process.env.ENABLED_ASSETS || ASSET_REGISTRY.map((a) => a.id).join(','),
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    // Private in-process binding; no public proxy route, Cloudflare URL or token.
    FEED_SERVICE: {
      fetch(request) {
        const headers = new Headers(request.headers);
        headers.set('X-Feed-Token', token);
        return feed.fetch(new Request(request, { headers }), { FEED_TOKEN: token });
      },
    },
  };
}
