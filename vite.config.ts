import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { chartTouchCancelPlugin } from './scripts/chart-touch-cancel';
const privateWork = fileURLToPath(new URL('./work', import.meta.url)).replaceAll('\\', '/');
export default defineConfig({
  plugins: [chartTouchCancelPlugin(), react()],
  // Keep this one dependency in the reviewed transform path in dev as well as build.
  optimizeDeps: { entries: ['index.html'], exclude: ['lightweight-charts'] },
  // Preserve upstream license and the narrowly reviewed modification notice.
  esbuild: { legalComments: 'inline' },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    watch: {
      ignored: [
        privateWork + '/**',
        '**/.wrangler/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/docs/**',
        '**/deployment-artifacts/**',
      ],
    },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', privateWork + '/**'] },
  },
  build: { chunkSizeWarningLimit: 650 },
});
