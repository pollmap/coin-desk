import { expect, it } from 'vitest';
// @ts-expect-error JavaScript-only SQLite adapter.
import { openDatabase } from '../scripts/local-db.mjs';
import { readDerivativeExtent } from '../worker/derivatives';

it('seeks partition endpoints without mixing assets or metrics, including empty history', async () => {
  const db = openDatabase(':memory:');
  try {
    const add = db.sqlite.prepare('INSERT INTO derivative_series VALUES (?,?,?,?,?)');
    for (const time of [300, 100, 200]) add.run('BTC', 'funding', time, 0.01, 1);
    add.run('ETH', 'funding', 999, 0.01, 1);
    add.run('BTC', 'open_interest', 1, 500, 1);
    expect(await readDerivativeExtent(db, 'BTC', 'funding')).toEqual({ first: 100, last: 300 });
    expect(await readDerivativeExtent(db, 'ETH', 'funding')).toEqual({ first: 999, last: 999 });
    expect(await readDerivativeExtent(db, 'BTC', 'open_interest')).toEqual({ first: 1, last: 1 });
    expect(await readDerivativeExtent(db, 'DOGE', 'funding')).toEqual({ first: null, last: null });
  } finally {
    db.sqlite.close();
  }
});
