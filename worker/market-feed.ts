/** Allowlisted public market-data adapter. A shared token prevents public proxy use. */
const assets = new Set(['BTC', 'DOGE', 'ETH']);
const metrics = new Set(['funding', 'open_interest']);
export default {
  async fetch(request: Request, env: { FEED_TOKEN?: string }) {
    if (!env.FEED_TOKEN || request.headers.get('X-Feed-Token') !== env.FEED_TOKEN)
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    const asset = url.searchParams.get('asset') || '';
    const metric = url.searchParams.get('metric') || '';
    const limit = Number(url.searchParams.get('limit'));
    const endTime = url.searchParams.get('endTime');
    if (
      request.method !== 'GET' || url.pathname !== '/derivatives' ||
      !assets.has(asset) || !metrics.has(metric) ||
      url.searchParams.size !== (endTime === null ? 3 : 4) ||
      !Number.isInteger(limit) || limit < 1 || limit > 200 ||
      (endTime !== null && (!/^\d{13}$/.test(endTime) || Number(endTime) > Date.now() + 60_000))
    ) return Response.json({ error: 'Invalid feed request' }, { status: 400 });
    const params = new URLSearchParams({ category: 'linear', symbol: asset + 'USDT', limit: String(limit) });
    if (metric === 'open_interest') params.set('intervalTime', '1h');
    if (endTime !== null) params.set('endTime', endTime);
    const path = metric === 'funding' ? '/v5/market/funding/history' : '/v5/market/open-interest';
    try {
      const response = await fetch('https://api.bybit.com' + path + '?' + params, {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return Response.json({ error: 'Bybit HTTP ' + response.status }, { status: 502 });
      const body = await response.text();
      if (body.length > 100_000) return Response.json({ error: 'Oversized feed response' }, { status: 502 });
      return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json({ error: 'Feed connection failed' }, { status: 502 });
    }
  },
};
