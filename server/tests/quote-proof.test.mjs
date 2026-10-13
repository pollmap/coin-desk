import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteTradeReader } from '../environment.mjs';

test('the collector proof binding reads only bounded selected assets from loopback or private hub', async () => {
  for (const url of [
    'https://quote-hub:8091',
    'http://example.com',
    'http://localhost@external.test',
    'http://127.0.0.1:8091/proxy',
    'http://127.0.0.1:8091/?url=other',
  ])
    assert.throws(() => quoteTradeReader(url));
  assert.equal(quoteTradeReader(undefined), undefined);
  const calls = [];
  const read = quoteTradeReader('http://quote-hub:8091', async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      market: 'binance',
      trades: [
        { asset: 'BTC', market: 'binance', price: 100, lastTradeId: 1, tradedAt: 1800000000 },
        { asset: 'DOGE', market: 'binance', price: 0.1, lastTradeId: 2, tradedAt: 1800000000 },
      ],
    });
  });
  assert.deepEqual(
    (await read(['BTC'])).map((t) => t.asset),
    ['BTC'],
  );
  assert.equal(new URL(calls[0].url).pathname, '/snapshot');
  assert.equal(new URL(calls[0].url).searchParams.get('assets'), 'BTC');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  for (const ids of [[], ['UNKNOWN'], ['BTC', 'BTC'], Array(9).fill('BTC')])
    await assert.rejects(read(ids));
  const invalid = quoteTradeReader('http://127.0.0.1:8091', async () =>
    Response.json({ market: 'upbit', trades: [] }),
  );
  await assert.rejects(invalid(['BTC']));
  const failed = quoteTradeReader(
    'http://127.0.0.1:8091',
    async () => new Response('', { status: 503 }),
  );
  await assert.rejects(failed(['BTC']));
});
