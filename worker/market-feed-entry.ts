import { WorkerEntrypoint } from 'cloudflare:workers';
import feed from './market-feed';
export default feed;
/** Account-scoped Service binding only. The public handler still requires its token. */
export class InternalFeed extends WorkerEntrypoint<{ FEED_TOKEN: string }> {
  async fetch(request: Request) {
    const headers = new Headers(request.headers);
    headers.set('X-Feed-Token', this.env.FEED_TOKEN);
    return feed.fetch(new Request(request, { headers }), this.env);
  }
}
