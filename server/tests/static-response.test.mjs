import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { staticResponder } from '../static-response.mjs';

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
