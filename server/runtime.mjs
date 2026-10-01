export const LANES = ['quotes', 'background', 'recent', 'analysis'];
export class MinuteRunner {
  constructor(database, lane, job, { now = Date.now } = {}) {
    if (!LANES.includes(lane)) throw new Error('Unknown scheduler lane');
    this.db = database.sqlite;
    this.lane = lane;
    this.job = job;
    this.now = now;
    this.running = false;
    this.stopped = false;
    this.timer = null;
  }
  async tick(at = Math.floor(this.now() / 60000) * 60) {
    if (this.stopped) return;
    const started = Math.floor(this.now() / 1000);
    const slot = Math.floor(at / 60) % 10080;
    if (
      this.db
        .prepare('SELECT 1 FROM _coin_desk_runtime_runs WHERE lane=? AND scheduled_at=?')
        .get(this.lane, at)
    )
      return;
    if (this.running) {
      this.db
        .prepare('INSERT OR REPLACE INTO _coin_desk_runtime_runs VALUES(?,?,?,?,?,?)')
        .run(this.lane, Math.floor(at / 60) % 10080, at, started, started, 'skipped_overlap');
      return;
    }
    this.running = true;
    try {
      const claim = this.db
        .prepare(
          `INSERT INTO _coin_desk_runtime_runs VALUES(?,?,?,?,NULL,?)
        ON CONFLICT(lane,slot) DO UPDATE SET scheduled_at=excluded.scheduled_at,
        started_at=excluded.started_at,completed_at=NULL,outcome=excluded.outcome
        WHERE _coin_desk_runtime_runs.scheduled_at<>excluded.scheduled_at`,
        )
        .run(this.lane, slot, at, started, 'running');
      if (!claim.changes) return;
      await this.job(at);
      this.db
        .prepare(
          'UPDATE _coin_desk_runtime_runs SET completed_at=?,outcome=? WHERE lane=? AND slot=? AND started_at=?',
        )
        .run(Math.floor(this.now() / 1000), 'ok', this.lane, slot, started);
    } catch {
      this.db
        .prepare(
          'UPDATE _coin_desk_runtime_runs SET completed_at=?,outcome=? WHERE lane=? AND slot=? AND started_at=?',
        )
        .run(Math.floor(this.now() / 1000), 'error', this.lane, slot, started);
      console.error(JSON.stringify({ lane: this.lane, event: 'collection_failed' }));
    } finally {
      this.running = false;
    }
  }
  start() {
    const schedule = () => {
      if (this.stopped) return;
      this.timer = setTimeout(
        () => {
          // Plan the next minute independently of upstream duration; no catch-up storm.
          schedule();
          void this.tick().catch(() =>
            console.error(JSON.stringify({ lane: this.lane, event: 'ledger_failed' })),
          );
        },
        60000 - (this.now() % 60000),
      );
    };
    schedule();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
export function schedulerState(database, now = Math.floor(Date.now() / 1000)) {
  return LANES.map((lane) => {
    const row = database.sqlite
      .prepare(
        'SELECT scheduled_at,started_at,completed_at,outcome FROM _coin_desk_runtime_runs WHERE lane=? ORDER BY scheduled_at DESC LIMIT 1',
      )
      .get(lane);
    return {
      lane,
      ...row,
      healthy:
        !!row &&
        row.outcome === 'ok' &&
        now - row.completed_at >= 0 &&
        now - row.completed_at <= 180,
    };
  });
}
