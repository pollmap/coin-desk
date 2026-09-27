import { beforeEach, afterEach, expect, it, vi } from 'vitest';

let listener: (message: unknown, sender: unknown, reply: (value: any) => void) => void;
let local: Record<string, any>;
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
    tabs: { ...tabs, onUpdated: { addListener: vi.fn() } },
    storage: { local: storage(local), session: storage({}) },
  });
  // @ts-expect-error The packaged MV3 service worker is JavaScript.
  await import('../extension/background.js');
});
afterEach(() => vi.unstubAllGlobals());

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
