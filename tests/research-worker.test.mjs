import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import { refreshResearch, researchFeed } from '../worker/research';
import { putState } from '../worker/storage';
import worker from '../worker/index';
let DB, env, upstream;
const now = 1800000000;
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  DB = openDatabase(':memory:');
  env = {
    DB,
    X_BEARER_TOKEN: 'test-secret-do-not-publish',
    X_COLLECTION_ENABLED: '1',
    X_MAX_REQUESTS_PER_DAY: '1',
  };
  globalThis.caches = { default: memoryCache() };
  upstream = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          meta: { result_count: 1 },
          includes: { users: [{ id: '7', username: 'CW8900' }] },
          data: [
            {
              id: '123456',
              author_id: '7',
              created_at: new Date((now - 60) * 1000).toISOString(),
              text: 'DOGE',
            },
          ],
        }),
      ),
  );
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => {
  DB.sqlite.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('only cron collects; concurrent ticks and a later same-day call respect the cap', async () => {
  await Promise.all([refreshResearch(env), refreshResearch(env)]);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(String(upstream.mock.calls[0][0])).toContain('/2/lists/1940844025483088368/tweets');
  expect(upstream.mock.calls[0][1].redirect).toBe('error');
  vi.spyOn(Date, 'now').mockReturnValue((now + 3601) * 1000);
  await refreshResearch(env);
  expect(upstream).toHaveBeenCalledTimes(1);
  const output = await worker.fetch(new Request('https://desk.test/api/v1/research'), env, {
    waitUntil: () => {},
  });
  expect(output.status).toBe(200);
  const data = await output.json();
  expect(data.state).toBe('ready');
  expect(data.posts[0].url).toBe('https://x.com/CW8900/status/123456');
  expect(JSON.stringify(data)).not.toContain('test-secret');
  expect(upstream).toHaveBeenCalledTimes(1);
});
it('reserves the request budget even when X returns an error, without leaking its body', async () => {
  upstream.mockResolvedValue(new Response('token=test-secret-do-not-publish', { status: 401 }));
  await refreshResearch(env);
  const data = await researchFeed(env);
  expect(data.state).toBe('error');
  expect(JSON.stringify(data)).not.toContain('test-secret');
  vi.spyOn(Date, 'now').mockReturnValue((now + 3601) * 1000);
  await refreshResearch(env);
  expect(upstream).toHaveBeenCalledTimes(1);
});
it('hides metadata older than 24h and rejects public user-supplied collector URLs', async () => {
  await putState(DB, 'research:x-list:v1', {
    state: 'ready',
    fetchedAt: now - 86401,
    posts: [{ url: 'old' }],
  });
  expect(await researchFeed(env)).toMatchObject({ state: 'error', posts: [] });
  const output = await worker.fetch(
    new Request('https://desk.test/api/v1/research?url=https://example.org'),
    env,
    { waitUntil: () => {} },
  );
  expect(output.status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});
