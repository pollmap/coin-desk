/** Optional cutover adapter: retain the old browser origin without any D1 writer. */
interface GatewayEnv {
  ASSETS: Fetcher;
  VPS_BASE_URL: string;
}
const unavailable = () =>
  new Response(
    JSON.stringify({
      error: '이전한 서버 연결이 지연되고 있습니다.',
      code: 'UPSTREAM_UNAVAILABLE',
    }),
    {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
export default {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response('Read-only API', { status: 405 });
    if (!incoming.pathname.startsWith('/api/v1/') || request.url.length > 2048)
      return new Response('Invalid API request', { status: 400 });
    try {
      const origin = new URL(env.VPS_BASE_URL);
      if (
        origin.protocol !== 'https:' ||
        origin.username ||
        origin.password ||
        origin.port ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash
      )
        return unavailable();
      const target = new URL(incoming.pathname + incoming.search, origin);
      // Browser cookies, authorization, Origin, and personal headers never cross the migration bridge.
      const response = await fetch(target, {
        method: request.method,
        headers: { accept: 'application/json', 'user-agent': 'Coin-Desk-owned-origin-bridge/1.0' },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      const headers = new Headers(response.headers);
      headers.delete('set-cookie');
      headers.delete('access-control-allow-origin');
      headers.set('x-content-type-options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return unavailable();
    }
  },
};
