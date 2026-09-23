CREATE TABLE IF NOT EXISTS derivative_series (
  asset TEXT NOT NULL,
  metric TEXT NOT NULL,
  time INTEGER NOT NULL,
  value REAL NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY(asset,metric,time)
);
