import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchResponse } from '../search.mjs';
import { securityHeaders, requestBudget } from '../security.mjs';
test('native FTS5 Korean body search and precise contextual navigation', async () => {
  const result = await searchResponse(new URLSearchParams({ q: '비트코인 고평가' }));
  assert.equal(result.mode, 'fts5-trigram-bm25');
  assert.equal(result.hits[0].asset, 'BTC');
  assert.equal(result.hits[0].metric, 'net:mvrv');
  assert.ok((await searchResponse(new URLSearchParams({ q: '모집단 표준편차' }))).hits.length > 0);
  await assert.rejects(searchResponse(new URLSearchParams({ q: 'x', limit: '999' })));
});
test('security policy supports local images/workers and limits resource abuse without trusting proxy input', () => {
  const headers = new Headers();
  securityHeaders(headers, { https: true });
  assert.ok(headers.has('Content-Security-Policy-Report-Only'));
  assert.match(headers.get('Strict-Transport-Security'), /31536000/);
  securityHeaders(headers, { mode: 'enforce' });
  assert.match(headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  let time = 60000;
  const allow = requestBudget({ perClient: 2, global: 3, now: () => time });
  assert.equal(allow('peer-a'), true);
  assert.equal(allow('peer-a'), true);
  assert.equal(allow('peer-a'), false);
  assert.equal(allow('peer-b'), false);
  time += 60000;
  assert.equal(allow('peer-a'), true);
});
