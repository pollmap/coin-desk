CREATE TABLE IF NOT EXISTS observation_signals (
 id TEXT PRIMARY KEY, asset TEXT NOT NULL, source TEXT NOT NULL, rule TEXT NOT NULL,
 time INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'active', notify INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS signals_asset_time ON observation_signals(asset,time DESC,id);
CREATE TABLE IF NOT EXISTS signal_revisions (
 id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 PRIMARY KEY(id,revision)
);
CREATE TABLE IF NOT EXISTS daily_briefings (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS chain_history (
 asset TEXT NOT NULL, metric TEXT NOT NULL, bucket INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), fetched_at INTEGER NOT NULL,
 PRIMARY KEY(asset,metric,bucket)
);
