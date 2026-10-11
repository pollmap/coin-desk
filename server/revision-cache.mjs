/** Bounded read cache. Any commit by another SQLite connection invalidates it.
 * Read-only API connections never write; age also refreshes time-dependent states.
 */
export function revisionCache(sqlite, { now = Date.now, ttl = 30000, limit = 32 } = {}) {
  const revision = sqlite.prepare('PRAGMA data_version');
  let currentVersion;
  const entries = new Map();
  return async (key, read) => {
    const version = Object.values(revision.get())[0];
    if (version !== currentVersion) {
      entries.clear();
      currentVersion = version;
    }
    const saved = entries.get(key);
    const restore = (saved) =>
      new Response(saved.body, { status: saved.status, headers: saved.headers });
    if (saved && now() - saved.at < ttl) return restore(await saved.value);
    if (entries.size >= limit) entries.delete(entries.keys().next().value);
    const value = Promise.resolve()
      .then(read)
      .then(async (response) => ({
        status: response.status,
        headers: [...response.headers],
        body: await response.text(),
      }));
    entries.set(key, { at: now(), value });
    try {
      const response = await value;
      if (response.status >= 400 && entries.get(key)?.value === value) entries.delete(key);
      return restore(response);
    } catch (error) {
      if (entries.get(key)?.value === value) entries.delete(key);
      throw error;
    }
  };
}
