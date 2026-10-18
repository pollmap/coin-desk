import { mkdir, open, readFile, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ORIGINAL_RAINBOW_BASELINE,
  fetchOriginalReference,
  originalRainbowVersionValid,
  verifyOriginalReference,
} from '../server-dist/rainbow-original-reference.mjs';

const MIN_FREE_BYTES = 8 * 1024 ** 3;
const DEFAULT_BUDGET_BYTES = 64 * 1024 ** 2;
const day = (time) => Math.floor(time / 86400);
const snapshotName = (id) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('original_reference_invalid');
  return `snapshot-${id}.json`;
};
const failureCode = (error) =>
  /^original_reference_[a-z_]+$/.test(error?.message ?? '')
    ? error.message
    : 'original_reference_refresh_failed';

/** Small metadata task in the single API process, never in the price/research collectors or request path. */
export async function createOriginalReferenceStore({
  directory,
  fetchReference = fetchOriginalReference,
  now = () => Math.floor(Date.now() / 1000),
  freeBytes = async () => {
    const s = await statfs(directory);
    return s.bavail * s.bsize;
  },
  budgetBytes = DEFAULT_BUDGET_BYTES,
  log = (message) => console.log(JSON.stringify(message)),
} = {}) {
  if (!directory) throw new Error('Original reference directory required');
  let current = await verifyOriginalReference(ORIGINAL_RAINBOW_BASELINE);
  let index = { schemaVersion: 1, latest: current.modelVersion, versions: {} };
  let lastAttempt = -1;
  let active = false;
  let stopped = false;
  let timer;
  let pending;
  const atomic = async (name, value) => {
    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, join(directory, name));
  };
  async function readSnapshot(id) {
    const path = join(directory, snapshotName(id));
    if ((await stat(path)).size > 262144) throw new Error('original_reference_body_limit');
    const reference = await verifyOriginalReference(JSON.parse(await readFile(path, 'utf8')));
    if (reference.snapshotId !== id) throw new Error('original_reference_invalid');
    return reference;
  }
  try {
    if ((await stat(join(directory, 'index.json'))).size > 65536)
      throw new Error('original_reference_invalid');
    const saved = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
    if (
      saved.schemaVersion !== 1 ||
      !originalRainbowVersionValid(saved.latest) ||
      !saved.versions ||
      typeof saved.versions !== 'object' ||
      Array.isArray(saved.versions) ||
      Object.keys(saved.versions).length > 64 ||
      !Object.entries(saved.versions).every(
        ([version, id]) => originalRainbowVersionValid(version) && /^[a-f0-9]{64}$/.test(id),
      )
    )
      throw new Error('original_reference_invalid');
    // Keep old version bindings even when this release cannot execute the latest model.
    // A fallback must not erase the index on a later verified refresh.
    index = saved;
    const reference = await readSnapshot(saved.versions[saved.latest]);
    if (reference.modelVersion !== saved.latest) throw new Error('original_reference_invalid');
    current = reference;
    index = saved;
  } catch (error) {
    if (error.code !== 'ENOENT')
      log({ event: 'original-reference-load', code: failureCode(error), fallback: 'bundled' });
  }
  try {
    const saved = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'));
    if (Number.isSafeInteger(saved.lastAttempt) && saved.lastAttempt <= now())
      lastAttempt = saved.lastAttempt;
    if (
      saved.code === 'ok' &&
      saved.snapshotId === current.snapshotId &&
      Number.isSafeInteger(saved.lastVerifiedAt) &&
      saved.lastVerifiedAt >= current.verifiedAt &&
      saved.lastVerifiedAt <= now()
    )
      current = { ...current, verifiedAt: saved.lastVerifiedAt };
  } catch {
    /* First boot has no daily attempt. */
  }

  async function storageAvailable(extra = 262144) {
    if ((await freeBytes()) < MIN_FREE_BYTES) throw new Error('original_reference_low_space');
    const entries = await readdir(directory, { withFileTypes: true });
    let bytes = 0,
      snapshots = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      bytes += (await stat(join(directory, entry.name))).size;
      if (/^snapshot-[a-f0-9]{64}\.json$/.test(entry.name)) snapshots++;
    }
    if (bytes + extra > budgetBytes || snapshots >= 1024)
      throw new Error('original_reference_storage_budget');
  }
  async function lease() {
    const path = join(directory, 'refresh.lock');
    const token = randomUUID();
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ token, expiresAt: now() + 120 }));
      await handle.close();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // The task has two 15s network bounds. A crashed task's expired lease can be reclaimed.
      const old = await readFile(path, 'utf8');
      const parsed = JSON.parse(old);
      if (!Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt > now()) return null;
      if ((await readFile(path, 'utf8')) !== old) return null;
      await unlink(path);
      return lease();
    }
    return async () => {
      try {
        if (JSON.parse(await readFile(path, 'utf8')).token === token) await unlink(path);
      } catch {
        /* Another owner must never be removed. */
      }
    };
  }
  async function writeSnapshot(reference) {
    const filename = snapshotName(reference.snapshotId);
    try {
      const existing = await readSnapshot(reference.snapshotId);
      // Dates and formula are immutable; verification time can advance in status.json instead.
      if (
        existing.formulaHash !== reference.formulaHash ||
        existing.modelVersion !== reference.modelVersion
      )
        throw new Error('original_reference_snapshot_collision');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await atomic(filename, reference);
  }
  async function refresh() {
    if (active || stopped || day(lastAttempt) === day(now()))
      return { refreshed: false, reason: 'not_due' };
    active = true;
    let release;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await storageAvailable();
      release = await lease();
      if (!release) return { refreshed: false, reason: 'locked' };
      // A second process may have finished while this process waited for the lease.
      try {
        const status = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'));
        if (Number.isSafeInteger(status.lastAttempt) && day(status.lastAttempt) === day(now())) {
          lastAttempt = status.lastAttempt;
          return { refreshed: false, reason: 'not_due' };
        }
      } catch {
        /* No prior completed attempt. */
      }
      lastAttempt = now();
      const next = await verifyOriginalReference(await fetchReference(current, undefined, now()));
      if (next.verifiedAt > now() || next.verifiedAt < current.verifiedAt)
        throw new Error('original_reference_invalid');
      const versions = {
        ...index.versions,
        [current.modelVersion]: current.snapshotId,
        [next.modelVersion]: next.snapshotId,
      };
      if (Object.keys(versions).length > 64) throw new Error('original_reference_version_budget');
      await storageAvailable(JSON.stringify(current).length + JSON.stringify(next).length + 4096);
      await writeSnapshot(current);
      await writeSnapshot(next);
      const updated = { schemaVersion: 1, latest: next.modelVersion, versions };
      await atomic('index.json', updated);
      index = updated;
      current = next;
      await atomic('status.json', {
        lastAttempt,
        lastVerifiedAt: next.verifiedAt,
        snapshotId: next.snapshotId,
        code: 'ok',
      });
      log({
        event: 'original-reference-verified',
        modelVersion: next.modelVersion,
        snapshotId: next.snapshotId,
        dates: next.dates.length,
      });
      return { refreshed: true, reference: next };
    } catch (error) {
      lastAttempt = now();
      const code = failureCode(error);
      // Low-space and budget failures do not write optional metadata or remove old snapshots.
      if (
        release &&
        !['original_reference_low_space', 'original_reference_storage_budget'].includes(code)
      )
        await atomic('status.json', {
          lastAttempt,
          lastVerifiedAt: current.verifiedAt,
          code,
        }).catch(() => {});
      log({ event: 'original-reference-refresh', code, retained: current.snapshotId });
      return { refreshed: false, reason: code };
    } finally {
      await release?.();
      active = false;
    }
  }
  return {
    async read(modelVersion) {
      if (!modelVersion || modelVersion === current.modelVersion) return current;
      if (!originalRainbowVersionValid(modelVersion)) return null;
      const id = index.versions[modelVersion];
      if (id) {
        try {
          const reference = await readSnapshot(id);
          return reference.modelVersion === modelVersion ? reference : null;
        } catch {
          return null; // Never replace an explicitly requested unavailable version.
        }
      }
      return modelVersion === ORIGINAL_RAINBOW_BASELINE.modelVersion
        ? ORIGINAL_RAINBOW_BASELINE
        : null;
    },
    refresh,
    start() {
      if (timer || stopped) return;
      const tick = () => {
        if (!active) pending = refresh();
      };
      // Yield startup to the API. Refreshing never blocks the first request.
      timer = setInterval(tick, 60000);
      timer.unref();
      pending = Promise.resolve().then(tick);
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
