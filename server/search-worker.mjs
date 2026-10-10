import { parentPort } from 'node:worker_threads';
import { executeSearch } from './search.mjs';
parentPort.on('message', async ({ id, params }) => {
  try {
    parentPort.postMessage({ id, result: await executeSearch(new URLSearchParams(params)) });
  } catch {
    parentPort.postMessage({ id, error: true });
  }
});
