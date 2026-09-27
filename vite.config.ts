import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const privateWork = fileURLToPath(new URL('./work', import.meta.url)).replaceAll('\\', '/');
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    watch: {
      ignored: [
        privateWork + '/**',
        '**/.wrangler/**',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', privateWork + '/**'] },
  },
  build: { chunkSizeWarningLimit: 650 },
});
