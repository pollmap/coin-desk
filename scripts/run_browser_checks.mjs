/** Own the fixture process directly: no Windows shell process tree at teardown. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const port = process.env.COIN_DESK_TEST_PORT || '5190';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error('Invalid fixture port');
const base = `http://127.0.0.1:${port}`;
// Fail closed on an occupied port: never reuse another user's server as a fixture.
const { createServer } = await import('node:net');
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(Number(port), '127.0.0.1', resolve);
});
await new Promise((resolve) => probe.close(resolve));
const fixture = spawn(process.execPath, ['scripts/e2e-server.mjs'], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  env: process.env,
});
const fixtureExit = once(fixture, 'exit');
let testProcess;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (fixture.exitCode !== null) throw new Error('Fixture exited before readiness');
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(500) });
      ready = response.ok && (await response.text()).includes('id="root"');
    } catch {}
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error('Isolated fixture did not become ready');
  // A second run must not clean another run's traces while its context is closing.
  const evidenceRoot = resolve('work/browser-checks', `${Date.now()}-${process.pid}`);
  mkdirSync(evidenceRoot, { recursive: true });
  const outputDir = process.env.COIN_DESK_TEST_OUTPUT_DIR || join(evidenceRoot, 'artifacts');
  const reportDir = process.env.COIN_DESK_TEST_REPORT_DIR || join(evidenceRoot, 'report');
  console.log(JSON.stringify({ event: 'browser_evidence', outputDir, reportDir }));
  testProcess = spawn(
    process.execPath,
    [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        COIN_DESK_FIXTURE_MANAGED_EXTERNALLY: '1',
        COIN_DESK_TEST_OUTPUT_DIR: outputDir,
        COIN_DESK_TEST_REPORT_DIR: reportDir,
      },
    },
  );
  const [code] = await once(testProcess, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (fixture.connected) fixture.send('shutdown');
  await Promise.race([fixtureExit, delay(5000)]);
  if (fixture.exitCode === null) {
    fixture.kill();
    await fixtureExit;
  }
}
