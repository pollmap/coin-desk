import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyCapacity } from '../history-capacity.mjs';

test('history pauses at low space or failed disk inspection and resumes after recovery', () => {
  let time = 0,
    calls = 0,
    free = 3 * 1024 ** 3,
    failed = false;
  const allowed = historyCapacity('/isolated/data', {
    now: () => time,
    statfs: () => {
      calls++;
      if (failed) throw new Error('inspection failed');
      return { bavail: free, bsize: 1 };
    },
  });
  assert.equal(allowed(), true);
  free = 1024 ** 3;
  assert.equal(allowed(), true);
  assert.equal(calls, 1);
  time += 60000;
  assert.equal(allowed(), false);
  free = 2 * 1024 ** 3;
  time += 60000;
  assert.equal(allowed(), true);
  failed = true;
  time += 60000;
  assert.equal(allowed(), false);
});
