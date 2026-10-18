import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { buildStaticEncodings } from '../scripts/build-static.mjs';
let previous;
try {
  previous = JSON.parse(await readFile('server-dist/search-index.json', 'utf8'));
} catch {}
await build({
  configFile: false,
  publicDir: false,
  // The runtime image has no npm tree. Keep the isolated report worker and
  // its decimal/SDK dependencies runnable from this verified artifact alone.
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: 'node24',
    outDir: 'server-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        [
          ['api', 'worker/index.ts'],
          ['collector', 'worker/collector-entry.ts'],
          ['scheduled', 'worker/scheduled.ts'],
          ['observations', 'worker/observations.ts'],
          ['feed', 'worker/market-feed.ts'],
          ['providers', 'worker/providers.ts'],
          ['assets', 'shared/asset-registry.ts'],
          ['search', 'shared/search.ts'],
          ['history-recovery', 'worker/history-recovery.ts'],
          ['derivatives', 'worker/derivatives.ts'],
          ['backfill-budget', 'worker/backfill-budget.ts'],
          ['history-operator', 'worker/history-operator.ts'],
          ['research', 'worker/onchain/entry.ts'],
        ].map(([name, file]) => [name, resolve(file)]),
      ),
      output: { entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
    },
  },
});
const { buildSearchIndex } = await import('../server-dist/search.mjs');
await writeFile('server-dist/search-index.json', JSON.stringify(buildSearchIndex(previous)));
// Docker builds the frontend first. Tests without dist keep the existing fallback.
const encoded = await buildStaticEncodings();
console.log(JSON.stringify({ event: 'static-precompression-built', files: encoded.files.length }));
