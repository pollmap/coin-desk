import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
let previous;
try {
  previous = JSON.parse(await readFile('server-dist/search-index.json', 'utf8'));
} catch {}
await build({
  configFile: false,
  publicDir: false,
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
        ].map(([name, file]) => [name, resolve(file)]),
      ),
      output: { entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
    },
  },
});
const { buildSearchIndex } = await import('../server-dist/search.mjs');
await writeFile('server-dist/search-index.json', JSON.stringify(buildSearchIndex(previous)));
