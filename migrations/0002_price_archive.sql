-- Immutable, validated historical candles in bounded chunks. Recent corrections
-- in candles take precedence. One archive row stores at most 256 OHLCV samples.
CREATE TABLE IF NOT EXISTS price_archive (
 asset TEXT NOT NULL, market TEXT NOT NULL, interval TEXT NOT NULL,
 start INTEGER NOT NULL, end INTEGER NOT NULL, data TEXT NOT NULL,
 fetched_at INTEGER NOT NULL, PRIMARY KEY(asset, market, interval, start)
);
