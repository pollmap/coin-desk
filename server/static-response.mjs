import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress),
  deflate = promisify(gzip);
function preferredEncoding(header, compressible) {
  const weights = new Map();
  for (const part of (header || '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const value = q ? Number(q.slice(2)) : 1;
    weights.set(name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  const quality = (name) =>
    weights.get(name) ??
    (name === 'identity' ? (weights.get('*') === 0 ? 0 : 1) : (weights.get('*') ?? 0));
  return (compressible ? ['br', 'gzip', 'identity'] : ['identity'])
    .filter((name) => quality(name) > 0)
    .sort((a, b) => quality(b) - quality(a))[0];
}

/** Public static files only. Never store API, SSE or personal data here. */
export function staticResponder({ maxBytes = 16 * 1024 * 1024, maxEntries = 64 } = {}) {
  const cache = new Map();
  let cachedBytes = 0;
  return async function respond(file, { mime, cacheControl, publicOrigin, headers = {} }) {
    const info = await stat(file);
    const key = JSON.stringify([file, info.size, info.mtimeMs, info.ctimeMs, publicOrigin]);
    let item = cache.get(key);
    if (item) {
      cache.delete(key);
      cache.set(key, item);
    } else {
      let data = await readFile(file);
      if (publicOrigin && mime.startsWith('text/html'))
        data = Buffer.from(
          data.toString('utf8').replaceAll('https://coin-desk.pages.dev', publicOrigin),
        );
      const compressible =
        /^(text\/|application\/json|image\/svg\+xml)/.test(mime) &&
        data.length >= 512 &&
        data.length <= 2 * 1024 * 1024;
      const bodies = { identity: data };
      if (compressible) {
        [bodies.br, bodies.gzip] = await Promise.all([
          brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
          deflate(data, { level: 6 }),
        ]);
      }
      item = {
        bodies,
        compressible,
        etag: 'W/"' + createHash('sha256').update(data).digest('hex') + '"',
      };
      item.bytes = Object.values(bodies).reduce((n, body) => n + body.length, 0);
      // Concurrent cold requests may finish together. Account for replacement too.
      if (cache.has(key)) {
        cachedBytes -= cache.get(key).bytes;
        cache.delete(key);
      }
      if (item.bytes <= maxBytes) {
        while (cache.size && (cache.size >= maxEntries || cachedBytes + item.bytes > maxBytes)) {
          const oldest = cache.keys().next().value;
          cachedBytes -= cache.get(oldest).bytes;
          cache.delete(oldest);
        }
        cache.set(key, item);
        cachedBytes += item.bytes;
      }
    }
    const responseHeaders = {
      'content-type': mime,
      'cache-control': cacheControl,
      etag: item.etag,
      vary: 'Accept-Encoding',
    };
    const encoding = preferredEncoding(headers['accept-encoding'], item.compressible);
    if (!encoding)
      return new Response(null, {
        status: 406,
        headers: { vary: 'Accept-Encoding', 'cache-control': 'no-store' },
      });
    const tags = (headers['if-none-match'] || '')
      .split(',')
      .map((tag) => tag.trim().replace(/^W\//, ''));
    if (tags.includes('*') || tags.includes(item.etag.slice(2)))
      return new Response(null, { status: 304, headers: responseHeaders });
    const body = item.bodies[encoding];
    if (encoding !== 'identity') responseHeaders['content-encoding'] = encoding;
    responseHeaders['content-length'] = String(body.length);
    return new Response(body, { headers: responseHeaders });
  };
}
