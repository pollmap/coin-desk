import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
// @ts-expect-error The local SQLite adapter is JavaScript-only.
import { openDatabase } from '../scripts/local-db.mjs';
import { updateReference } from '../worker/reference-price';
import { DAY } from '../shared/math';
import type { Env } from '../worker/storage';

vi.mock('../worker/providers', () => ({ upstream: vi.fn() }));
import { upstream } from '../worker/providers';

let db: D1Database & { sqlite: DatabaseSync }, env: Env;
const now = Date.UTC(2026, 8, 20) / 1000;
const observation = (time: number, price: string | null = null) => ({
  asset: 'btc',
  time: new Date(time * 1000).toISOString(),
  PriceUSD: price,
});
const state = () => db.sqlite.prepare("SELECT * FROM ingestion WHERE key='reference:BTC'").get();
const checkpoint = () =>
  db.sqlite.prepare("SELECT value FROM state WHERE key='reference-progress:BTC'").get();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now * 1000);
  db = openDatabase(':memory:');
  env = {
    DB: db,
    ENABLED_ASSETS: 'BTC',
    BITVIEW_BASE_URL: '',
    ASSETS: { fetch: vi.fn() },
  } as unknown as Env;
});
afterEach(() => {
  db.sqlite.close();
  vi.resetAllMocks();
  vi.useRealTimers();
});

it('crosses two null-only pages by source date without inventing prices or fetching opaque token URLs', async () => {
  const previous = now - 63 * DAY,
    from = previous - 2 * DAY;
  db.sqlite
    .prepare('INSERT INTO reference_prices VALUES(?,?,?,?)')
    .run('BTC', previous, 100, now - DAY);
  const token = 'https://untrusted.example/not-an-authorized-source';
  vi.mocked(upstream)
    .mockResolvedValueOnce({
      data: Array.from({ length: 32 }, (_, i) => observation(from + i * DAY)),
      next_page_token: token,
    })
    .mockResolvedValueOnce({
      data: Array.from({ length: 32 }, (_, i) => observation(from + (i + 32) * DAY)),
      next_page_token: 'opaque-next',
    })
    .mockResolvedValueOnce({ data: [observation(now - DAY, '120')] });
  await updateReference(env, 'BTC');
  expect(state()).toMatchObject({ data_as_of: previous, next_attempt: now + 60 });
  expect(JSON.parse(checkpoint()!.value as string)).toMatchObject({
    cursor: from + 32 * DAY,
    nextPageToken: token,
  });
  await updateReference(env, 'BTC');
  expect(state()).toMatchObject({ data_as_of: previous });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM reference_prices').get()!.n).toBe(1);
  await updateReference(env, 'BTC');
  expect(state()).toMatchObject({ data_as_of: now - DAY, next_attempt: 0 });
  expect(checkpoint()).toBeUndefined();
  const urls = vi.mocked(upstream).mock.calls.map(([url]) => new URL(url));
  expect(urls.every((url) => url.origin === 'https://community-api.coinmetrics.io')).toBe(true);
  expect(urls.map((url) => Date.parse(url.searchParams.get('start_time')!) / 1000)).toEqual([
    from,
    from + 32 * DAY,
    from + 64 * DAY,
  ]);
  vi.mocked(upstream).mockResolvedValueOnce({ data: [observation(now - DAY, '121')] });
  await updateReference(env, 'BTC');
  expect(new URL(vi.mocked(upstream).mock.calls[3][0]).searchParams.get('start_time')).toBe(
    new Date((now - 3 * DAY) * 1000).toISOString(),
  );
});

it('an initial null-only page records resumable progress while the actual price date remains missing', async () => {
  const first = Date.UTC(2009, 0, 1) / 1000;
  vi.mocked(upstream).mockResolvedValue({
    data: Array.from({ length: 32 }, (_, i) => observation(first + i * DAY)),
  });
  await updateReference(env, 'BTC');
  expect(state()).toMatchObject({ data_as_of: null, next_attempt: now + 60 });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM reference_prices').get()!.n).toBe(0);
  expect(JSON.parse(checkpoint()!.value as string).cursor).toBe(first + 32 * DAY);
});

it('a failed checkpoint write rolls back prices, raw samples, and ingestion together', async () => {
  const first = Date.UTC(2009, 0, 1) / 1000;
  vi.mocked(upstream).mockResolvedValue({
    data: Array.from({ length: 32 }, (_, i) => observation(first + i * DAY, '1')),
  });
  db.sqlite.exec(
    "CREATE TRIGGER reject_checkpoint BEFORE INSERT ON state BEGIN SELECT RAISE(ABORT,'checkpoint unavailable'); END;",
  );
  await expect(updateReference(env, 'BTC')).rejects.toThrow('checkpoint unavailable');
  for (const table of ['reference_prices', 'raw_samples', 'ingestion', 'state'])
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM ' + table).get()!.n).toBe(0);
});
