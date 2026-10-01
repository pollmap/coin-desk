import hashlib, json, pathlib, sqlite3, sys, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from import_d1_export import import_export
from vps_backup import backup, restore
from backup_check import fingerprint
sys.path.insert(0, str(ROOT / 'deploy/vps'))
from verify_runtime import request as check_runtime_request, verify as verify_runtime

class MigrationRecovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = pathlib.Path(self.tmp.name)
        self.source = self.folder / 'source.sqlite'
        db = sqlite3.connect(self.source)
        for file in sorted((ROOT / 'migrations').glob('*.sql')): db.executescript(file.read_text(encoding='utf-8'))
        db.execute("INSERT INTO cron_runs VALUES(1,'keep-old',100,101,'quotes','ok',NULL)")
        db.execute("INSERT INTO observation_signals(id,asset,source,rule,time,payload,created_at) VALUES('signal','BTC','test','rule',100,'{}',101)")
        db.execute("INSERT INTO signal_revisions VALUES('signal',1,'{}',101)")
        db.execute("INSERT INTO daily_briefings VALUES('2026-10-01',101,'{}')")
        db.execute("INSERT INTO chain_history VALUES('ETH','tvl',100,'{}',101)")
        db.execute('CREATE TABLE extra_source(payload BLOB)')
        db.execute('INSERT INTO extra_source VALUES(?)', (bytes([0,255]),))
        db.execute('INSERT INTO state VALUES(?,?)', ('multiline', 'first\r\nsecond\nthird'))
        db.commit()
        self.expected = fingerprint(db)
        self.export = self.folder / 'export.sql'
        self.export.write_text('\n'.join(db.iterdump()), encoding='utf-8', newline='')
        db.close()

    def test_import_preserves_all_tables_and_historical_cron(self):
        destination = self.folder / 'imported.sqlite'
        report = import_export(self.export, destination)
        self.assertEqual(report['imported'], self.expected)
        db = sqlite3.connect(destination)
        self.assertEqual(db.execute('SELECT run_id FROM cron_runs').fetchone()[0], 'keep-old')
        self.assertEqual(db.execute('SELECT COUNT(*) FROM _coin_desk_migrations').fetchone()[0], 9)
        for file, checksum in db.execute('SELECT name,sha256 FROM _coin_desk_migrations'):
            self.assertEqual(checksum, hashlib.sha256((ROOT/'migrations'/file).read_text(encoding='utf-8').encode()).hexdigest())
        db.close()
        with self.assertRaisesRegex(ValueError, 'overwrite'): import_export(self.export, destination)

    def test_attach_and_schema_corruption_do_not_create_target(self):
        for suffix in ("\nATTACH DATABASE 'outside.sqlite' AS outside;", '\nDROP TABLE chain_history;'):
            damaged = self.folder / 'damaged.sql'
            damaged.write_text(self.export.read_text(encoding='utf-8') + suffix, encoding='utf-8')
            destination = self.folder / 'blocked.sqlite'
            with self.assertRaises((sqlite3.DatabaseError, ValueError)): import_export(damaged, destination)
            self.assertFalse(destination.exists())

    def test_online_wal_backup_and_verified_restore(self):
        db = sqlite3.connect(self.source)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute("INSERT INTO state VALUES('wal-visible','latest')"); db.commit()
        expected = fingerprint(db)
        report = backup(self.source, self.folder/'backups', self.folder/'status.json')
        self.assertEqual(report['content'], expected)
        entry = next((self.folder/'backups').iterdir())
        self.assertTrue(json.loads((self.folder/'status.json').read_text())['ok'])
        destination = self.folder/'restored.sqlite'
        restore(entry/'snapshot.sqlite', destination, entry/'manifest.json')
        restored = sqlite3.connect(destination)
        self.assertEqual(fingerprint(restored), expected); restored.close()
        with self.assertRaisesRegex(ValueError, 'new destination'): restore(entry/'snapshot.sqlite', destination, entry/'manifest.json')
        (entry/'snapshot.sqlite').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum'): restore(entry/'snapshot.sqlite', self.folder/'bad.sqlite', entry/'manifest.json')
        self.assertFalse((self.folder/'bad.sqlite').exists())
        db.close()

    def test_budget_failure_is_visible_and_keeps_existing_data(self):
        backups, status = self.folder/'backups', self.folder/'status.json'
        backup(self.source, backups, status)
        db=sqlite3.connect(self.source)
        db.execute('INSERT INTO extra_source VALUES(?)',(bytes(2*1024*1024),));db.commit();db.close()
        with self.assertRaisesRegex(ValueError,'budget'): backup(self.source, backups, status, budget_bytes=1024*1024)
        self.assertFalse(json.loads(status.read_text())['ok'])
        self.assertEqual(len(list(backups.iterdir())),2)
        db=sqlite3.connect(self.source)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM extra_source').fetchone()[0],2);db.close()

    def test_missing_backup_source_is_reported_without_claiming_previous_success(self):
        status=self.folder/'status.json'
        with self.assertRaises(sqlite3.OperationalError): backup(self.folder/'missing.sqlite',self.folder/'backups',status)
        self.assertFalse(json.loads(status.read_text())['ok'])
        self.assertFalse((self.folder/'missing.sqlite').exists())

    def test_shadow_health_preserves_503_but_active_verification_refuses_it(self):
        import http.server,threading,urllib.error
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(503);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(b'{"ok":false,"reasons":[{"code":"SOURCE_DELAYED"}]}')
            def log_message(self,*_): pass
        server=http.server.HTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            base='http://127.0.0.1:'+str(server.server_port)
            self.assertEqual(check_runtime_request(base,'/api/v1/health',shadow=True)['_verificationHttpStatus'],503)
            with self.assertRaises(urllib.error.HTTPError): check_runtime_request(base,'/api/v1/health')
            with self.assertRaises(urllib.error.HTTPError): check_runtime_request(base,'/healthz',shadow=True)
            with self.assertRaisesRegex(ValueError,'Shadow cannot claim'): verify_runtime(base,self.source,120,shadow=True)
        finally: server.shutdown();server.server_close();thread.join()

if __name__ == '__main__': unittest.main()
