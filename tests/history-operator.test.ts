import { beforeEach, afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript-only SQLite adapter.
import { openDatabase } from '../scripts/local-db.mjs';
import { reserveDerivativeBackfill, derivativeBackfillLimit } from '../worker/backfill-budget';
import { updateDerivatives } from '../worker/derivatives';
import { claimRefresh, type Env } from '../worker/storage';
import {
  claimOperatorLease,
  renewOperatorLease,
  releaseOperatorLease,
  runDerivativeHistoryPage,
  derivativeHistoryInventory,
  historyPartitions,
} from '../worker/history-operator';

let db: ReturnType<typeof openDatabase>;
const now = Date.UTC(2026, 9, 15) / 1000;
const grant = () => ({
  kind: 'operator-recovery-v1' as const,
  id: 'recovery-20261015',
  issuedAt: now,
  expiresAt: now + 3600,
  dailyRows: 10400,
});
const environment = () =>
  ({
    DB: db,
    RUNTIME_KIND: 'vps',
    READ_ONLY_API: false,
    HISTORY_ALLOWED: () => true,
    DERIVATIVE_HISTORY_GRANT: grant(),
  }) as Env;
const state = (key: string) => {
  const value = db.sqlite.prepare('SELECT value FROM state WHERE key=?').get(key)?.value;
  return value ? JSON.parse(value) : null;
};
const funding = (times: number[]) => ({
  retCode: 0,
  result: {
    category: 'linear',
    list: times.map((time) => ({
      symbol: 'BTCUSDT',
      fundingRateTimestamp: String(time * 1000),
      fundingRate: '0.0001',
    })),
  },
});
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

it('explicit quota adds to the existing exhausted budget atomically and normal runs remain capped', async () => {
  await reserveDerivativeBackfill(db, 10000, now);
  const env = environment();
  const results = await Promise.all([
    reserveDerivativeBackfill(db, 200, now, env),
    reserveDerivativeBackfill(db, 200, now, env),
    reserveDerivativeBackfill(db, 200, now, env),
  ]);
  expect(results.filter(Boolean)).toHaveLength(2);
  expect(state('budget:derivatives-backfill').reserved).toBe(10400);
  expect(await reserveDerivativeBackfill(db, 1, now)).toBe(false);
  expect(derivativeBackfillLimit({}, now)).toBe(10000);
});

it.each(['cloudflare', 'read-only', 'expired', 'future', 'too-long', 'over-limit', 'no-increase'])(
  'invalid recovery authorization is rejected before a budget write: %s',
  async (variant) => {
    const env = environment();
    if (variant === 'cloudflare') env.RUNTIME_KIND = 'cloudflare';
    if (variant === 'read-only') env.READ_ONLY_API = true;
    if (variant === 'expired') env.DERIVATIVE_HISTORY_GRANT!.expiresAt = now;
    if (variant === 'future') env.DERIVATIVE_HISTORY_GRANT!.issuedAt = now + 1;
    if (variant === 'too-long') env.DERIVATIVE_HISTORY_GRANT!.expiresAt = now + 86401;
    if (variant === 'over-limit') env.DERIVATIVE_HISTORY_GRANT!.dailyRows = 1000001;
    if (variant === 'no-increase') env.DERIVATIVE_HISTORY_GRANT!.dailyRows = 10000;
    await expect(reserveDerivativeBackfill(db, 200, now, env)).rejects.toThrow(/grant/);
    expect(state('budget:derivatives-backfill')).toBeNull();
  },
);

it('legacy raw without completion is checked before oldest observation without changing current health', async () => {
  const first = now - 86400;
  db.sqlite
    .prepare('INSERT INTO derivative_series VALUES(?,?,?,?,?)')
    .run('BTC', 'funding', first, 0.01, now);
  db.sqlite
    .prepare('INSERT INTO raw_samples VALUES(?,?,?,?)')
    .run('derivatives:BTC:funding:history:legacy', 'Bybit', now, '{}');
  db.sqlite
    .prepare(
      'INSERT INTO ingestion(key,last_success,data_as_of,error,next_attempt) VALUES(?,?,?,?,?)',
    )
    .run('derivatives:BTC:funding', now - 20, now, 'latest source retry', now + 60);
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    expect(new URL(String(input)).searchParams.get('endTime')).toBe(String(first * 1000 - 1));
    return Response.json(funding([first - 8 * 3600]));
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await runDerivativeHistoryPage(environment(), 'BTC', 'funding')).toMatchObject({
    outcome: 'complete',
    observations: 1,
  });
  expect(state('history-evidence:derivatives:BTC:funding').reason).toBe('provider_partial_page');
  expect(state('cursor:derivatives:BTC:funding')).toBeNull();
  expect(
    db.sqlite.prepare('SELECT last_success,data_as_of,error,next_attempt FROM ingestion').get(),
  ).toMatchObject({
    last_success: now - 20,
    data_as_of: now,
    error: 'latest source retry',
    next_attempt: now + 60,
  });
});

it('full history page resumes from its cursor and empty endpoint proves completion', async () => {
  const first = now - 86400;
  db.sqlite
    .prepare('INSERT INTO derivative_series VALUES(?,?,?,?,?)')
    .run('BTC', 'funding', first, 0.01, now);
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        funding(
          calls++ === 0 ? Array.from({ length: 200 }, (_, i) => first - (i + 1) * 8 * 3600) : [],
        ),
      ),
    ),
  );
  const env = environment();
  expect(await updateDerivatives(env, 'BTC', 'funding')).toMatchObject({
    outcome: 'advanced',
    observations: 200,
  });
  expect(state('cursor:derivatives:BTC:funding')).toBe((first - 200 * 8 * 3600) * 1000 - 1);
  expect(await updateDerivatives(env, 'BTC', 'funding')).toMatchObject({
    outcome: 'complete',
    observations: 0,
  });
  expect(state('history-evidence:derivatives:BTC:funding').reason).toBe('provider_empty');
  expect(state('budget:derivatives-backfill').reserved).toBe(400);
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n).toBe(201);
});

it('failed validation keeps observations and cursor; scheduled partition lease coordinates recovery', async () => {
  const cursor = (now - 86400) * 1000 - 1;
  db.sqlite
    .prepare('INSERT INTO state VALUES(?,?)')
    .run('cursor:derivatives:BTC:funding', String(cursor));
  const fetcher = vi.fn(async () =>
    Response.json({ retCode: 0, result: { category: 'linear', list: [{ symbol: 'ETHUSDT' }] } }),
  );
  vi.stubGlobal('fetch', fetcher);
  await claimRefresh(db, 'derivatives:BTC:funding', 55);
  expect(await runDerivativeHistoryPage(environment(), 'BTC', 'funding')).toMatchObject({
    outcome: 'partition_busy',
  });
  expect(fetcher).not.toHaveBeenCalled();
  vi.setSystemTime((now + 56) * 1000);
  expect(await runDerivativeHistoryPage(environment(), 'BTC', 'funding')).toMatchObject({
    outcome: 'failed',
    code: 'HISTORY_VALIDATION_FAILED',
  });
  expect(state('cursor:derivatives:BTC:funding')).toBe(cursor);
  expect(state('history-complete:derivatives:BTC:funding')).toBeNull();
  expect(state('history-operator-error:derivatives:BTC:funding').nextAttempt).toBe(now + 116);
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n).toBe(0);
});

it('expiry or space loss during a request keeps the reservation but no data/checkpoint advances', async () => {
  const env = environment();
  let available = true;
  env.HISTORY_ALLOWED = () => available;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      available = false;
      return Response.json(funding([now - 3600]));
    }),
  );
  expect(await updateDerivatives(env, 'BTC', 'funding')).toMatchObject({
    outcome: 'paused_low_space',
  });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n).toBe(0);
  expect(state('history-complete:derivatives:BTC:funding')).toBeNull();
  expect(state('budget:derivatives-backfill').reserved).toBe(200);
  available = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      vi.setSystemTime(env.DERIVATIVE_HISTORY_GRANT!.expiresAt * 1000);
      return Response.json(funding([now - 3600]));
    }),
  );
  expect(await updateDerivatives(env, 'BTC', 'funding')).toMatchObject({
    outcome: 'paused_expired',
  });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n).toBe(0);
  expect(state('budget:derivatives-backfill').reserved).toBe(400);
});

it('one operator owns the lease, expiry is recoverable and stale release cannot remove its successor', async () => {
  const env = environment();
  const owners = await Promise.all([claimOperatorLease(env), claimOperatorLease(env)]);
  expect(owners.filter((v) => v !== null)).toEqual([now + 55]);
  vi.setSystemTime((now + 56) * 1000);
  expect(await renewOperatorLease(env, now + 55)).toBeNull();
  expect(await claimOperatorLease(env)).toBe(now + 111);
  await releaseOperatorLease(env, now + 55);
  expect(
    db.sqlite
      .prepare('SELECT value FROM state WHERE key=?')
      .get('lease:derivatives-history-operator').value,
  ).toBe(String(now + 111));
});

it('inventory includes all 680 partitions, prioritizes funding and daily, and retains unmarked legacy partitions', async () => {
  const plan = historyPartitions();
  expect(plan).toHaveLength(680);
  expect(new Set(plan.map((p) => p.key)).size).toBe(680);
  expect(plan.slice(0, 136).every((p) => p.metric === 'funding')).toBe(true);
  expect(plan.slice(136, 408).every((p) => p.metric.endsWith('_daily'))).toBe(true);
  const inventory = await derivativeHistoryInventory(environment());
  expect(inventory).toHaveLength(680);
  expect(inventory.every((p) => p.complete === null && p.cursor === null)).toBe(true);
});

it('hourly recovery preserves the 30-day floor and proves its stopping reason', async () => {
  const floor = now - 30 * 86400;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        retCode: 0,
        result: {
          category: 'linear',
          symbol: 'BTCUSDT',
          list: [floor + 3600, floor, floor - 3600].map((time) => ({
            timestamp: String(time * 1000),
            openInterest: '1',
          })),
        },
      }),
    ),
  );
  expect(await updateDerivatives(environment(), 'BTC', 'open_interest')).toMatchObject({
    outcome: 'complete',
    observations: 2,
  });
  expect(
    db.sqlite.prepare('SELECT MIN(time) first,MAX(time) last FROM derivative_series').get(),
  ).toMatchObject({ first: floor, last: floor + 3600 });
  expect(state('history-evidence:derivatives:BTC:open_interest').reason).toBe('policy_floor');
  expect(db.sqlite.prepare('SELECT last_success FROM ingestion').get().last_success).toBeNull();
});

it('an operator that loses its global lease while awaiting the source cannot commit the page', async () => {
  const env = environment(),
    lease = await claimOperatorLease(env);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      db.sqlite.prepare('DELETE FROM state WHERE key=?').run('lease:derivatives-history-operator');
      return Response.json(funding([now - 3600]));
    }),
  );
  expect(await updateDerivatives(env, 'BTC', 'funding', false, lease!)).toMatchObject({
    outcome: 'paused_operator_lease',
  });
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n).toBe(0);
  expect(state('history-complete:derivatives:BTC:funding')).toBeNull();
  expect(state('budget:derivatives-backfill').reserved).toBe(200);
});

it.each([10006, 10018, 10009])(
  'Bybit block/rate code %s stops bulk work before parsing or advancing observations',
  async (retCode) => {
    const cursor = (now - 86400) * 1000 - 1;
    db.sqlite
      .prepare('INSERT INTO state VALUES(?,?)')
      .run('cursor:derivatives:BTC:funding', String(cursor));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ retCode, result: { list: [] } })),
    );
    expect(await runDerivativeHistoryPage(environment(), 'BTC', 'funding')).toMatchObject({
      outcome: 'paused_source_limit',
    });
    expect(state('cursor:derivatives:BTC:funding')).toBe(cursor);
    expect(state('history-complete:derivatives:BTC:funding')).toBeNull();
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM raw_samples').get().n).toBe(0);
    expect(state('budget:derivatives-backfill').reserved).toBe(200);
  },
);

it.each([403, 418, 429, 502])(
  'source HTTP %s pauses the one-off operator without changing the cursor',
  async (status) => {
    const env = environment(),
      cursor = (now - 86400) * 1000 - 1;
    db.sqlite
      .prepare('INSERT INTO state VALUES(?,?)')
      .run('cursor:derivatives:BTC:funding', String(cursor));
    env.FEED_SERVICE = {
      fetch: vi.fn(async () => new Response('opaque source failure', { status })),
    } as unknown as Fetcher;
    expect(await runDerivativeHistoryPage(env, 'BTC', 'funding')).toMatchObject({
      outcome: 'paused_source_http',
    });
    expect(state('cursor:derivatives:BTC:funding')).toBe(cursor);
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n).toBe(0);
  },
);

it('blocked source does not seed a missing durable legacy cursor or mark its old raw page complete', async () => {
  const first = now - 86400,
    env = environment();
  db.sqlite
    .prepare('INSERT INTO derivative_series VALUES(?,?,?,?,?)')
    .run('BTC', 'funding', first, 0.01, now);
  db.sqlite
    .prepare('INSERT INTO raw_samples VALUES(?,?,?,?)')
    .run('derivatives:BTC:funding:history:legacy', 'Bybit', now, '{}');
  env.FEED_SERVICE = {
    fetch: vi.fn(async () => new Response('opaque block', { status: 502 })),
  } as unknown as Fetcher;
  expect(await runDerivativeHistoryPage(env, 'BTC', 'funding')).toMatchObject({
    outcome: 'paused_source_http',
  });
  expect(state('cursor:derivatives:BTC:funding')).toBeNull();
  expect(state('history-complete:derivatives:BTC:funding')).toBeNull();
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM raw_samples').get().n).toBe(1);
  expect(db.sqlite.prepare('SELECT COUNT(*) n FROM derivative_series').get().n).toBe(1);
});
