import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import { observationSignals } from '../shared/signals';
import { reconcileSignals, signalsFeed, buildDailyBriefing } from '../worker/observations';
import {
  parseEthereumContext,
  refreshEthereumContext,
  ethereumContext,
} from '../worker/ethereum-context';
import {
  priceBasis,
  assetLink,
  contiguousCalculation,
  relativeStrength,
  monthlyReturns,
} from '../shared/analysis-workspace';
import { workspaceUrl, normalizeDesk } from '../shared/workspace';
import worker from '../worker/index';
const DAY = 86400,
  base = Date.UTC(2026, 0, 1) / 1000;
let DB, env;
beforeEach(() => {
  DB = openDatabase(':memory:');
  env = { DB, ENABLED_ASSETS: 'BTC,DOGE,ETH' };
  vi.stubGlobal('caches', { default: memoryCache() });
});
afterEach(() => {
  DB.sqlite.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('uses completed bars only and never crosses a missing day', () => {
  const data = [
    { time: base, value: 0.9 },
    { time: base + DAY, value: 1.1 },
  ];
  expect(observationSignals('BTC', 'coinmetrics', data, 'mvrv', base + DAY + 100)).toHaveLength(0);
  expect(observationSignals('BTC', 'coinmetrics', data, 'mvrv', base + 2 * DAY)).toHaveLength(1);
  expect(
    observationSignals(
      'BTC',
      'coinmetrics',
      [data[0], { ...data[1], time: base + 2 * DAY }],
      'mvrv',
      base + 3 * DAY,
    ),
  ).toHaveLength(0);
  expect(() =>
    observationSignals('BTC', 'coinmetrics', [data[0], data[0]], 'mvrv', base + 2 * DAY),
  ).toThrow();
});
it('checks adjacent funding settlements, rejects missing long gaps and never alerts for a maintained sign', () => {
  const rows = [-0.01, 0.02, 0.03, -0.01].map((value, i) => ({ time: base + i * 28800, value }));
  expect(observationSignals('DOGE', 'bybit', rows, 'funding', base + DAY)).toHaveLength(2);
  expect(
    observationSignals(
      'DOGE',
      'bybit',
      [rows[0], { ...rows[1], time: base + DAY }],
      'funding',
      base + DAY,
    ),
  ).toHaveLength(0);
});
it('never changes a past SMA/RSI signal when future prices are appended', () => {
  const rows = Array.from({ length: 240 }, (_, i) => ({
    time: base + i * DAY,
    value: i < 200 ? 100 : i % 4 === 0 ? 140 : 80,
  }));
  const prior = observationSignals(
    'BTC',
    'reference',
    rows.slice(0, 220),
    'price',
    base + 220 * DAY,
  );
  expect(
    observationSignals('BTC', 'reference', rows, 'price', base + 240 * DAY).filter(
      (s) => s.time < base + 220 * DAY,
    ),
  ).toEqual(prior);
  const broken = rows.filter((_, i) => i !== 199);
  expect(
    observationSignals('BTC', 'reference', broken, 'price', base + 240 * DAY).filter(
      (s) => s.rule === 'sma200',
    ),
  ).toHaveLength(0);
});
it('suppresses backfills, deduplicates repeat runs, notifies only new crossings and preserves corrections', async () => {
  const rows = [0.9, 1.1, 1.2].map((value, i) => ({ time: base + i * DAY, value }));
  await reconcileSignals(env, 'BTC', 'coinmetrics', 'mvrv', rows, base + 3 * DAY);
  expect((await signalsFeed(env, 'BTC', base + 10 * DAY)).data[0].notify).toBe(false);
  const next = [...rows, { time: base + 3 * DAY, value: 0.8 }];
  await reconcileSignals(env, 'BTC', 'coinmetrics', 'mvrv', next, base + 4 * DAY);
  await reconcileSignals(env, 'BTC', 'coinmetrics', 'mvrv', next, base + 4 * DAY);
  let signals = (await signalsFeed(env, 'BTC', base + 10 * DAY)).data;
  expect(signals).toHaveLength(2);
  expect(signals[0].notify).toBe(true);
  await reconcileSignals(
    env,
    'BTC',
    'coinmetrics',
    'mvrv',
    [...rows, { time: base + 3 * DAY, value: 0.7 }],
    base + 4 * DAY,
  );
  signals = (await signalsFeed(env, 'BTC', base + 10 * DAY)).data;
  expect(signals[0]).toMatchObject({
    revision: 2,
    status: 'corrected',
    current: 0.7,
    notify: false,
  });
  expect(DB.sqlite.prepare('SELECT count(*) n FROM signal_revisions').get().n).toBe(1);
  await reconcileSignals(
    env,
    'BTC',
    'coinmetrics',
    'mvrv',
    [...rows, { time: base + 3 * DAY, value: 1.3 }],
    base + 4 * DAY,
  );
  expect((await signalsFeed(env, 'BTC', base + 10 * DAY)).data[0].status).toBe('withdrawn');
});
it('creates one briefing after 09:10 KST without a visitor, keeps missing data explicit', async () => {
  await buildDailyBriefing(env, base + 9 * 60);
  expect(DB.sqlite.prepare('SELECT COUNT(*) n FROM daily_briefings').get().n).toBe(0);
  await Promise.all([
    buildDailyBriefing(env, base + 10 * 60),
    buildDailyBriefing(env, base + 10 * 60),
  ]);
  expect(DB.sqlite.prepare('SELECT COUNT(*) n FROM daily_briefings').get().n).toBe(1);
  const b = JSON.parse(DB.sqlite.prepare('SELECT payload FROM daily_briefings').get().payload);
  expect(b.prices.map((p) => p.asset)).toEqual(['BTC', 'DOGE', 'ETH']);
  expect(b.missing).toHaveLength(3);
});
it('keeps unit/source and all visual state in saved and shared navigation', () => {
  expect(priceBasis(new URLSearchParams())).toBe('reference');
  expect(priceBasis(new URLSearchParams('market=upbit'))).toBe('upbit');
  expect(priceBasis(new URLSearchParams('market=upbit&price_source=reference'))).toBe('reference');
  const q = new URLSearchParams(
    'asset=DOGE&visual=rainbow&price_source=upbit&log=0&signal=old&panels=rsi,drawdown',
  );
  const changed = new URL(assetLink('/', 'ETH', q), 'https://desk.test');
  expect(changed.searchParams.get('visual')).toBe('rainbow');
  expect(changed.searchParams.has('signal')).toBe(false);
  const desk = normalizeDesk({
    version: 1,
    workspaces: [
      {
        name: 'Test',
        asset: 'DOGE',
        priceSource: 'reference',
        visual: 'rainbow',
        panels: ['rsi', 'net:mvrv'],
      },
    ],
    cards: [],
    favorites: [],
  });
  const saved = new URL(workspaceUrl(desk.workspaces[0]), 'https://desk.test');
  expect(saved.searchParams.get('price_source')).toBe('reference');
  expect(saved.searchParams.get('visual')).toBe('rainbow');
  expect(saved.searchParams.get('panels')).toBe('rsi,net:mvrv');
});
it('does not join missing benchmark dates, rolling periods or monthly returns', () => {
  expect(relativeStrength([{ time: base, value: 20 }], [{ time: base + DAY, value: 10 }])).toEqual(
    [],
  );
  expect(
    contiguousCalculation(
      [
        { time: base, value: 10 },
        { time: base + 2 * DAY, value: 20 },
      ],
      'sma',
      2,
    ),
  ).toEqual([]);
  expect(
    monthlyReturns([
      { time: base - DAY, value: 10 },
      { time: base + 2 * DAY, value: 20 },
    ])[1].value,
  ).toBe(null);
});
it('stores real Ethereum series, writes only changed months and retains data on source failure', async () => {
  vi.spyOn(Date, 'now').mockReturnValue((base + 10 * DAY) * 1000);
  const rows = [{ date: base, tvl: 120, totalCirculatingUSD: { peggedUSD: 20 } }];
  expect(parseEthereumContext(rows, 'stablecoins', base + DAY)).toEqual([
    { time: base, value: 20 },
  ]);
  expect(() => parseEthereumContext([{ date: base, tvl: null }], 'tvl')).toThrow();
  const fetcher = vi.fn(async () => new Response(JSON.stringify(rows)));
  vi.stubGlobal('fetch', fetcher);
  await refreshEthereumContext(env);
  expect((await ethereumContext(env, 'tvl')).data).toEqual([{ time: base, value: 120 }]);
  vi.spyOn(Date, 'now').mockReturnValue((base + 10 * DAY + 3601) * 1000);
  fetcher.mockImplementation(async () => new Response('quota', { status: 429 }));
  await refreshEthereumContext(env);
  expect((await ethereumContext(env, 'tvl')).data).toHaveLength(1);
  expect((await ethereumContext(env, 'tvl')).meta.stale).toBe(true);
});
it('serves new APIs read-only and never triggers upstream collection', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const path of ['signals?asset=DOGE', 'briefings', 'chain-context?asset=ETH&metric=tvl']) {
    const response = await worker.fetch(new Request('https://desk.test/api/v1/' + path), env, {
      waitUntil() {},
    });
    expect(response.status).toBe(200);
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (
      await worker.fetch(
        new Request('https://desk.test/api/v1/chain-context?asset=DOGE&metric=tvl'),
        env,
        { waitUntil() {} },
      )
    ).status,
  ).toBe(400);
});

it('paginates every signal even when several share the same timestamp', async () => {
  const rows = [0.9, 1.1].map((value, i) => ({ time: base + i * DAY, value }));
  for (const source of ['one', 'two', 'three'])
    await reconcileSignals(env, 'BTC', source, 'mvrv', rows, base + 2 * DAY);
  const ids = [];
  let cursor;
  do {
    const page = await signalsFeed(env, 'BTC', base + 3 * DAY, 1, cursor);
    ids.push(...page.data.map((s) => s.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
});
it('updates state in place and skips identical writes', async () => {
  const { putState } = await import('../worker/storage');
  await putState(DB, 'test', { value: 1 });
  const before = DB.sqlite.prepare('SELECT rowid FROM state WHERE key=?').get('test').rowid;
  const writes = DB.sqlite.prepare('SELECT total_changes() n').get().n;
  await putState(DB, 'test', { value: 1 });
  expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(writes);
  await putState(DB, 'test', { value: 2 });
  expect(DB.sqlite.prepare('SELECT rowid FROM state WHERE key=?').get('test').rowid).toBe(before);
});
it('calculates monthly indicators across real calendar months, restarts after a missing month', async () => {
  const { workspaceIndicators } = await import('../shared/workspace-indicators');
  const rows = Array.from({ length: 30 }, (_, i) => ({
    time: Date.UTC(2023, i, 1) / 1000,
    value: i + 10,
  }));
  const full = workspaceIndicators(rows, [], ['sma:20:bar'], 'USD', 32 * DAY);
  expect(full[0].data).toHaveLength(11);
  const gap = workspaceIndicators(
    rows.filter((_, i) => i !== 15),
    [],
    ['sma:20:bar'],
    'USD',
    32 * DAY,
  );
  expect(gap[0].data).toHaveLength(0);
  const macd = workspaceIndicators(
    Array.from({ length: 80 }, (_, i) => ({ time: base + i * DAY, value: i + 10 })),
    [],
    ['macd'],
    'USD',
  );
  expect(new Set(macd.map((l) => l.pane)).size).toBe(1);
});

it('removes incompatible coin-specific panels during asset switching', () => {
  const start = new URLSearchParams(
    'asset=ETH&panels=chain:tvl,net:mvrv,btc:sopr_24h,relative&metric=tvl',
  );
  const doge = new URL(assetLink('/', 'DOGE', start), 'https://desk.test');
  expect(doge.searchParams.get('panels')).toBe('net:mvrv,relative');
  expect(doge.searchParams.has('metric')).toBe(false);
  const btc = new URL(assetLink('/', 'BTC', start), 'https://desk.test');
  expect(btc.searchParams.get('panels')).toBe('net:mvrv,btc:sopr_24h');
});

it('honors the same logarithmic/linear axis setting in price position bands', async () => {
  const { positionGeometry, priceObservations } = await import('../shared/position-chart');
  const prices = priceObservations([
    { time: base, value: 1 },
    { time: base + DAY, value: 100 },
  ]);
  const log = positionGeometry(prices, [], 1000, true),
    linear = positionGeometry(prices, [], 1000, false);
  expect(log.y(10)).toBeCloseTo((log.y(1) + log.y(100)) / 2);
  expect(linear.y(50.5)).toBeCloseTo((linear.y(1) + linear.y(100)) / 2);
  expect(linear.tick(0)).toBeGreaterThanOrEqual(0);
});

it('restores analysis section and selected observation in a saved workspace', () => {
  const desk = normalizeDesk({
    version: 1,
    workspaces: [
      {
        name: 'Funding',
        asset: 'DOGE',
        section: 'futures',
        priceSource: 'upbit',
        signal: 'DOGE:bybit:funding0:1:observations-v1',
        panels: ['futures:funding'],
      },
    ],
  });
  const url = new URL(workspaceUrl(desk.workspaces[0]), 'https://desk.test');
  expect(url.pathname).toBe('/futures/DOGE');
  expect(url.searchParams.get('signal')).toBe('DOGE:bybit:funding0:1:observations-v1');
  expect(url.searchParams.get('price_source')).toBe('upbit');
});
