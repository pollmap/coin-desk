import { afterEach, expect, it, vi } from 'vitest';
import gateway from '../worker/vps-gateway';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('keeps SSE alive after the header deadline and propagates client disconnect', async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const fetcher = vi.fn(
    async () => new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  const client = new AbortController();
  const response = await gateway.fetch(
    new Request('https://coin-desk.pages.dev/api/v1/quotes/stream?market=upbit', {
      signal: client.signal,
    }),
    {
      VPS_BASE_URL: 'https://coin-desk.example.org/',
      ASSETS: {} as Fetcher,
    },
  );
  const [, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  await vi.advanceTimersByTimeAsync(20000);
  expect(options.signal?.aborted).toBe(false);
  expect(await response.text()).toContain('data: {}');
  client.abort();
  expect(options.signal?.aborted).toBe(true);
});
it('Bridge keeps the old browser origin and never forwards credentials or private headers', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response('{"data":[]}', {
        headers: { 'set-cookie': 'private=value', 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const response = await gateway.fetch(
    new Request('https://coin-desk.pages.dev/api/v1/network?asset=BTC&metric=mvrv', {
      headers: { cookie: 'secret', authorization: 'Bearer secret', 'x-personal-note': 'private' },
    }),
    {
      VPS_BASE_URL: 'https://coin-desk.example.org/',
      ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.has('set-cookie')).toBe(false);
  const [target, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(target.origin).toBe('https://coin-desk.example.org');
  expect(new Headers(options.headers).has('cookie')).toBe(false);
  expect(new Headers(options.headers).has('authorization')).toBe(false);
  expect(new Headers(options.headers).has('x-personal-note')).toBe(false);
});
it('Invalid/unconfigured target fails visibly and static help remains on the old origin', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const ASSETS = { fetch: vi.fn(async () => new Response('help')) } as unknown as Fetcher;
  for (const target of [
    '',
    'http://127.0.0.1/',
    'https://name:4430/',
    'https://user:password@example.org/',
  ])
    expect(
      (
        await gateway.fetch(new Request('https://coin-desk.pages.dev/api/v1/status'), {
          VPS_BASE_URL: target,
          ASSETS,
        })
      ).status,
    ).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await (
      await gateway.fetch(new Request('https://coin-desk.pages.dev/learn'), {
        VPS_BASE_URL: '',
        ASSETS,
      })
    ).text(),
  ).toBe('help');
});
it('Bridge failure does not fall back to legacy collection and refuses writes', async () => {
  const fetcher = vi.fn(async () => {
    throw Error('private upstream detail');
  });
  vi.stubGlobal('fetch', fetcher);
  const env = { VPS_BASE_URL: 'https://coin-desk.example.org/', ASSETS: {} as Fetcher };
  const response = await gateway.fetch(
    new Request('https://coin-desk.pages.dev/api/v1/status'),
    env,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private upstream detail');
  expect(
    (
      await gateway.fetch(
        new Request('https://coin-desk.pages.dev/api/v1/status', { method: 'POST' }),
        env,
      )
    ).status,
  ).toBe(405);
});
