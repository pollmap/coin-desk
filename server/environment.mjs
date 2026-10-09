import { ASSET_REGISTRY } from '../server-dist/assets.mjs';
import { randomBytes } from 'node:crypto';
import { memoryCache } from '../scripts/local-db.mjs';

export async function createEnvironment(DB, options = {}) {
  const feed = options.feed ?? (await import('../server-dist/feed.mjs')).default;
  const token = randomBytes(32).toString('hex');
  globalThis.caches = { default: memoryCache() };
  return {
    DB,
    RUNTIME_KIND: 'vps',
    READ_ONLY_API: true,
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
