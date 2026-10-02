import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('configured gateway runs on workerd and rejects upstream redirects without following them', async () => {
  const config = JSON.parse(readFileSync('wrangler.vps-gateway.jsonc', 'utf8'));
  const script = (
    await build({
      entryPoints: [config.main],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
    })
  ).outputFiles[0].text;
  let status = 200;
  const requests = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      bindings: { VPS_BASE_URL: 'https://origin.example/' },
      serviceBindings: { ASSETS: () => new Response('static') },
      outboundService: (request) => {
        requests.push({
          url: request.url,
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
        });
        return new Response('{"ok":true}', {
          status,
          headers: {
            location: 'https://other.example/private',
            'content-type': 'application/json',
          },
        });
      },
    }),
  );
  try {
    const response = await mf.dispatchFetch('http://localhost/api/v1/status', {
      headers: { authorization: 'Bearer test-only', cookie: 'test-only=1' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(requests, [
      { url: 'https://origin.example/api/v1/status', authorization: null, cookie: null },
    ]);
    for (status of [301, 302, 303, 307, 308]) {
      const failed = await mf.dispatchFetch('http://localhost/api/v1/status');
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).code, 'UPSTREAM_UNAVAILABLE');
    }
    assert.equal(requests.length, 6);
    assert.ok(requests.every((r) => r.url.startsWith('https://origin.example/')));
  } finally {
    await mf.dispose();
  }
});
