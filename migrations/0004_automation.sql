CREATE TABLE IF NOT EXISTS cron_state (
 id INTEGER PRIMARY KEY CHECK (id=1), run_id TEXT NOT NULL,
 last_tick INTEGER NOT NULL, last_started INTEGER NOT NULL,
 last_completed INTEGER, last_succeeded INTEGER,
 lease_until INTEGER NOT NULL DEFAULT 0, job TEXT,
 outcome TEXT NOT NULL, error TEXT
);
-- Reuse 120 minute slots instead of allowing an unbounded execution log.
CREATE TABLE IF NOT EXISTS cron_runs (
 slot INTEGER PRIMARY KEY CHECK (slot>=0 AND slot<120),
 run_id TEXT NOT NULL, started_at INTEGER NOT NULL,
 completed_at INTEGER, job TEXT, outcome TEXT NOT NULL, error TEXT
);
