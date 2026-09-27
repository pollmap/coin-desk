export interface FeedConfig {
  FEED_URL?: string;
  FEED_TOKEN?: string;
  FEED_SERVICE?: Fetcher;
}
export async function feedRequest(
  env: FeedConfig,
  path: string,
  params = new URLSearchParams(),
): Promise<unknown> {
  const url = (env.FEED_URL || 'https://internal-feed') + path + (params.size ? '?' + params : '');
  const init: RequestInit = {
    signal: AbortSignal.timeout(15000),
    headers: env.FEED_TOKEN ? { 'X-Feed-Token': env.FEED_TOKEN } : {},
  };
  const response = env.FEED_SERVICE
    ? await env.FEED_SERVICE.fetch(new Request(url, init))
    : await fetch(url, init);
  if (!response.ok) throw new Error('Market feed HTTP ' + response.status);
  return response.json();
}
