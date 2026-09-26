import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript-only SQLite adapter.
import { openDatabase } from '../scripts/local-db.mjs';
import {
  reserveDerivativeBackfill,
  DERIVATIVE_BACKFILL_DAILY_ROWS as LIMIT,
} from '../worker/backfill-budget';
import { updateDerivatives } from '../worker/derivatives';
import type { Env } from '../worker/storage';
import { DAY } from '../shared/math';
let db: ReturnType<typeof openDatabase>;
const now = Date.UTC(2026, 8, 26) / 1000;
beforeEach(() => {
  db = openDatabase(':memory:');
  vi.useFakeTimers();
  vi.setSystemTime(now * 1000);
});
afterEach(() => {
  db.sqlite.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('shares a bounded atomic reservation and resets at UTC midnight', async () => {
  expect(await reserveDerivativeBackfill(db, LIMIT - 200, now)).toBe(true);
  const results = await Promise.all([
    reserveDerivativeBackfill(db, 200, now),
    reserveDerivativeBackfill(db, 200, now),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await reserveDerivativeBackfill(db, 200, now + DAY)).toBe(true);
  const state = JSON.parse(
    db.sqlite.prepare("SELECT value FROM state WHERE key='budget:derivatives-backfill'").get()
      .value,
  );
  expect(state.reserved).toBe(200);
  expect(state.day).toBe(Math.floor(now / DAY) + 1);
});
it('defers backfills without advancing their cursor, while recent funding still refreshes', async () => {
  await reserveDerivativeBackfill(db, LIMIT, now);
  db.sqlite
    .prepare('INSERT INTO derivative_series VALUES(?,?,?,?,?)')
    .run('BTC', 'funding', now - 8 * 3600, 0.01, now);
  db.sqlite
    .prepare('INSERT INTO state VALUES(?,?)')
    .run('cursor:derivatives:BTC:funding', String((now - 16 * 3600) * 1000));
  const fetcher = vi.fn(async () =>
    Response.json({
      retCode: 0,
      result: {
        category: 'linear',
        list: [
          { symbol: 'BTCUSDT', fundingRateTimestamp: String(now * 1000), fundingRate: '0.0002' },
        ],
      },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const env = { DB: db } as Env;
  await updateDerivatives(env, 'BTC', 'funding');
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    db.sqlite
      .prepare("SELECT next_attempt FROM ingestion WHERE key='derivatives:BTC:funding'")
      .get().next_attempt,
  ).toBe(now + DAY);
  const cursor = db.sqlite
    .prepare("SELECT value FROM state WHERE key='cursor:derivatives:BTC:funding'")
    .get().value;
  await updateDerivatives(env, 'BTC', 'funding', true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    db.sqlite.prepare("SELECT MAX(time) AS t FROM derivative_series WHERE asset='BTC'").get().t,
  ).toBe(now);
  expect(
    db.sqlite.prepare("SELECT value FROM state WHERE key='cursor:derivatives:BTC:funding'").get()
      .value,
  ).toBe(cursor);
});
