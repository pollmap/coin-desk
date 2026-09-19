-- One row per asset/month keeps full daily network history within the free write budget.
CREATE TABLE IF NOT EXISTS network_months (
  asset TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY(asset, bucket)
);
CREATE TABLE IF NOT EXISTS network_coverage (
  asset TEXT NOT NULL,
  metric TEXT NOT NULL,
  first INTEGER NOT NULL,
  last INTEGER NOT NULL,
  observations INTEGER NOT NULL CHECK(observations > 0),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY(asset, metric)
);
