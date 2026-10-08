import { spawn } from 'node:child_process';
let running,
  stopped = false,
  timer;
function execute() {
  if (stopped) return;
  running = spawn(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      'scripts/vps_backup.py',
      'backup',
      '--source',
      process.env.COIN_DESK_DB || '/app/data/coin-desk.sqlite',
      '--folder',
      process.env.COIN_DESK_BACKUP_FOLDER || '/app/backups',
      '--status',
      process.env.COIN_DESK_BACKUP_STATUS || '/app/data/backup-status.json',
      '--retention-days',
      process.env.BACKUP_RETENTION_DAYS || '14',
      '--budget-bytes',
      process.env.BACKUP_BUDGET_BYTES || '2147483648',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let diagnosticBuffer = '';
  running.stderr.on('data', (chunk) => {
    // Only sanitized codes from our helper are allowed into operational logs.
    diagnosticBuffer += String(chunk);
    const lines = diagnosticBuffer.split('\n');
    diagnosticBuffer = (lines.pop() || '').slice(-4096);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (
          [
            'storage_full',
            'storage_permission',
            'storage_read_only',
            'storage_io',
            'sqlite_backup',
            'backup_verification',
          ].includes(row.code)
        )
          console.error(JSON.stringify({ event: 'backup_diagnostic', code: row.code }));
      } catch {
        /* Discard tracebacks or unstructured child output. */
      }
    }
  });
  running.on('error', () => console.error(JSON.stringify({ event: 'backup_start_failed' })));
  running.on('close', (code) => {
    running = null;
    console[code === 0 ? 'log' : 'error'](
      JSON.stringify({ event: code === 0 ? 'backup_verified' : 'backup_failed' }),
    );
    if (!stopped) timer = setTimeout(execute, code === 0 ? 86400000 : 3600000);
  });
}
execute();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    stopped = true;
    clearTimeout(timer);
    if (running) {
      running.once('close', () => process.exit(0));
      running.kill('SIGTERM');
    } else process.exit(0);
  });
