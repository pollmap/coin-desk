-- Preserve the existing ledger while expanding bounded retention to 72 hours.
ALTER TABLE cron_runs RENAME TO cron_runs_legacy;
CREATE TABLE cron_runs (
 slot INTEGER PRIMARY KEY CHECK (slot>=0 AND slot<4320),
 run_id TEXT NOT NULL, started_at INTEGER NOT NULL,
 completed_at INTEGER, job TEXT, outcome TEXT NOT NULL, error TEXT
);
INSERT INTO cron_runs(slot,run_id,started_at,completed_at,job,outcome,error)
 SELECT slot,run_id,started_at,completed_at,job,outcome,error FROM cron_runs_legacy;
DROP TABLE cron_runs_legacy;
