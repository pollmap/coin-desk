import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib';
import { staticResponder } from '../static-response.mjs';
import { buildStaticEncodings } from '../../scripts/build-static.mjs';

test('Static encodings round-trip, respect refusal and revalidate across representations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coin-static-'));
  try {
    const file = join(root, 'main.js'),
      text = 'export const text="' + 'Coin Desk '.repeat(200) + '";';
    await writeFile(file, text);
    const serve = staticResponder({ maxBytes: 5000, maxEntries: 2 });
    const opts = { mime: 'text/javascript', cacheControl: 'public, max-age=31536000, immutable' };
    const br = await serve(file, { ...opts, headers: { 'accept-encoding': 'gzip, br' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.equal(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString(), text);
    const gz = await serve(file, { ...opts, headers: { 'accept-encoding': 'br;q=0, gzip;q=1' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.equal(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString(), text);
    const plain = await serve(file, {
      ...opts,
      headers: { 'accept-encoding': 'br;q=0, gzip;q=0' },
    });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), text);
    const denied = await serve(file, { ...opts, headers: { 'accept-encoding': '*;q=0' } });
    assert.equal(denied.status, 406);
    const unchanged = await serve(file, {
      ...opts,
      headers: {
        'accept-encoding': 'gzip',
        'if-none-match': '"different", ' + br.headers.get('etag'),
      },
    });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');
    assert.equal(unchanged.headers.get('vary'), 'Accept-Encoding');
    await writeFile(file, text + ' // new release');
    const changed = await serve(file, {
      ...opts,
      headers: { 'if-none-match': br.headers.get('etag') },
    });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get('etag'), br.headers.get('etag'));
    for (let i = 0; i < 5; i++) {
      const other = join(root, i + '.js');
      await writeFile(other, text + i);
      await serve(other, opts);
    }
    assert.equal(await (await serve(file, opts)).text(), text + ' // new release');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Static HTML validators include the public origin; images are unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coin-static-origin-'));
  try {
    const file = join(root, 'index.html');
    await writeFile(file, '<a href="https://coin-desk.pages.dev/">Coin Desk</a>');
    const serve = staticResponder(),
      opts = { mime: 'text/html', cacheControl: 'no-cache' };
    const a = await serve(file, { ...opts, publicOrigin: 'https://a.example' });
    const b = await serve(file, {
      ...opts,
      publicOrigin: 'https://b.example',
      headers: { 'if-none-match': a.headers.get('etag') },
    });
    assert.equal(b.status, 200);
    assert.match(await b.text(), /https:\/\/b.example/);
    const image = join(root, 'dog.png'),
      bytes = Buffer.alloc(2048, 123);
    await writeFile(image, bytes);
    const result = await serve(image, {
      mime: 'image/png',
      cacheControl: 'no-cache',
      headers: { 'accept-encoding': 'br' },
    });
    assert.equal(result.headers.get('content-encoding'), null);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Verified build-time bytes preserve negotiation, validators and original content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coin-static-prepared-'));
  try {
    const sourceRoot = join(root, 'assets'),
      precompressedRoot = join(root, 'encoded');
    await mkdir(sourceRoot);
    const file = join(sourceRoot, 'entry.js');
    const text = 'export const words="' + '가격과 추세 Coin Desk '.repeat(300) + '";';
    await writeFile(file, text);
    const manifest = await buildStaticEncodings({ sourceRoot, outputRoot: precompressedRoot });
    const hash = manifest.files[0].sha256;
    const serve = staticResponder({ precompressedRoot });
    const opts = { mime: 'text/javascript', cacheControl: 'public, max-age=31536000, immutable' };
    const br = await serve(file, { ...opts, headers: { 'accept-encoding': 'br, gzip' } });
    const brBytes = Buffer.from(await br.arrayBuffer());
    assert.deepEqual(brBytes, await readFile(join(precompressedRoot, hash + '.br')));
    assert.equal(brotliDecompressSync(brBytes).toString(), text);
    assert.equal(br.headers.get('etag'), 'W/"' + hash + '"');
    assert.equal(br.headers.get('content-length'), String(brBytes.length));
    const gz = await serve(file, {
      ...opts,
      headers: { 'accept-encoding': 'br;q=0,gzip;q=0.8,identity;q=0' },
    });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.equal(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString(), text);
    const identity = await serve(file, {
      ...opts,
      headers: { 'accept-encoding': 'br;q=0,gzip;q=0' },
    });
    assert.equal(identity.headers.get('content-encoding'), null);
    assert.equal(await identity.text(), text);
    const refusal = await serve(file, { ...opts, headers: { 'accept-encoding': '*;q=0' } });
    assert.equal(refusal.status, 406);
    const unchanged = await serve(file, {
      ...opts,
      headers: { 'accept-encoding': 'gzip', 'if-none-match': br.headers.get('etag') },
    });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get('vary'), 'Accept-Encoding');
    assert.equal(await unchanged.text(), '');
    // Corrupt and valid-but-wrong representations both return verified original data.
    for (const invalid of [
      Buffer.from('broken'),
      await readFile(join(precompressedRoot, hash + '.gzip')),
      brotliCompressSync(Buffer.from('A different valid compressed original'.repeat(20))),
      brotliCompressSync(Buffer.alloc(Buffer.byteLength(text) + 1, 1)),
    ]) {
      await writeFile(join(precompressedRoot, hash + '.br'), invalid);
      const cold = staticResponder({ precompressedRoot });
      const response = await cold(file, { ...opts, headers: { 'accept-encoding': 'br' } });
      assert.equal(
        brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString(),
        text,
      );
    }
    await writeFile(file, text + '// corrected source');
    const changed = await serve(file, { ...opts, headers: { 'accept-encoding': 'br' } });
    assert.notEqual(changed.headers.get('etag'), br.headers.get('etag'));
    assert.equal(
      brotliDecompressSync(Buffer.from(await changed.arrayBuffer())).toString(),
      text + '// corrected source',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
