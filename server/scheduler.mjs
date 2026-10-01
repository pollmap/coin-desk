import { openSqlite } from './sqlite.mjs';
import { createEnvironment } from './environment.mjs';
import { MinuteRunner } from './runtime.mjs';
import { runCollector } from '../server-dist/collector.mjs';
import { refreshRecentFutures } from '../server-dist/scheduled.mjs';
import { refreshBriefing } from '../server-dist/observations.mjs';
const lane = process.env.COIN_DESK_LANE;
const database = openSqlite(process.env.COIN_DESK_DB || '/app/data/coin-desk.sqlite');
const env = await createEnvironment(database);
const runner = new MinuteRunner(database, lane, async (at) => {
  if (lane === 'recent') {
    await refreshRecentFutures(env);
    await refreshBriefing(env);
  } else await runCollector(at, { ...env, COLLECTOR_LANE: lane });
});
runner.start();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    runner.stop();
    const deadline = Date.now() + 25000;
    while (runner.running && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    database.sqlite.close();
    process.exit(runner.running ? 1 : 0);
  });
