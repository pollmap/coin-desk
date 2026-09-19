import { afterEach, expect, it, vi } from 'vitest';
import { json } from '../src/lib';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function pendingFetch() {
  const received: AbortSignal[] = [];
  const fetcher = vi.fn((_url: string, init: RequestInit) => {
    const signal = init.signal!;
    received.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, received };
}

it('returns the actual successful JSON payload and removes timeout/listener resources', async () => {
  vi.useFakeTimers();
  const external = new AbortController();
  const remove = vi.spyOn(external.signal, 'removeEventListener');
  const payload = { data: [{ time: 123, value: 0.1234 }], meta: { stale: false } };
  const fetcher = vi.fn(async () => Response.json(payload));
  vi.stubGlobal('fetch', fetcher);
  expect(await json('/api/v1/series', external.signal)).toEqual(payload);
  expect(fetcher).toHaveBeenCalledWith('/api/v1/series', { signal: expect.any(AbortSignal) });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it.each([200, 502])(
  'an HTML fallback with HTTP %i becomes an actionable data-server error',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>SPA fallback</html>', {
            status,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    );
    await expect(json('/api/v1/overview')).rejects.toThrow(
      '데이터 서버 응답을 확인할 수 없습니다.',
    );
  },
);

it('a non-JSON 429 is identified as throttling rather than an HTML parsing failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('rate limited', { status: 429 })),
  );
  await expect(json('/api/v1/overview')).rejects.toThrow('요청이 많습니다.');
});

it('a JSON 429 preserves a bounded server explanation', async () => {
  const explanation = '혼잡으로 재시도해 주세요. '.repeat(40);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: explanation }, { status: 429 })),
  );
  const error = await json('/api/v1/overview').catch((reason: Error) => reason);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(explanation.slice(0, 250));
});

it.each(['<html>proxy error</html>', '{"data":'])(
  'malformed JSON is explained without exposing parser/body fragments',
  async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } })),
    );
    await expect(json('/api/v1/status')).rejects.toThrow(
      '데이터 서버의 JSON 응답이 손상되었습니다.',
    );
  },
);

it('a hung request is aborted at 20 seconds and receives the timeout explanation', async () => {
  vi.useFakeTimers();
  const { received } = pendingFetch();
  const result = json('/api/v1/candles').catch((reason: Error) => reason);
  await vi.advanceTimersByTimeAsync(19999);
  expect(received[0].aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const error = await result;
  expect(received[0].aborted).toBe(true);
  expect((error as Error).message).toContain('응답이 20초를 넘었습니다.');
  expect(vi.getTimerCount()).toBe(0);
});

it('navigation cancellation aborts the underlying fetch without being mislabeled as timeout', async () => {
  vi.useFakeTimers();
  const external = new AbortController();
  const remove = vi.spyOn(external.signal, 'removeEventListener');
  const { received } = pendingFetch();
  const result = json('/api/v1/candles', external.signal).catch((reason: Error) => reason);
  await vi.advanceTimersByTimeAsync(500);
  external.abort();
  const error = await result;
  expect(received[0].aborted).toBe(true);
  expect((error as Error).name).toBe('AbortError');
  expect((error as Error).message).not.toContain('20초');
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('an already-cancelled caller passes an aborted signal to fetch and cleans up immediately', async () => {
  vi.useFakeTimers();
  const external = new AbortController();
  external.abort();
  const { received } = pendingFetch();
  await expect(json('/api/v1/candles', external.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(received[0].aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['caller', 'deadline'])(
  '%s cancellation during body download is not mislabeled as corrupt JSON',
  async (cause) => {
    vi.useFakeTimers();
    const external = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init: RequestInit) =>
          new Response(
            new ReadableStream({
              start(stream) {
                init.signal!.addEventListener('abort', () => stream.error(init.signal!.reason), {
                  once: true,
                });
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    const result = json('/api/v1/candles', external.signal).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(1);
    if (cause === 'caller') external.abort();
    else await vi.advanceTimersByTimeAsync(20000);
    const error = (await result) as Error;
    if (cause === 'caller') expect(error.name).toBe('AbortError');
    else expect(error.message).toContain('응답이 20초를 넘었습니다.');
    expect(error.message).not.toContain('손상');
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each([null, 12, 'OK'])(
  'a successful primitive JSON %j is rejected instead of entering chart state',
  async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(body)),
    );
    await expect(json('/api/v1/candles')).rejects.toThrow('올바른 데이터 응답이 아닙니다.');
  },
);
