import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisionCache } from '../revision-cache.mjs';
test('read cache invalidates on database revision, age and errors and shares concurrent reads', async () => {
  let version = 1,
    clock = 0,
    reads = 0;
  const cache = revisionCache(
    { prepare: () => ({ get: () => ({ data_version: version }) }) },
    { now: () => clock, ttl: 30, limit: 2 },
  );
  const read = async () => new Response(JSON.stringify({ reads: ++reads }));
  const pair = await Promise.all([cache('a', read), cache('a', read)]);
  assert.deepEqual(await pair[0].json(), await pair[1].json());
  assert.equal(reads, 1);
  version++;
  await cache('a', read);
  assert.equal(reads, 2);
  clock = 31;
  await cache('a', read);
  assert.equal(reads, 3);
  await cache('b', read);
  await cache('c', read);
  await cache('a', read);
  assert.equal(reads, 6);
  for (let i = 0; i < 2; i++)
    await cache('bad', async () => {
      reads++;
      return new Response('fail', { status: 503 });
    });
  assert.equal(reads, 8);
});
