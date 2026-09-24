export interface FeedConfig {
  FEED_URL?: string;
  FEED_TOKEN?: string;
}
export async function feedRequest(
  env: FeedConfig,
  path: string,
  params = new URLSearchParams(),
): Promise<unknown> {
  const response = await fetch(env.FEED_URL + path + (params.size ? '?' + params : ''), {
    signal: AbortSignal.timeout(15000),
    headers: { 'X-Feed-Token': env.FEED_TOKEN! },
  });
  if (!response.ok) throw new Error('Market feed HTTP ' + response.status);
  return response.json();
}
