import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { openDatabase } from './local-db.mjs';

const DB = openDatabase('work/derivatives-history.sqlite');
const base = process.argv[2] || 'https://coin-desk.pages.dev';
const summary = [];
try {
  for (const asset of ['BTC', 'DOGE', 'ETH'])
    for (const metric of ['open_interest_daily', 'long_account_ratio_daily']) {
      const expected = DB.sqlite
        .prepare(
          'SELECT time,value FROM derivative_series WHERE asset=? AND metric=? ORDER BY time',
        )
        .all(asset, metric);
      assert.ok(expected.length > 1000, 'Local bootstrap must exist');
      const actual = [];
      let from = 0;
      for (let page = 0; page < 20; page++) {
        const response = await fetch(
          base +
            '/api/v1/derivatives?' +
            new URLSearchParams({ asset, metric, from: String(from), limit: '1000' }),
        );
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.meta.observationInterval, '1d');
        assert.equal(payload.meta.unit, metric === 'open_interest_daily' ? asset : '%');
        actual.push(...payload.data);
        if (payload.nextCursor === null) break;
        assert.ok(payload.nextCursor > from, 'Cursor must advance');
        from = payload.nextCursor;
      }
      const observed = new Map(actual.map((point) => [point.time, point.value]));
      assert.equal(observed.size, actual.length, 'No duplicate dates');
      for (const point of expected)
        assert.equal(
          observed.get(point.time),
          point.value,
          asset + ' ' + metric + ' ' + point.time,
        );
      const record = {
        asset,
        metric,
        verified: expected.length,
        first: expected[0].time,
        last: expected.at(-1).time,
      };
      summary.push(record);
      console.log(JSON.stringify(record));
    }
  writeFileSync(
    'work/derivatives-public-verification.json',
    JSON.stringify({ checkedAt: new Date().toISOString(), base, summary }, null, 2),
  );
} finally {
  DB.sqlite.close();
}
