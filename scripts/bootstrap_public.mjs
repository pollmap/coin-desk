// Optional first fill. Production collection is owned by the Worker's Cron trigger.
import { createServer } from 'vite';
import { openDatabase } from './local-db.mjs';
import { writeFileSync } from 'node:fs';
const vite = await createServer({
  configFile: false,
  publicDir: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const DB = openDatabase('work/release13.sqlite');
const { PUBLIC_SOURCES } = await vite.ssrLoadModule('/shared/public-research.ts');
const { collectPublicSource } = await vite.ssrLoadModule('/worker/public-research.ts');
const env = { DB };
try {
  for (let i = 0; i < PUBLIC_SOURCES.length; i += 2) {
    await Promise.all(PUBLIC_SOURCES.slice(i, i + 2).map((s) => collectPublicSource(env, s)));
    console.log(
      'Public sources attempted',
      Math.min(i + 2, PUBLIC_SOURCES.length),
      '/',
      PUBLIC_SOURCES.length,
    );
  }
  const rows = DB.sqlite
    .prepare("SELECT key,value FROM state WHERE key LIKE 'research:public:%'")
    .all();
  const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
  writeFileSync(
    'work/public-research-seed.sql',
    rows
      .map(
        (r) =>
          `INSERT INTO state(key,value) VALUES(${quote(r.key)},${quote(r.value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE COALESCE(json_extract(state.value,'$.attemptedAt'),0)<json_extract(excluded.value,'$.attemptedAt');`,
      )
      .join('\n'),
  );
  console.log(
    rows.map((r) => {
      const s = JSON.parse(r.value);
      return { id: s.id, state: s.state, posts: s.posts.length };
    }),
  );
} finally {
  DB.sqlite.close();
  await vite.close();
}
