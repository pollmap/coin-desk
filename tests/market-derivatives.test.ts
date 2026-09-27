import { expect, it } from 'vitest';
// @ts-expect-error JavaScript-only SQLite adapter.
import { openDatabase } from '../scripts/local-db.mjs';
import { marketDerivatives } from '../worker/market-derivatives';

it('isolates asset/unit/metric, ignores future points, preserves missing and failed data without writes', async () => {
  const db = openDatabase(':memory:');
  try {
    const now = 1800000000;
    const add = db.sqlite.prepare('INSERT INTO derivative_series VALUES (?,?,?,?,?)');
    add.run('BTC', 'funding', now - 3600, 0.0123, now);
    add.run('BTC', 'funding', now + 3600, 99, now);
    add.run('BTC', 'open_interest', now - 3600, 12500, now);
    add.run('BTC', 'open_interest_daily', now - 3600, 99999, now);
    add.run('DOGE', 'long_account_ratio', now - 4 * 3600, 65, now);
    add.run('ETH', 'funding', now - 3600, -0.001, now);
    db.sqlite
      .prepare('INSERT INTO ingestion(key,last_success,error) VALUES(?,?,?)')
      .run('derivatives:ETH:funding', now - 7200, 'HTTP 502');
    const before = db.sqlite.prepare('SELECT total_changes() AS n').get().n;
    const result = await marketDerivatives(db, ['BTC', 'DOGE', 'ETH'], now);
    expect(result.data.map((r) => r.asset)).toEqual(['BTC', 'DOGE', 'ETH']);
    expect(result.data[0].funding).toMatchObject({ value: 0.0123, stale: false });
    expect(result.data[0].open_interest?.value).toBe(12500);
    expect(result.data[0].long_account_ratio).toBeNull();
    expect(result.data[1].long_account_ratio).toMatchObject({ value: 65, stale: true });
    expect(result.data[2].funding).toMatchObject({ value: -0.001, stale: true });
    expect(db.sqlite.prepare('SELECT total_changes() AS n').get().n).toBe(before);
  } finally {
    db.sqlite.close();
  }
});
