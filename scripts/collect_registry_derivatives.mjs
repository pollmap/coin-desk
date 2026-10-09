/** Validated recent public Bybit observations; isolated local DB, never production. */
import { createServer } from 'vite';
import {
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  renameSync,
  statfsSync,
} from 'node:fs';
import { openDatabase } from './local-db.mjs';
import { createEnvironment } from '../server/environment.mjs';
const folder = 'work/registry-150/derivatives';
mkdirSync(folder, { recursive: true });
const checkpoint = folder + '/checkpoint.json';
const report = existsSync(checkpoint)
  ? JSON.parse(readFileSync(checkpoint, 'utf8'))
  : { sources: {} };
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const DB = openDatabase(folder + '/observations.sqlite');
try {
  const { updateDerivatives, DERIVATIVE_ASSETS, DERIVATIVE_METRICS } =
    await vite.ssrLoadModule('/worker/derivatives.ts');
  const { derivativeContract } = await vite.ssrLoadModule('/shared/derivative-contracts.ts');
  const env = await createEnvironment(DB);
  for (const asset of DERIVATIVE_ASSETS)
    for (const metric of DERIVATIVE_METRICS) {
      const key = `${asset}:${metric}`;
      const mapping = JSON.stringify(derivativeContract(asset));
      if (report.sources[key]?.status === 'complete' && report.sources[key].mapping === mapping)
        continue;
      const disk = statfsSync(folder);
      if (disk.bavail * disk.bsize < 2 * 1024 ** 3)
        throw new Error('Less than 2 GiB free; history paused');
      try {
        await updateDerivatives(env, asset, metric, true);
        const extent = DB.sqlite
          .prepare(
            'SELECT COUNT(*) observations,MIN(time) first,MAX(time) last FROM derivative_series WHERE asset=? AND metric=?',
          )
          .get(asset, metric);
        if (!extent.observations) throw new Error('No valid source observations');
        report.sources[key] = {
          status: 'complete',
          mapping,
          ...extent,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        report.sources[key] = {
          status: 'error',
          mapping,
          error: String(error.message).slice(0, 240),
          checkedAt: new Date().toISOString(),
        };
      }
      report.total = DERIVATIVE_ASSETS.length * DERIVATIVE_METRICS.length;
      writeFileSync(checkpoint + '.tmp', JSON.stringify(report, null, 2));
      renameSync(checkpoint + '.tmp', checkpoint);
      console.log(
        key,
        report.sources[key].status,
        report.sources[key].error ?? report.sources[key].observations,
      );
      await new Promise((r) => setTimeout(r, 400));
    }
} finally {
  DB.sqlite.close();
  await vite.close();
}
