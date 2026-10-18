-- Additive research storage. Existing market, personal and briefing contracts are unchanged.
CREATE TABLE IF NOT EXISTS onchain_markets (
 id TEXT PRIMARY KEY, chain TEXT NOT NULL, network TEXT NOT NULL CHECK(network='mainnet'),
 kind TEXT NOT NULL, ticker TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), verified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS onchain_markets_kind ON onchain_markets(kind,id);
CREATE TABLE IF NOT EXISTS onchain_observations (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('global','injective')),
 entity_id TEXT NOT NULL, metric TEXT NOT NULL, unit TEXT NOT NULL, provider TEXT NOT NULL,
 observed_at INTEGER NOT NULL, fetched_at INTEGER NOT NULL,
 period_start INTEGER, period_end INTEGER, status TEXT NOT NULL,
 value TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)), content_hash TEXT NOT NULL,
 UNIQUE(scope,entity_id,metric,unit,provider,observed_at)
);
CREATE INDEX IF NOT EXISTS onchain_observations_lookup ON onchain_observations(scope,entity_id,metric,observed_at DESC);
CREATE TABLE IF NOT EXISTS onchain_provider_state (
 provider TEXT NOT NULL, scope TEXT NOT NULL, last_attempt INTEGER NOT NULL,
 last_success INTEGER, data_as_of INTEGER, error_code TEXT,
 next_attempt INTEGER NOT NULL DEFAULT 0, checkpoint TEXT CHECK(checkpoint IS NULL OR json_valid(checkpoint)),
 PRIMARY KEY(provider,scope)
);
CREATE TABLE IF NOT EXISTS onchain_report_runs (
 job_key TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL,
 period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, scheduled_at INTEGER NOT NULL,
 status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
 owner TEXT, generation INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 heartbeat_at INTEGER, started_at INTEGER, completed_at INTEGER, report_id TEXT, error_code TEXT,
 PRIMARY KEY(job_key,revision)
);
CREATE TABLE IF NOT EXISTS onchain_reports (
 id TEXT PRIMARY KEY, publication_key TEXT NOT NULL, revision INTEGER NOT NULL,
 type TEXT NOT NULL, scope TEXT NOT NULL, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
 published_at INTEGER NOT NULL, quality TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
 evidence_hash TEXT NOT NULL, superseded_by TEXT, UNIQUE(publication_key,revision)
);
CREATE INDEX IF NOT EXISTS onchain_reports_feed ON onchain_reports(scope,type,published_at DESC,id);
CREATE TABLE IF NOT EXISTS onchain_report_evidence (
 report_id TEXT NOT NULL REFERENCES onchain_reports(id), evidence_id TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(report_id,evidence_id)
);
CREATE TRIGGER IF NOT EXISTS onchain_reports_immutable BEFORE UPDATE OF id,body,evidence_hash,publication_key,revision,type,scope,period_start,period_end,published_at,quality ON onchain_reports
BEGIN SELECT RAISE(ABORT,'Published report content is immutable'); END;
CREATE TRIGGER IF NOT EXISTS onchain_evidence_immutable BEFORE UPDATE ON onchain_report_evidence
BEGIN SELECT RAISE(ABORT,'Published report evidence is immutable'); END;
