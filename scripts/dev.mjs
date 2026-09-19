import './local-api.mjs';
import { createServer } from 'vite';
const web = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await web.listen();
web.printUrls();
