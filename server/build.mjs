import { build } from 'vite';
import { resolve } from 'node:path';
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
        ].map(([name, file]) => [name, resolve(file)]),
      ),
      output: { entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
    },
  },
});
