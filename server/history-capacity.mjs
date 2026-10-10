import { statfsSync } from 'node:fs';

/** Stop optional history work before disk exhaustion; recent observations continue. */
export function historyCapacity(path, { statfs = statfsSync, now = Date.now } = {}) {
  let checkedAt = -Infinity;
  let allowed = false;
  return () => {
    if (now() - checkedAt >= 60000) {
      checkedAt = now();
      try {
        const disk = statfs(path);
        allowed = disk.bavail * disk.bsize >= 8 * 1024 ** 3;
      } catch {
        allowed = false;
      }
    }
    return allowed;
  };
}
