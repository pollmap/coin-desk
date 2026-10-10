import json
from pathlib import Path
import sqlite3
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from history_coverage import candle_coverage


class HistoryCoverageTest(unittest.TestCase):
    def test_archives_overlap_corrections_gaps_and_open_bar(self):
        db = sqlite3.connect(':memory:')
        db.executescript('CREATE TABLE candles(asset,market,interval,time,close,close_time);'
                         'CREATE TABLE price_archive(asset,market,interval,start,data);')
        archive = [[t, 1, 1, 1, 1, 2, t+86400] for t in [86400, 172800, 345600]]
        db.execute('INSERT INTO price_archive VALUES(?,?,?,?,?)', ('DOGE','upbit','1d',86400,json.dumps(archive)))
        db.executemany('INSERT INTO candles VALUES(?,?,?,?,?,?)', [
            ('DOGE','upbit','1d',172800,2,259200),
            ('DOGE','upbit','1d',432000,3,518400),
            ('DOGE','upbit','1d',518400,3,604800),
        ])
        changes = db.total_changes
        row, = candle_coverage(db, now=600000)
        self.assertEqual((row['first'],row['last'],row['observations']), (86400,432000,4))
        self.assertEqual(row['missingSlots'],1)
        self.assertEqual(row['firstClose'],1)
        self.assertEqual(row['unit'],'KRW')
        self.assertEqual(db.total_changes,changes)
        db.close()

    def test_archive_only_daily_and_mutable_only_hourly_are_separate(self):
        db = sqlite3.connect(':memory:')
        db.executescript('CREATE TABLE candles(asset,market,interval,time,close,close_time);'
                         'CREATE TABLE price_archive(asset,market,interval,start,data);')
        db.execute('INSERT INTO price_archive VALUES(?,?,?,?,?)', ('BTC','binance','1d',86400,json.dumps([[86400,10,10,10,10,1,172800]])))
        db.execute('INSERT INTO candles VALUES(?,?,?,?,?,?)', ('BTC','binance','1h',180000,20,183600))
        rows = candle_coverage(db,now=190000)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['first'],86400)
        self.assertEqual(rows[1]['first'],180000)
        self.assertTrue(all(r['confirmedOnly'] for r in rows))
        db.close()


if __name__ == '__main__':
    unittest.main()
