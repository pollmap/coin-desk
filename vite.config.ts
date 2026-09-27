import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    watch: {
      ignored: ['**/work/**', '**/.wrangler/**', '**/test-results/**', '**/playwright-report/**'],
    },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/work/**'] },
  },
  build: { chunkSizeWarningLimit: 650 },
});
