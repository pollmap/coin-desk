import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index.ts';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';

let DB, env, waiting;
beforeEach(() => {
  DB = openDatabase(':memory:');
  env = {
    DB,
    READ_ONLY_API: true,
    ENABLED_ASSETS: 'BTC',
    ASSETS: { fetch: async () => new Response('asset') },
  };
  waiting = [];
  globalThis.caches = { default: memoryCache() };
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Public report reads must not call a provider');
    }),
  );
});
afterEach(async () => {
  await Promise.all(waiting);
  vi.unstubAllGlobals();
  DB.sqlite.close();
});
const call = (path, method = 'GET') =>
  worker.fetch(new Request('https://example.test/api/v1/' + path, { method }), env, {
    waitUntil: (p) => waiting.push(p),
  });
const changed = () => DB.sqlite.prepare('SELECT total_changes() n').get().n;
function insert(id, at, { scope = 'global', type = 'daily', superseded = null } = {}) {
  const body = {
    reportId: id,
    reportType: type,
    scopeId: scope,
    title: '시장 일간',
    periodStart: '2026-10-16T00:00:00.000Z',
    periodEnd: '2026-10-17T00:00:00.000Z',
    publishedAt: new Date(at * 1000).toISOString(),
    revision: 1,
    publicationStatus: 'published',
    dataQuality: 'partial',
    highlights: [],
    sections: [],
    evidence: [],
    coverageNotes: [],
    dataCutoff: '2026-10-17T00:00:00.000Z',
    generatedAt: new Date(at * 1000).toISOString(),
    supersedesReportId: null,
    supersededByReportId: null,
    methodologyVersion: 'test',
    templateVersion: 'test',
    schemaVersion: 1,
    evidenceHash: 'fixture',
  };
  DB.sqlite
    .prepare(
      'INSERT INTO onchain_reports(id,publication_key,revision,type,scope,period_start,period_end,published_at,quality,body,evidence_hash,superseded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      id,
      1,
      type,
      scope,
      1792108800,
      1792195200,
      at,
      'partial',
      JSON.stringify(body),
      'fixture',
      superseded,
    );
}

describe('public periodic report API isolation', () => {
  it('reads pending reports and coverage without DB writes or provider requests', async () => {
    const before = changed();
    for (const path of [
      'reports',
      'reports/latest',
      'onchain/markets',
      'onchain/coverage?scope=injective',
      'onchain/series?entity=chain_injective&metric=tvl_usd',
    ]) {
      const result = await call(path);
      expect(result.status, path).toBe(200);
      expect(result.headers.get('cache-control')).toBe('no-store');
      await result.json();
    }
    expect(changed()).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not inject chart defaults and paginates tied publication timestamps without loss', async () => {
    insert('global-a', 1792197000);
    insert('injective-b', 1792197000, { scope: 'injective' });
    insert('global-c', 1792196999);
    const first = await (await call('reports?limit=1')).json();
    expect(first.data.map((r) => r.reportId)).toEqual(['global-a']);
    const second = await (
      await call('reports?limit=1&cursor=' + encodeURIComponent(first.nextCursor))
    ).json();
    expect(second.data.map((r) => r.reportId)).toEqual(['injective-b']);
    const third = await (
      await call('reports?limit=1&cursor=' + encodeURIComponent(second.nextCursor))
    ).json();
    expect(third.data.map((r) => r.reportId)).toEqual(['global-c']);
    expect(third.nextCursor).toBeNull();
    const latest = await (await call('reports/latest?scope=injective&type=daily')).json();
    expect(latest.data.reportId).toBe('injective-b');
  });

  it('keeps old report contents accessible while excluding superseded reports from latest lists', async () => {
    insert('original', 1792197000, { superseded: 'corrected' });
    insert('corrected', 1792197100);
    const old = await (await call('reports/original')).json();
    expect(old.data.reportId).toBe('original');
    expect(old.data.publicationStatus).toBe('superseded');
    expect(old.data.supersededByReportId).toBe('corrected');
    expect((await (await call('reports/latest')).json()).data.reportId).toBe('corrected');
    expect((await call('reports/not-found')).status).toBe(404);
  });

  it.each([
    'reports?limit=51',
    'reports?limit=0',
    'reports?scope=personal',
    'reports?type=all',
    'reports?scope=global&scope=injective',
    'reports?asset=BTC',
    'reports?cursor=not-a-cursor',
    'reports/latest?limit=1',
    'reports/a/b',
    'reports/%27',
    'onchain/markets?limit=101',
    'onchain/coverage?scope=private',
    'onchain/series?entity=../private&metric=price',
    'onchain/series?entity=INJ&metric=price&from=20&to=10',
  ])('rejects invalid input: %s', async (path) => {
    const before = changed();
    expect((await call(path)).status).toBe(400);
    expect(changed()).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not mutate through public methods or revive private research paths', async () => {
    const before = changed();
    expect((await call('reports', 'POST')).status).toBe(405);
    expect((await call('onchain/markets', 'POST')).status).toBe(405);
    expect(changed()).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});
