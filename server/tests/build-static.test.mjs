import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { buildStaticEncodings } from '../../scripts/build-static.mjs';
import { createHttpServer } from '../http.mjs';

test('Build-time encodings retain exact source bytes outside the public tree and are reproducible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coin-static-build-'));
  try {
    const sourceRoot = join(root, 'dist/assets'),
      outputRoot = join(root, 'server-dist/encoded');
    await mkdir(join(sourceRoot, 'nested'), { recursive: true });
    const sources = [
      Buffer.from('export const text="' + '코인과 지표 '.repeat(400) + '";'),
      Buffer.from('.chart{color:#202633;background:#fff}'.repeat(100)),
    ];
    await writeFile(join(sourceRoot, 'entry.js'), sources[0]);
    await writeFile(join(sourceRoot, 'nested/chart.css'), sources[1]);
    await writeFile(join(sourceRoot, 'small.js'), 'export default 1;');
    await writeFile(join(sourceRoot, 'image.png'), Buffer.alloc(1024, 1));
    await writeFile(join(sourceRoot, 'outside.html'), '<h1>'.repeat(1024));
    const first = await buildStaticEncodings({ sourceRoot, outputRoot });
    assert.equal(first.files.length, 2);
    for (const body of sources) {
      const hash = createHash('sha256').update(body).digest('hex');
      const entry = first.files.find((f) => f.sha256 === hash);
      assert.equal(entry.bytes, body.length);
      assert.deepEqual(brotliDecompressSync(await readFile(join(outputRoot, hash + '.br'))), body);
      assert.deepEqual(gunzipSync(await readFile(join(outputRoot, hash + '.gzip'))), body);
      assert.ok(entry.brBytes < body.length && entry.gzipBytes < body.length);
    }
    const before = await Promise.all(
      (await readdir(outputRoot))
        .sort()
        .map(async (name) => [name, await readFile(join(outputRoot, name))]),
    );
    assert.deepEqual(await buildStaticEncodings({ sourceRoot, outputRoot }), first);
    for (const [name, body] of before)
      assert.deepEqual(await readFile(join(outputRoot, name)), body);
    assert.deepEqual(await readFile(join(sourceRoot, 'entry.js')), sources[0]);
    assert.equal(
      (await readdir(sourceRoot)).some((n) => n.endsWith('.br') || n.endsWith('.gzip')),
      false,
    );
    await assert.rejects(
      buildStaticEncodings({ sourceRoot, outputRoot: join(sourceRoot, 'encoded') }),
      /outside/,
    );
    assert.deepEqual(
      (await buildStaticEncodings({ sourceRoot: join(root, 'missing'), outputRoot })).files,
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP HEAD, ignored Range, CSP, API and missing static paths keep their contracts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coin-static-http-'));
  let app;
  try {
    const sourceRoot = join(root, 'dist/assets'),
      outputRoot = join(root, 'encoded');
    await mkdir(sourceRoot, { recursive: true });
    const body = 'export const value="' + 'deterministic original '.repeat(100) + '";';
    await writeFile(join(sourceRoot, 'entry.js'), body);
    await writeFile(join(root, 'dist/index.html'), '<main>Static page</main>');
    const manifest = await buildStaticEncodings({ sourceRoot, outputRoot });
    // The HTTP server uses its production default; response behavior must remain
    // the same whether a precompressed build is present or fallback is needed.
    app = createHttpServer({
      staticRoot: join(root, 'dist'),
      publicOrigin: 'https://own.invalid',
      worker: {
        fetch: async () =>
          new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
      },
      env: {},
    });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const plain = await fetch(base + '/assets/entry.js', {
      headers: { 'Accept-Encoding': 'identity', Range: 'bytes=0-10' },
    });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('content-range'), null);
    assert.equal(await plain.text(), body);
    const head = await fetch(base + '/assets/entry.js', {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'br' },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-encoding'), 'br');
    assert.ok(Number(head.headers.get('content-length')) > 0);
    assert.equal(await head.text(), '');
    assert.match(head.headers.get('content-security-policy-report-only'), /object-src 'none'/);
    for (const path of [
      '/assets/missing.js',
      '/assets/entry.js.br',
      '/static-precompressed/' + manifest.files[0].sha256 + '.br',
    ])
      assert.equal((await fetch(base + path)).status, 404);
    const api = await fetch(base + '/api/v1/reference?asset=BTC');
    assert.equal(api.headers.get('content-encoding'), null);
    assert.deepEqual(await api.json(), { ok: true });
    const stream = await fetch(base + '/api/v1/quotes/stream?market=upbit');
    assert.equal(stream.status, 503);
    assert.equal(stream.headers.get('content-encoding'), null);
  } finally {
    if (app) await app.drain();
    await rm(root, { recursive: true, force: true });
  }
});
