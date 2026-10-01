import { openSqlite } from './sqlite.mjs';
import { createEnvironment } from './environment.mjs';
import { createHttpServer } from './http.mjs';
import worker from '../server-dist/api.mjs';
const database = openSqlite(process.env.COIN_DESK_DB || '/app/data/coin-desk.sqlite', {
  readOnly: true,
});
const env = await createEnvironment(database);
const app = createHttpServer({
  worker,
  env,
  database,
  release: process.env.COIN_DESK_RELEASE || 'local-vps',
  backupStatusPath: process.env.COIN_DESK_BACKUP_STATUS || '/app/data/backup-status.json',
});
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
app.server.listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(JSON.stringify({ event: 'listening', port })),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await app.drain();
    database.sqlite.close();
    process.exit(0);
  });
