import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite, migrate } from '../sqlite.mjs';
import {
  restrictResearchWrites,
  researchConfig,
  heartbeat,
  researchHealth,
  runResearchTick,
} from '../research-worker.mjs';
import * as r from '../../server-dist/research.mjs';
const at = Date.parse('2026-10-18T01:00:00Z') / 1000;
const setup = () => {
  const db = openSqlite(':memory:');
  migrate(db);
  return db;
};
const job = () => r.dueReportJobs(at).find((j) => j.scope === 'global' && j.type === 'daily');
const observed = async (extra = {}) =>
  r.observation({
    reportScope: 'global',
    provider: 'test',
    entityId: 'BTC',
    entityType: 'token',
    metric: 'price',
    value: '0.000000000000000001',
    unit: 'USD',
    source: 'Test',
    sourceUrl: 'https://example.com',
    scope: 'test',
    dataAsOf: r.iso(at),
    fetchedAt: r.iso(at),
    observedAt: at,
    periodStart: null,
    periodEnd: null,
    status: 'verified',
    ...extra,
  });
const report = async (j = job()) => {
  const e = await observed();
  return {
    reportId: r.reportId(j),
    reportType: j.type,
    scopeId: j.scope,
    title: '검증 보고서',
    periodStart: r.iso(j.start),
    periodEnd: r.iso(j.end),
    publishedAt: r.iso(at),
    revision: j.revision,
    publicationStatus: 'published',
    dataQuality: 'partial',
    highlights: [],
    dataCutoff: r.iso(at),
    generatedAt: r.iso(at),
    supersedesReportId: null,
    supersededByReportId: null,
    sections: [
      {
        kind: 'facts',
        title: '가격',
        items: [{ label: '가격', value: e.value, unit: e.unit, evidenceIds: [e.id] }],
      },
    ],
    evidence: [e],
    coverageNotes: [],
    methodologyVersion: 'research-v1',
    templateVersion: 'ko-observations-v1',
    schemaVersion: 1,
    evidenceHash: await r.hash([e]),
  };
};
test('research config is disabled unless explicitly enabled; bounded limits', () => {
  assert.equal(researchConfig({}).enabled, false);
  assert.equal(researchConfig({}).maxMarkets, 10);
  assert.throws(() => researchConfig({ COIN_DESK_RESEARCH_ENABLED: 'maybe' }));
  assert.throws(() => researchConfig({ COIN_DESK_RESEARCH_MAX_MARKETS: '100' }));
});
test('Node authorizer blocks existing table writes, schema changes and deletes', async () => {
  const db = setup();
  restrictResearchWrites(db.sqlite);
  assert.throws(() => db.sqlite.exec('CREATE TABLE forbidden(id INTEGER)'));
  assert.throws(
    () => db.sqlite.prepare("INSERT INTO state(key,value) VALUES('private','bad')").run(),
    /authorized|authorization/i,
  );
  await heartbeat(db, false, { now: at });
  assert.deepEqual(await researchHealth(db, at), { ok: true, state: 'disabled', lastTickAt: null });
  assert.throws(() => db.sqlite.exec('DELETE FROM onchain_provider_state'));
  db.sqlite.close();
});
test('provider failure keeps last success and respects Retry-After; no raw error secrets', async () => {
  const db = setup();
  await r.providerSuccess(db, 'coingecko', 'both', at - 1, at - 2, { cursor: 3 });
  await r.providerFailure(db, 'coingecko', 'both', at, new r.ProviderHttpError(429, 900));
  const state = await r.providerState(db, 'coingecko', 'both');
  assert.equal(state.last_success, at - 1);
  assert.equal(state.next_attempt, at + 900);
  assert.equal(state.error_code, 'PROVIDER_RATE_LIMIT');
  db.sqlite.close();
});
test('transient provider retry uses increasing bounded backoff and retains its checkpoint', async () => {
  const db = setup();
  await r.providerSuccess(db, 'test', 'injective', at - 1, null, { cursor: 3 });
  await r.providerFailure(db, 'test', 'injective', at, new Error('timeout'), () => 0.5);
  assert.equal((await r.providerState(db, 'test', 'injective')).next_attempt, at + 300);
  await r.providerFailure(db, 'test', 'injective', at + 300, new Error('timeout'), () => 0.5);
  const next = await r.providerState(db, 'test', 'injective');
  assert.equal(next.next_attempt, at + 900);
  assert.equal(JSON.parse(next.checkpoint).cursor, 3);
  db.sqlite.close();
});
test('leases fence expired owners; publication evidence remains frozen after source correction', async () => {
  const db = setup(),
    j = job();
  restrictResearchWrites(db.sqlite);
  const a = await r.claimReport(db, j, 'a', at);
  assert.ok(a);
  assert.equal(await r.claimReport(db, j, 'b', at + 1), null);
  const b = await r.claimReport(db, j, 'b', at + 181);
  assert.ok(b);
  assert.equal(b.generation, a.generation + 1);
  const doc = await report(j);
  await assert.rejects(r.publishReport(db, a, doc, at + 181), /LEASE_LOST/);
  await r.publishReport(db, b, doc, at + 181);
  await r.saveObservations(db, [await observed({ value: '999' })]);
  const saved = (await r.reportDetail(db, doc.reportId)).data;
  assert.equal(saved.evidence[0].value, '0.000000000000000001');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM onchain_report_evidence').get().n, 1);
  assert.throws(
    () =>
      db.sqlite
        .prepare('UPDATE onchain_reports SET quality=? WHERE id=?')
        .run('complete', doc.reportId),
    /immutable/,
  );
  assert.throws(
    () => db.sqlite.prepare("UPDATE onchain_report_evidence SET payload='{}'").run(),
    /immutable/,
  );
  db.sqlite.close();
});
test('explicit revision preserves old body, supersedes metadata and appears once in feed', async () => {
  const db = setup(),
    j = job(),
    first = await report(j);
  await r.publishReport(db, await r.claimReport(db, j, 'a', at), first, at);
  const next = { ...j, revision: 2 },
    second = { ...(await report(next)), supersedesReportId: first.reportId };
  await r.publishReport(db, await r.claimReport(db, next, 'b', at + 1), second, at + 1);
  assert.equal((await r.listReports(db, new URLSearchParams())).data.length, 1);
  assert.equal((await r.reportDetail(db, first.reportId)).data.publicationStatus, 'superseded');
  assert.equal(
    JSON.parse(
      db.sqlite.prepare('SELECT body FROM onchain_reports WHERE id=?').get(first.reportId).body,
    ).supersededByReportId,
    null,
  );
  db.sqlite.close();
});
test('compound series cursor never skips observations with equal timestamps', async () => {
  const db = setup();
  await r.saveObservations(db, [await observed(), await observed({ provider: 'another' })]);
  const q = new URLSearchParams({
    scope: 'global',
    entity: 'BTC',
    metric: 'price',
    from: String(at - 1),
    to: String(at + 1),
    limit: '1',
  });
  const first = await r.researchSeries(db, q);
  q.set('cursor', first.nextCursor);
  const second = await r.researchSeries(db, q);
  assert.equal(first.data.length, 1);
  assert.equal(second.data.length, 1);
  assert.notEqual(first.data[0].id, second.data[0].id);
  assert.equal(second.nextCursor, null);
  const before = db.sqlite.prepare('SELECT total_changes() n').get().n;
  await r.listReports(db, new URLSearchParams());
  await r.latestReport(db, new URLSearchParams());
  await r.researchCoverage(db, new URLSearchParams());
  await r.researchMarkets(db, new URLSearchParams());
  assert.equal(db.sqlite.prepare('SELECT total_changes() n').get().n, before);
  db.sqlite.close();
});
test('disabled and low-space worker do not call providers or alter existing data', async () => {
  const db = setup();
  let calls = 0;
  const collector = async () => {
    calls++;
    return { failed: [], success: [], observations: 0 };
  };
  assert.equal(
    (await runResearchTick(db, researchConfig({}), { collector, now: () => at })).state,
    'disabled',
  );
  assert.equal(
    (
      await runResearchTick(db, researchConfig({ COIN_DESK_RESEARCH_ENABLED: '1' }), {
        collector,
        now: () => at,
        spaceAvailable: () => false,
      })
    ).state,
    'paused_low_space',
  );
  assert.equal(calls, 0);
  db.sqlite.close();
});
test('an empty failed publication cannot replace the last report', async () => {
  const db = setup(),
    j = job(),
    doc = await report(j);
  await r.publishReport(db, await r.claimReport(db, j, 'a', at), doc, at);
  const before = await r.latestReport(db, new URLSearchParams());
  const outcome = await runResearchTick(db, researchConfig({ COIN_DESK_RESEARCH_ENABLED: '1' }), {
    now: () => at + 86400,
    collector: async () => ({ failed: ['test'], success: [], observations: 0 }),
  });
  assert.equal(outcome.reports, 0);
  assert.deepEqual(await r.latestReport(db, new URLSearchParams()), before);
  db.sqlite.close();
});
test('verified complete market refresh retires absent listings without deleting their history', async () => {
  const db = setup(),
    old = '0x' + 'a'.repeat(64),
    current = '0x' + 'b'.repeat(64),
    day = Math.floor(at / 86400) * 86400;
  const oldMarket = {
    id: old,
    chain: 'injective',
    network: 'mainnet',
    venue: 'injective',
    kind: 'spot',
    ticker: 'OLD/USDT',
    baseDenom: 'old',
    quoteDenom: 'usdt',
    quoteSymbol: 'USDT',
    baseDecimals: 18,
    quoteDecimals: 6,
    status: 'active',
    sourceUrl: 'https://api.injective.exchange',
    verifiedAt: r.iso(at - 100),
  };
  await r.saveMarkets(db, [oldMarket], at - 100);
  restrictResearchWrites(db.sqlite);
  const fetcher = async (url) => {
    const u = String(url);
    if (u.includes('/global/'))
      return Response.json([{ total_mcap: '100', total_volume: '50', btc_d: '40', eth_d: '20' }]);
    if (u.includes('/ticker/')) return Response.json([]);
    if (u.includes('/historicalChainTvl/')) return Response.json([{ date: day - 86400, tvl: 10 }]);
    if (u.includes('/overview/dexs/'))
      return Response.json({
        chain: 'Injective',
        protocols: [{ name: 'Spot', category: 'Dexs', chains: ['Injective'] }],
        totalDataChartBreakdown: [[day - 86400, { Spot: 1 }]],
      });
    throw new Error('Unexpected provider');
  };
  const empty = { fetchTrades: async () => ({ trades: [] }), fetchOrderbookV2: async () => ({}) };
  const clients = {
    spot: {
      ...empty,
      fetchMarkets: async () => [
        {
          marketId: current,
          marketStatus: 'active',
          ticker: 'OTHER/USDT',
          baseDenom: 'other',
          baseToken: { decimals: 18 },
          quoteDenom: 'usdt',
          quoteToken: { decimals: 6, symbol: 'USDT' },
        },
      ],
    },
    derivative: { ...empty, fetchMarkets: async () => [] },
  };
  const outcome = await r.collectResearch(db, at, { fetcher, clients, now: () => at + 601 });
  assert.deepEqual(outcome.failed, []);
  const listing = await r.researchMarkets(db, new URLSearchParams());
  assert.equal(listing.data.length, 1);
  assert.equal(listing.data[0].id, current);
  assert.equal(listing.data[0].verifiedAt, r.iso(at + 601));
  assert.equal(
    JSON.parse(db.sqlite.prepare('SELECT payload FROM onchain_markets WHERE id=?').get(old).payload)
      .status,
    'inactive',
  );
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM onchain_markets').get().n, 2);
  db.sqlite.close();
});
