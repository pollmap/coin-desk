import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteHub } from '../quote-hub.mjs';
import { createHttpServer } from '../http.mjs';

test(
  'Native SSE proxy streams immediately and disconnects without buffering',
  { timeout: 15000 },
  async () => {
    const hub = createQuoteHub();
    await new Promise((r) => hub.server.listen(0, '127.0.0.1', r));
    const app = createHttpServer({
      worker: { fetch: () => new Response('unknown', { status: 404 }) },
      env: {},
      database: {},
      quoteHubUrl: 'http://127.0.0.1:' + hub.server.address().port,
    });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const stop = new AbortController();
    const deadline = setTimeout(() => stop.abort(), 12000);
    try {
      assert.equal((await fetch(base + '/api/v1/quotes/stream?market=__proto__')).status, 400);
      const res = await fetch(base + '/api/v1/quotes/stream?market=upbit', { signal: stop.signal });
      assert.equal(res.headers.get('content-type'), 'text/event-stream');
      assert.equal(res.headers.get('x-accel-buffering'), 'no');
      const reader = res.body.getReader();
      assert.match(new TextDecoder().decode((await reader.read()).value), /event: quotes/);
      hub.ingest('upbit', {
        type: 'ticker',
        code: 'KRW-BTC',
        trade_price: 123456,
        trade_timestamp: Date.now(),
      });
      let body = '';
      while (!body.includes('123456'))
        body += new TextDecoder().decode((await reader.read()).value);
      assert.match(body, /tradedAt/);
    } finally {
      clearTimeout(deadline);
      stop.abort();
      await app.drain();
      await hub.close();
    }
  },
);
