CREATE TABLE IF NOT EXISTS reference_prices (
  asset TEXT NOT NULL,
  time INTEGER NOT NULL,
  value REAL NOT NULL CHECK(value > 0),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY(asset,time)
);
