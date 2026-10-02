import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUpstreams } from '../upstream-check.mjs';

test('Preflight uses public sources without a DB and records restricted access as failure', async () => {
  const providers = {
    getQuotes: async () => ({ requestFailed: false, errors: [], quotes: [{}, {}, {}] }),
    bitviewPage: async () => ({ rows: [{}] }),
  };
  const fixtures = [
    ['coinmetrics', { data: [{ PriceUSD: '1' }] }],
    ['bybit', { retCode: 0, result: { list: [{}] } }],
    ['llama', [{ tvl: 1 }]],
    ['coinlore', [{ total_mcap: 1 }]],
    ['mempool', { fastestFee: 1 }],
  ];
  const request = async (url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    const match = fixtures.find(([host]) => url.includes(host));
    assert.ok(match, 'Only explicit public sources may be queried');
    return Response.json(match[1]);
  };
  const env = { BITVIEW_BASE_URL: 'https://bitview.space' };
  const success = await checkUpstreams(env, providers, request);
  assert.equal(success.ok, true);
  assert.equal(success.databaseWrites, 0);
  assert.equal(success.checks.length, 8);
  const blocked = await checkUpstreams(env, providers, async (url, init) =>
    url.includes('bybit')
      ? new Response('untrusted sensitive error', { status: 403 })
      : request(url, init),
  );
  assert.equal(blocked.ok, false);
  assert.deepEqual(
    blocked.checks.find((row) => row.source === 'bybit'),
    { source: 'bybit', ok: false, reason: 'HTTP 403' },
  );
  providers.getQuotes = async () => ({
    requestFailed: false,
    errors: [{ error: 'token should not be logged' }],
    quotes: [],
  });
  const stale = await checkUpstreams(env, providers, request);
  assert.equal(stale.ok, false);
  assert.equal(JSON.stringify(stale).includes('token should not be logged'), false);
  const permissionDenied = await checkUpstreams(env, providers, async () => {
    throw new TypeError('sensitive connection details', { cause: { code: 'EACCES' } });
  });
  assert.equal(
    permissionDenied.checks.find((r) => r.source === 'coin-metrics').reason,
    'network-permission-denied',
  );
  assert.equal(JSON.stringify(permissionDenied).includes('sensitive connection details'), false);
});
