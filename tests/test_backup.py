import pathlib
import sqlite3
import tempfile
import unittest
from scripts.backup_check import fingerprint, verify


class RecoveryTest(unittest.TestCase):
    def test_discovers_new_tables_indexes_views_triggers_and_blobs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source = root / 'source.sqlite'
            db = sqlite3.connect(source)
            for migration in sorted(pathlib.Path('migrations').glob('*.sql')):
                db.executescript(migration.read_text())
            db.executescript('''CREATE TABLE "future table"(id INTEGER PRIMARY KEY, value BLOB);
              CREATE INDEX future_index ON "future table"(value);
              CREATE VIEW future_view AS SELECT id FROM "future table";
              CREATE TRIGGER future_trigger AFTER INSERT ON "future table" BEGIN SELECT 1; END;
              INSERT INTO "future table" VALUES(1,x'0011ff'),(2,NULL);
              INSERT INTO daily_briefings VALUES('2026-01-01',1,'{}');''')
            db.commit()
            before = fingerprint(db)
            report = verify(source, root / 'recovery')
            self.assertEqual(report['tables'], before['tables'])
            self.assertEqual(report['schemaSha256'], before['schemaSha256'])
            for name in ['observation_signals', 'signal_revisions', 'daily_briefings', 'chain_history', 'future table']:
                self.assertIn(name, report['tables'])
            self.assertEqual(fingerprint(db), before)
            db.execute("UPDATE daily_briefings SET payload='[]'")
            self.assertNotEqual(fingerprint(db), before)
            db.rollback(); db.close()

    def test_sql_export_restores_in_scratch_and_missing_source_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source = root / 'export.sql'
            text = "CREATE TABLE example(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO example VALUES(1,'abc');"
            source.write_text(text)
            report = verify(source, root / 'recovery')
            self.assertEqual(report['tables']['example']['rows'], 1)
            self.assertEqual(source.read_text(), text)
            with self.assertRaises(FileNotFoundError): verify(root / 'missing.sqlite', root)
