/** Read-only acceptance against the full, verified public-source seed. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { openSqlite } from '../server/sqlite.mjs';
import { createEnvironment } from '../server/environment.mjs';
import worker from '../server-dist/api.mjs';
import { ASSET_REGISTRY } from '../server-dist/assets.mjs';

const database = process.argv[2];
if (!database) throw new Error('Pass the isolated verified SQLite path');
const db = openSqlite(database, { readOnly: true });
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const report = {
  checkedAt: new Date().toISOString(),
  fixture: false,
  assets: [],
  requests: 0,
  errors: [],
};
try {
  const { rsi } = await vite.ssrLoadModule('/shared/math.ts');
  const { networkMetrics } = await vite.ssrLoadModule('/shared/network-catalog.ts');
  const env = await createEnvironment(db);
  const totalBefore = db.sqlite.prepare('SELECT total_changes() n').get().n;
  async function get(path) {
    report.requests++;
    const response = await worker.fetch(new Request('https://seed.test/api/v1/' + path), env, {
      waitUntil: () => {},
    });
    const data = await response.json();
    assert.equal(response.status, 200, path + ' ' + JSON.stringify(data).slice(0, 200));
    return data;
  }
  for (const asset of ASSET_REGISTRY) {
    const result = { asset: asset.id, markets: [], network: [], derivatives: [], reference: false };
    for (const market of ['upbit', 'binance'])
      if (asset.markets[market]) {
        const data = await get(
          `candles?asset=${asset.id}&market=${market}&interval=1d&limit=1000&from=${Math.floor(Date.now() / 1000) - 366 * 86400}`,
        );
        const points = data.data
          .filter((c) => c.closed)
          .map((c) => ({ time: c.time, value: c.close }));
        const values = rsi(points);
        assert.ok(values.every((p) => Number.isFinite(p.value) && p.value >= 0 && p.value <= 100));
        result.markets.push({ market, closedDays: points.length, rsi: values.at(-1) ?? null });
      }
    assert.ok(
      result.markets.some((m) => m.rsi),
      asset.id + ' has no calculable RSI',
    );
    for (const metric of networkMetrics(asset.id)) {
      const data = await get(
        `network?asset=${asset.id}&metric=${metric.id}&limit=1000&from=${Math.floor(Date.now() / 1000) - 30 * 86400}`,
      );
      assert.ok(data.data.length, asset.id + ' ' + metric.id + ' missing recent observations');
      assert.ok(data.data.every((p) => Number.isFinite(p.value)));
      result.network.push({ metric: metric.id, unit: data.meta.unit, last: data.data.at(-1) });
    }
    if (asset.network?.metrics.PriceUSD) {
      const data = await get(
        `reference?asset=${asset.id}&limit=1000&from=${Math.floor(Date.now() / 1000) - 30 * 86400}`,
      );
      assert.ok(data.data.length, asset.id + ' missing reference');
      assert.equal(data.meta.unit, 'USD');
      result.reference = true;
    }
    if (asset.derivative)
      for (const metric of [
        'funding',
        'open_interest',
        'long_account_ratio',
        'open_interest_daily',
        'long_account_ratio_daily',
      ]) {
        const data = await get(`derivatives?asset=${asset.id}&metric=${metric}&limit=1000`);
        assert.ok(data.data.length, asset.id + ' missing ' + metric);
        result.derivatives.push({ metric, unit: data.meta.unit, rows: data.data.length });
      }
    report.assets.push(result);
    console.log(asset.id, 'ok');
  }
  assert.equal(db.sqlite.prepare('SELECT total_changes() n').get().n, totalBefore);
  report.writes = 0;
  report.stages = [30, 75, 150].map((n) => ({
    assets: n,
    verified: report.assets.slice(0, n).length === n,
  }));
} catch (error) {
  report.errors.push(error.message);
  process.exitCode = 1;
} finally {
  writeFileSync('work/registry-150/api-acceptance.json', JSON.stringify(report, null, 2));
  db.sqlite.close();
  await vite.close();
}
console.log(
  JSON.stringify({
    assets: report.assets.length,
    requests: report.requests,
    errors: report.errors,
  }),
);
