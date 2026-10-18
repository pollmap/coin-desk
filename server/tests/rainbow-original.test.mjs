import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOriginalReferenceStore } from '../rainbow-original.mjs';
import { createHttpServer } from '../http.mjs';
import { createEnvironment } from '../environment.mjs';
import worker from '../../server-dist/api.mjs';
import {
  ORIGINAL_RAINBOW_BASELINE as baseline,
  createOriginalReference,
} from '../../server-dist/rainbow-original-reference.mjs';

const tomorrow = Date.parse('2026-10-20T00:00:00Z') / 1000;
const enough = async () => 20 * 1024 ** 3;
const silent = () => {};

test('daily metadata refresh preserves historical versions and read APIs never trigger a fetch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bori-original-'));
  let clock = tomorrow,
    fetches = 0;
  const dates = [...baseline.dates, '2026-10-19'];
  const store = await createOriginalReferenceStore({
    directory,
    now: () => clock,
    freeBytes: enough,
    log: silent,
    fetchReference: async (previous) => {
      fetches++;
      return createOriginalReference(dates, previous, clock);
    },
  });
  let app;
  try {
    assert.equal((await store.read()).snapshotId, baseline.snapshotId);
    const first = await store.refresh();
    assert.equal(first.refreshed, true);
    assert.equal(first.reference.modelVersion, baseline.modelVersion);
    assert.equal(fetches, 1);
    assert.equal((await store.refresh()).reason, 'not_due');
    clock += 86400;
    dates.splice(dates.indexOf('2024-05-25'), 0, '2024-05-24');
    const changed = await store.refresh();
    assert.equal(changed.refreshed, true);
    assert.notEqual(changed.reference.modelVersion, baseline.modelVersion);
    assert.equal((await store.read(baseline.modelVersion)).snapshotId, first.reference.snapshotId);
    assert.equal((await store.read()).snapshotId, changed.reference.snapshotId);
    assert.equal(await store.read('bc-original-000000000000-000000000000'), null);
    const restarted = await createOriginalReferenceStore({
      directory,
      now: () => clock,
      freeBytes: enough,
      log: silent,
    });
    assert.equal((await restarted.read()).snapshotId, changed.reference.snapshotId);
    assert.equal(
      (await restarted.read(baseline.modelVersion)).snapshotId,
      first.reference.snapshotId,
    );
    assert.equal((await restarted.refresh()).reason, 'not_due');
    await restarted.stop();
    const env = await createEnvironment({});
    env.ORIGINAL_RAINBOW_REFERENCE = store.read;
    app = createHttpServer({ worker, env });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const url =
      'http://127.0.0.1:' + app.server.address().port + '/api/v1/rainbow/original-reference';
    assert.equal((await (await fetch(url)).json()).modelVersion, changed.reference.modelVersion);
    assert.equal(
      (await (await fetch(url + '?model_version=' + baseline.modelVersion)).json()).snapshotId,
      first.reference.snapshotId,
    );
    assert.equal(
      (await fetch(url + '?model_version=bc-original-000000000000-000000000000')).status,
      404,
    );
    assert.equal((await fetch(url + '?model_version=../secret')).status, 400);
    assert.equal((await fetch(url + '?q=unknown')).status, 400);
    assert.equal(
      (
        await fetch(
          url +
            '?model_version=' +
            baseline.modelVersion +
            '&model_version=' +
            baseline.modelVersion,
        )
      ).status,
      400,
    );
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal(fetches, 2);
    const files = await readdir(directory);
    assert.equal(files.filter((f) => f.startsWith('snapshot-')).length, 3);
    assert.equal(
      files.some((f) => f.endsWith('.tmp') || f.endsWith('.lock')),
      false,
    );
    for (const file of files.filter((f) => f.startsWith('snapshot-'))) {
      const content = await readFile(join(directory, file), 'utf8');
      assert.doesNotMatch(content, /"price"|<script>|authorization|api.key/i);
    }
  } finally {
    await app?.drain();
    await store.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('source failures, low space, budget and duplicate execution retain the last verified snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bori-original-'));
  let fetches = 0,
    releaseFetch;
  const logs = [];
  const store = await createOriginalReferenceStore({
    directory,
    now: () => tomorrow,
    freeBytes: enough,
    log: (value) => logs.push(value),
    fetchReference: async () => {
      fetches++;
      await new Promise((resolve) => {
        releaseFetch = resolve;
      });
      throw new Error('original_reference_source_changed');
    },
  });
  try {
    const pending = store.refresh();
    while (!releaseFetch) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await store.refresh()).reason, 'not_due');
    const second = await createOriginalReferenceStore({
      directory,
      now: () => tomorrow,
      freeBytes: enough,
      log: silent,
      fetchReference: async () => {
        throw new Error('Must not run');
      },
    });
    assert.equal((await second.refresh()).reason, 'locked');
    releaseFetch();
    assert.equal((await pending).reason, 'original_reference_source_changed');
    assert.equal((await store.read()).snapshotId, baseline.snapshotId);
    assert.equal(fetches, 1);
    assert.equal(logs.at(-1).code, 'original_reference_source_changed');
    await second.stop();
    const low = await createOriginalReferenceStore({
      directory,
      now: () => tomorrow + 86400,
      freeBytes: async () => 7 * 1024 ** 3,
      log: silent,
      fetchReference: async () => {
        throw new Error('Must not run');
      },
    });
    assert.equal((await low.refresh()).reason, 'original_reference_low_space');
    assert.equal((await low.read()).snapshotId, baseline.snapshotId);
    await low.stop();
    const budget = await createOriginalReferenceStore({
      directory,
      now: () => tomorrow + 86400,
      freeBytes: enough,
      budgetBytes: 100,
      log: silent,
    });
    assert.equal((await budget.refresh()).reason, 'original_reference_storage_budget');
    await budget.stop();
    assert.equal(
      (await readdir(directory)).some((f) => f.startsWith('snapshot-')),
      false,
    );
  } finally {
    await store.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('corrupt stored snapshots fail closed to the bundled reference without changing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bori-original-'));
  const path = join(directory, 'snapshot-' + baseline.snapshotId + '.json');
  const corrupt = { ...baseline, dates: baseline.dates.slice(1) };
  await writeFile(path, JSON.stringify(corrupt));
  await writeFile(
    join(directory, 'index.json'),
    JSON.stringify({
      schemaVersion: 1,
      latest: baseline.modelVersion,
      versions: { [baseline.modelVersion]: baseline.snapshotId },
    }),
  );
  const store = await createOriginalReferenceStore({ directory, log: silent });
  try {
    assert.equal((await store.read()).snapshotId, baseline.snapshotId);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), corrupt);
  } finally {
    await store.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unsupported saved model is preserved and never substituted for an explicit version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bori-original-'));
  const unsupported = await createOriginalReference(
    [...baseline.dates, '2026-10-19'],
    baseline,
    tomorrow,
  );
  unsupported.formulaHash = '0'.repeat(64);
  unsupported.modelVersion = 'bc-original-000000000000-' + unsupported.snapshotId.slice(0, 12);
  const path = join(directory, 'snapshot-' + unsupported.snapshotId + '.json');
  const indexPath = join(directory, 'index.json');
  const previous = {
    schemaVersion: 1,
    latest: unsupported.modelVersion,
    versions: { [unsupported.modelVersion]: unsupported.snapshotId },
  };
  await writeFile(path, JSON.stringify(unsupported));
  await writeFile(indexPath, JSON.stringify(previous));
  const store = await createOriginalReferenceStore({
    directory,
    now: () => tomorrow,
    freeBytes: enough,
    log: silent,
    fetchReference: async () => ({ ...baseline, verifiedAt: tomorrow }),
  });
  try {
    assert.equal((await store.read()).modelVersion, baseline.modelVersion);
    assert.equal(await store.read(unsupported.modelVersion), null);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), unsupported);
    assert.equal((await store.refresh()).refreshed, true);
    const current = JSON.parse(await readFile(indexPath, 'utf8'));
    assert.equal(current.versions[unsupported.modelVersion], unsupported.snapshotId);
    assert.equal(current.latest, baseline.modelVersion);
  } finally {
    await store.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
