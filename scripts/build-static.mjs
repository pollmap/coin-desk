import { constants, brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const brotli = promisify(brotliCompress),
  deflate = promisify(gzip);
const digest = (body) => createHash('sha256').update(body).digest('hex');

/** Build-time only. Keep encoded files outside the public tree and key by original bytes. */
export async function buildStaticEncodings({
  sourceRoot = 'dist/assets',
  outputRoot = 'server-dist/static-precompressed',
} = {}) {
  const source = resolve(sourceRoot),
    output = resolve(outputRoot);
  if (output === source || output.startsWith(source + sep))
    throw new Error('Encoded files must be outside the public asset tree');
  const manifest = { version: 1, brotliQuality: 11, gzipLevel: 9, files: [] };
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' && directory === source) return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !['.js', '.css'].includes(extname(entry.name))) continue;
      const body = await readFile(path);
      if (body.length < 512 || body.length > 2 * 1024 * 1024) continue;
      const [br, gz] = await Promise.all([
        brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        deflate(body, { level: 9 }),
      ]);
      // The runtime refuses oversized representations as well.
      if (br.length >= body.length || gz.length >= body.length) continue;
      const sha256 = digest(body);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, sha256 + '.br'), br);
      await writeFile(join(output, sha256 + '.gzip'), gz);
      manifest.files.push({ sha256, bytes: body.length, brBytes: br.length, gzipBytes: gz.length });
    }
  }
  await visit(source);
  if (manifest.files.length)
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildStaticEncodings();
  console.log(
    JSON.stringify({
      event: 'static-precompression-built',
      files: manifest.files.length,
      originalBytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
      brotliBytes: manifest.files.reduce((n, f) => n + f.brBytes, 0),
    }),
  );
}
