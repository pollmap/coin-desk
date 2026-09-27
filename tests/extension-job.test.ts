import { beforeEach, afterEach, expect, it, vi } from 'vitest';

let listener: (message: unknown, sender: unknown, reply: (value: any) => void) => void;
let local: Record<string, any>;
let importedRows: any[];
let snapshot: any;
let tabs: {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
};
const sender = { id: 'fixture-extension', tab: { id: 10 }, url: 'https://x.com/analyst' };
const ask = (message: unknown, from: unknown = { id: 'fixture-extension' }) =>
  new Promise<any>((resolve) => listener(message, from, resolve));

beforeEach(async () => {
  vi.resetModules();
  importedRows = [];
  snapshot = undefined;
  local = {
    job: {
      tabId: 10,
      url: 'https://x.com/analyst',
      mode: 'account',
      status: 'running',
      collected: 12,
      lastId: '1234',
      scroll: 800,
      queue: ['https://x.com/next'],
    },
  };
  tabs = {
    create: vi.fn(async () => ({ id: 11 })),
    update: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({ ok: true })),
  };
  const storage = (state: Record<string, any>) => ({
    get: async (key: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(key) ? key : [key]).map((k) => [k, structuredClone(state[k])]),
      ),
    set: async (value: Record<string, any>) => {
      Object.assign(state, structuredClone(value));
    },
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'fixture-extension',
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
    tabs: {
      ...tabs,
      get: async () => ({ url: 'https://coin-desk.pages.dev/workspace/library' }),
      onUpdated: { addListener: vi.fn() },
    },
    permissions: { contains: async () => true },
    storage: {
      local: storage(local),
      session: storage({
        connection: {
          tabId: 20,
          url: 'https://coin-desk.pages.dev/workspace/library',
          nonce: '00000000-0000-4000-a000-000000000001',
          expires: Date.now() + 1800000,
          sequence: 0,
        },
      }),
    },
  });
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: any = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction(store: string) {
            const tx: any = {};
            const result = (value: any, write?: () => void) => {
              const req: any = {};
              queueMicrotask(() => {
                write?.();
                req.result = structuredClone(value);
                req.onsuccess?.();
                tx.oncomplete?.();
              });
              return req;
            };
            tx.objectStore = () => ({
              getAll: () => result(importedRows),
              get: () => result(snapshot),
              put: (v: any) =>
                result(v, () => {
                  if (store === 'transfers') snapshot = structuredClone(v);
                }),
            });
            return tx;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  });
  // @ts-expect-error The packaged MV3 service worker is JavaScript.
  await import('../extension/background.js');
});
afterEach(() => vi.unstubAllGlobals());

it('accepts the trusted extension tab and rejects website commands', async () => {
  expect(await ask({ type: 'STATUS' }, sender)).toHaveProperty('error');
  expect(
    await ask(
      { type: 'STATUS' },
      {
        id: 'fixture-extension',
        tab: { id: 21 },
        url: 'chrome-extension://fixture-extension/popup.html',
      },
    ),
  ).toMatchObject({ stored: 0 });
});

it('records pause before the reader replies and ignores a late completion', async () => {
  tabs.sendMessage.mockImplementation(async () => {
    expect(local.job.status).toBe('paused');
    return { ok: true };
  });
  expect(await ask({ type: 'STOP' })).toEqual({ ok: true });
  await ask({ type: 'DONE', status: 'access-limited', readable: true, reason: 'end' }, sender);
  expect(tabs.update).not.toHaveBeenCalled();
  expect(local.job.lastId).toBe('1234');
  expect(local.job.status).toBe('paused');
});
it('preserves checkpoint and remaining accounts when the old tab is unavailable', async () => {
  tabs.sendMessage.mockRejectedValue(new Error('tab closed'));
  expect(await ask({ type: 'RESUME' })).toEqual({ ok: true });
  expect(local.job).toMatchObject({
    tabId: 11,
    status: 'waiting',
    collected: 12,
    lastId: '1234',
    scroll: 800,
    queue: ['https://x.com/next'],
  });
});
it('keeps source coverage and resets counts only for the next account', async () => {
  await ask(
    { type: 'DONE', status: 'access-limited', readable: true, reason: 'visible range' },
    sender,
  );
  expect(local.coverage['https://x.com/analyst']).toMatchObject({
    collected: 12,
    lastId: '1234',
    status: 'access-limited',
  });
  expect(local.job).toMatchObject({ url: 'https://x.com/next', collected: 0, status: 'waiting' });
  expect(local.job.lastId).toBeUndefined();
});
it('resumes acknowledged row bursts across a stopped popup and freezes the source snapshot', async () => {
  importedRows = Array.from({ length: 650 }, (_, i) => ({
    post_id: String(i + 1),
    text: 'row ' + i,
    images: [],
  }));
  const first = await ask({ type: 'SEND', images: false });
  expect(first).toMatchObject({ more: true, count: 500 });
  await ask({ type: 'STOP' });
  expect(await ask({ type: 'SEND', images: false, continue: true })).toMatchObject({
    paused: true,
    more: false,
  });
  importedRows.push({ post_id: '9999', text: 'collected during transfer', images: [] });
  tabs.sendMessage.mockClear();
  expect(await ask({ type: 'SEND', images: false })).toMatchObject({ ok: true, count: 650 });
  const batches = tabs.sendMessage.mock.calls.filter(([, m]) => m.type === 'TRANSFER');
  expect(batches[0][1].rows[0].post_id).toBe('501');
  expect(batches.flatMap(([, m]) => m.rows)).toHaveLength(150);
  expect(local.transferCheckpoint.status).toBe('complete');
});
it('does not advance a failed image and resumes from its durable checkpoint', async () => {
  importedRows = [
    {
      post_id: '123',
      text: 'image test',
      images: [
        { url: 'https://pbs.twimg.com/media/a.png' },
        { url: 'https://pbs.twimg.com/media/b.png' },
      ],
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    ),
  );
  tabs.sendMessage.mockImplementation(async (_id, m) => {
    if (m.type === 'TRANSFER_MEDIA' && m.key === 'x:123:1') throw new Error('tab suspended');
    return { ok: true };
  });
  expect(await ask({ type: 'SEND', images: true })).toMatchObject({ error: 'tab suspended' });
  expect(local.transferCheckpoint).toMatchObject({ rowOffset: 1, mediaIndex: 1, images: 1 });
  tabs.sendMessage.mockReset().mockResolvedValue({ ok: true });
  expect(await ask({ type: 'SEND', images: true })).toMatchObject({
    ok: true,
    images: 2,
    failed: 0,
  });
  expect(
    tabs.sendMessage.mock.calls
      .filter(([, m]) => m.type === 'TRANSFER_MEDIA')
      .map(([, m]) => m.key),
  ).toEqual(['x:123:1']);
});
