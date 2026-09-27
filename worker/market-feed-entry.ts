import { WorkerEntrypoint } from 'cloudflare:workers';
import feed from './market-feed';
export default feed;
/** Account-scoped Service binding only. The public handler still requires its token. */
export class InternalFeed extends WorkerEntrypoint<{ FEED_TOKEN: string; PLACED_FEED: Fetcher }> {
  async fetch(request: Request) {
    const headers = new Headers(request.headers);
    headers.set('X-Feed-Token', this.env.FEED_TOKEN);
    // Named entrypoints ignore placement. Enter the default HTTP handler through
    // its Service binding so the configured Seoul placement actually applies.
    return this.env.PLACED_FEED.fetch(new Request(request, { headers }));
  }
}
