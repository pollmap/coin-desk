import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
import {
  parsePublicFeed,
  collectPublicSource,
  publicResearchFeed,
  refreshPublicResearch,
} from '../worker/public-research';
import { PUBLIC_SOURCES } from '../shared/public-research';
import { HISTORY_EVENTS, eventsForAsset } from '../shared/history-events';
import { parseDerivativeRows } from '../worker/derivatives';
import { DOMINANCE_VERSION } from '../worker/dominance';
import worker from '../worker/index';
import { jobPolicies, selectJob } from '../worker/health';
let DB, env;
const now = 1790217417;
const rss =
  '<rss><channel><item><title>Ethereum &amp; DOGE update</title><link>https://blog.ethereum.org/2026/09/20/update</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>';
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  DB = openDatabase(':memory:');
  env = { DB, ENABLED_ASSETS: 'BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE' };
  vi.stubGlobal('caches', { default: memoryCache() });
});
afterEach(() => {
  DB.sqlite.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('parses only source-owned feed links, explicit coin names, and valid dates', () => {
  const source = PUBLIC_SOURCES[0];
  expect(parsePublicFeed(rss, source, now)[0]).toMatchObject({
    title: 'Ethereum & DOGE update',
    assets: ['ETH', 'DOGE'],
  });
  expect(() =>
    parsePublicFeed(rss.replace('https://blog.ethereum.org/', 'https://evil.test/'), source, now),
  ).toThrow();
  expect(() => parsePublicFeed(rss.replace('2026 12:00', '2028 12:00'), source, now)).toThrow();
  expect(() =>
    parsePublicFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]>' + rss, source, now),
  ).toThrow();
  expect(() => parsePublicFeed('<html>Sign in</html>', source, now)).toThrow();
});
it('uses canonical own-author X status ids and rejects another author or a challenge page', () => {
  const source = PUBLIC_SOURCES.find((s) => s.handle === 'cantonmeow' && s.kind === 'x');
  const id = String(BigInt(now * 1000 - 1288834974657) << 22n);
  const html = `<article><a href="/cantonmeow/status/${id}">DOGE chart</a><script>{"timestamp":${now * 1000}}</script></article>`;
  expect(parsePublicFeed(html, source, now)[0]).toMatchObject({
    id,
    assets: ['DOGE'],
    publishedAt: now,
  });
  expect(() =>
    parsePublicFeed(html.replace('/cantonmeow/', '/someoneelse/'), source, now),
  ).toThrow();
  expect(() => parsePublicFeed('<html>Log in to continue</html>', source, now)).toThrow();
});
it('collects without credentials, limits duplicate ticks, and public reads never crawl', async () => {
  const fetcher = vi.fn(async () => new Response(rss));
  vi.stubGlobal('fetch', fetcher);
  await Promise.all([refreshPublicResearch(env), refreshPublicResearch(env)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const output = await worker.fetch(new Request('https://desk.test/api/v1/research/public'), env, {
    waitUntil: () => {},
  });
  expect(output.status).toBe(200);
  const data = await output.json();
  expect(data.posts).toHaveLength(1);
  expect(data.independentOfVisitors).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const invalid = await worker.fetch(
    new Request('https://desk.test/api/v1/research/public?url=https://evil.test'),
    env,
    { waitUntil: () => {} },
  );
  expect(invalid.status).toBe(400);
});
it('retains last successful posts on failure, reports failure, and removes stale posts after 24h', async () => {
  const fetcher = vi.fn(async () => new Response(rss));
  vi.stubGlobal('fetch', fetcher);
  await collectPublicSource(env, PUBLIC_SOURCES[0]);
  fetcher.mockImplementation(async () => new Response('private details', { status: 403 }));
  await collectPublicSource(env, PUBLIC_SOURCES[0]);
  const data = await publicResearchFeed(env);
  expect(data.posts).toHaveLength(1);
  expect(data.sources[0].state).toBe('error');
  expect(JSON.stringify(data)).not.toContain('private details');
  vi.spyOn(Date, 'now').mockReturnValue((now + 86401) * 1000);
  expect((await publicResearchFeed(env)).posts).toHaveLength(0);
});
it('normalizes 1000PEPE open interest into PEPE but does not multiply funding or account shares', () => {
  const oi = {
    retCode: 0,
    result: {
      category: 'linear',
      symbol: '1000PEPEUSDT',
      list: [{ timestamp: String(now * 1000), openInterest: '123' }],
    },
  };
  expect(parseDerivativeRows(oi, 'PEPE', 'open_interest', now)[0].value).toBe(123000);
  const funding = {
    retCode: 0,
    result: {
      category: 'linear',
      list: [
        { symbol: '1000PEPEUSDT', fundingRateTimestamp: String(now * 1000), fundingRate: '0.0001' },
      ],
    },
  };
  expect(parseDerivativeRows(funding, 'PEPE', 'funding', now)[0].value).toBe(0.01);
  expect(() => parseDerivativeRows(oi, 'DOGE', 'open_interest', now)).toThrow();
});
it('returns dominance history from the beginning and follows a non-overlapping cursor past 1000 rows', async () => {
  const insert = DB.sqlite.prepare(
    'INSERT INTO dominance_history(time,data,fetched_at) VALUES(?,?,1790217417)',
  );
  for (let i = 0; i < 1002; i++)
    insert.run(
      1700000000 + i * 3600,
      JSON.stringify({
        calculationVersion: DOMINANCE_VERSION,
        coins: [{ id: 'DOGE', value: 0.5 }],
      }),
    );
  const get = async (query) =>
    (
      await worker.fetch(new Request('https://desk.test/api/v1/dominance/history' + query), env, {
        waitUntil: () => {},
      })
    ).json();
  const first = await get('');
  expect(first.data).toHaveLength(1000);
  expect(first.data[0].time).toBe(1700000000);
  const last = await get('?from=' + first.nextCursor);
  expect(last.data).toHaveLength(2);
  expect(last.nextCursor).toBeNull();
  expect(last.data[0].time).toBeGreaterThan(first.data.at(-1).time);
});
it('keeps sourced chronology separate from prices and gives every supported coin relevant events', () => {
  expect(new Set(HISTORY_EVENTS.map((e) => e.id)).size).toBe(HISTORY_EVENTS.length);
  for (const asset of ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE'])
    expect(eventsForAsset(asset, false).length).toBeGreaterThan(0);
  for (const event of HISTORY_EVENTS) {
    expect(new URL(event.source).protocol).toBe('https:');
    expect(Number.isFinite(Date.parse(event.date))).toBe(true);
  }
  expect(eventsForAsset('DOGE', false).some((e) => e.id === 'bitcoin-genesis')).toBe(false);
});
it('follows canonical same-source redirects but refuses an arbitrary destination', async () => {
  const source = PUBLIC_SOURCES[0];
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { Location: '/en/feed.xml' } }),
    )
    .mockResolvedValueOnce(new Response(rss));
  vi.stubGlobal('fetch', fetcher);
  await collectPublicSource(env, source);
  expect((await publicResearchFeed(env)).sources[0].state).toBe('ready');
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher
    .mockReset()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://evil.test/feed' } }),
    );
  await collectPublicSource(env, source);
  expect((await publicResearchFeed(env)).sources[0].state).toBe('error');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('prioritizes primary coins while keeping secondary collection eligible and bounded', () => {
  const jobs = jobPolicies(['BTC', 'DOGE', 'ETH', 'SOL'], false).filter(
    (j) => j.kind === 'derivatives' && j.key.endsWith(':funding'),
  );
  expect(jobs.find((j) => j.assets[0] === 'BTC').every).toBe(300);
  expect(jobs.find((j) => j.assets[0] === 'SOL').every).toBe(21600);
  const states = jobs.map((j) => ({
    key: j.key,
    last_attempt: now - (j.assets[0] === 'SOL' ? 30000 : 4000),
    last_success: now - 60,
    data_as_of: now - 60,
    failures: 0,
    next_attempt: 0,
  }));
  expect(selectJob(jobs, states, now).assets[0]).toBe('BTC');
});
