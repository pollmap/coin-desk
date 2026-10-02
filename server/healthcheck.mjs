import { openSqlite } from './sqlite.mjs';
const kind = process.argv[2] || 'api';
if (kind === 'api') {
  const response = await fetch('http://127.0.0.1:8080/healthz', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !(await response.json()).ok) process.exit(1);
} else if (kind === 'backup') {
  const { readFile } = await import('node:fs/promises');
  const state = JSON.parse(await readFile('/app/data/backup-status.json', 'utf8'));
  if (!state.ok || !state.verified || Date.now() / 1000 - state.completedAt > 90000)
    process.exit(1);
} else {
  const db = openSqlite(process.env.COIN_DESK_DB || '/app/data/coin-desk.sqlite', {
    readOnly: true,
  });
  try {
    const row = db.sqlite
      .prepare(
        'SELECT started_at,outcome FROM _coin_desk_runtime_runs WHERE lane=? ORDER BY scheduled_at DESC LIMIT 1',
      )
      .get(kind);
    if (
      !row ||
      Date.now() / 1000 - row.started_at > 180 ||
      ['error', 'skipped_overlap'].includes(row.outcome)
    )
      process.exitCode = 1;
  } finally {
    db.sqlite.close();
  }
}
