"""Synthetic SQLite/source artifacts only. No networking or production execution."""
import copy
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import reconcile_source_history as reconcile
from backup_check import fingerprint
import bootstrap_network
import registry


class SourceReconcileTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.db = sqlite3.connect(self.folder / 'live.sqlite')
        self.db.executescript('''
          CREATE TABLE reference_prices(asset TEXT,time INTEGER,value REAL,fetched_at INTEGER,PRIMARY KEY(asset,time));
          CREATE TABLE network_months(asset TEXT,bucket INTEGER,payload TEXT,fetched_at INTEGER,PRIMARY KEY(asset,bucket));
          CREATE TABLE network_coverage(asset TEXT,metric TEXT,first INTEGER,last INTEGER,observations INTEGER,fetched_at INTEGER,PRIMARY KEY(asset,metric));
          CREATE TABLE ingestion(key TEXT PRIMARY KEY,last_success INTEGER,data_as_of INTEGER,next_attempt INTEGER,error TEXT);
        ''')
        self.first = 1577836800
        self.second = self.first + reconcile.DAY
        self.cutoff = self.second + reconcile.DAY
        self.before_rows = [{'time': self.first, 'values': {'price': 10, 'mvrv': 2, 'transactions': 3},
                             'statuses': {'mvrv': 'estimated', 'transactions': 'unchanged'}}]
        self.db.execute('INSERT INTO network_months VALUES(?,?,?,?)',
                        ('BTC', self.first, json.dumps(self.before_rows), 100))
        for metric in ['price', 'mvrv', 'transactions']:
            self.db.execute('INSERT INTO network_coverage VALUES(?,?,?,?,?,?)',
                            ('BTC', metric, self.first, self.first, 1, 100))
        self.db.execute('INSERT INTO reference_prices VALUES(?,?,?,?)', ('BTC', self.first, 10, 100))
        self.db.execute('INSERT INTO ingestion VALUES(?,?,?,?,?)', ('network:BTC', 999999, self.second, 888888, 'preserve-error'))
        self.db.commit()
        self.validated = {
            'asset': 'BTC', 'sourceFetchedAt': self.cutoff,
            'sourceEntry': {'raw': {'uncompressedSha256': 'a' * 64}, 'normalized': {'uncompressedSha256': 'b' * 64}},
            'operations': [
                {'kind': 'network', 'metric': 'mvrv', 'time': self.first,
                 'storedValue': 2, 'sourceValue': 2.5, 'beforeStatus': 'estimated', 'sourceStatus': 'revised'},
                {'kind': 'network-internal-price', 'metric': 'price', 'time': self.second,
                 'storedValue': None, 'sourceValue': 12, 'beforeStatus': None, 'sourceStatus': None},
                {'kind': 'reference', 'metric': 'PriceUSD', 'time': self.second,
                 'storedValue': None, 'sourceValue': 12, 'beforeStatus': None, 'sourceStatus': None},
            ],
        }
        self.identities = {'reviewManifestSha256': 'c' * 64, 'backupManifestSha256': 'd' * 64,
                           'backupRestoreProofSha256': 'e' * 64}

    def tearDown(self):
        self.db.close()
        self.temporary.cleanup()

    def apply(self, validated=None, execute=True):
        # Windows unit tests emulate directory fsync only; production Linux requires actual fsync.
        with mock.patch.object(reconcile, 'fsync_directory') as sync:
            result = reconcile.apply_asset(self.db, validated or self.validated, self.cutoff,
                                           execute, self.folder / 'audit', self.identities)
            if execute and result['changed']:
                self.assertEqual(sync.call_count, 3)
            return result

    def test_new_audit_directory_parent_entries_are_synced_before_leaf_file(self):
        target = self.folder / 'nested' / 'audit' / 'seal.bin'
        with mock.patch.object(reconcile, 'fsync_directory') as sync:
            reconcile.durable_file(target, b'sealed')
        self.assertEqual([call.args[0] for call in sync.call_args_list],
                         [self.folder, self.folder / 'nested', self.folder / 'nested' / 'audit'])
        self.assertEqual(target.read_bytes(), b'sealed')

    def test_default_plan_is_read_only_and_never_creates_an_audit(self):
        before = fingerprint(self.db)
        changes = self.db.total_changes
        result = self.apply(execute=False)
        self.assertEqual((result['changed'], result['references']), (3, 1))
        self.assertEqual(fingerprint(self.db), before)
        self.assertEqual(self.db.total_changes, changes)
        self.assertFalse((self.folder / 'audit').exists())

    def test_commit_seals_before_write_and_preserves_unrelated_values_status_and_ingestion(self):
        original = reconcile.seal_audit
        order = []
        self.db.set_trace_callback(lambda sql: order.append(sql.split(' ', 1)[0]))
        def seal(folder, audit):
            self.assertEqual(self.db.execute('SELECT value FROM reference_prices WHERE time=?', (self.second,)).fetchall(), [])
            result = original(folder, audit)
            order.append('SEALED')
            return result
        with mock.patch.object(reconcile, 'seal_audit', side_effect=seal):
            result = self.apply()
        self.assertLess(order.index('SEALED'), order.index('INSERT'))
        self.assertLess(order.index('SEALED'), order.index('COMMIT'))
        self.assertEqual(result['changed'], 3)
        payload, = self.db.execute('SELECT payload FROM network_months WHERE asset=?', ('BTC',)).fetchone()
        rows = json.loads(payload)
        self.assertEqual(rows[0]['values'], {'price': 10, 'mvrv': 2.5, 'transactions': 3})
        self.assertEqual(rows[0]['statuses'], {'mvrv': 'revised', 'transactions': 'unchanged'})
        self.assertEqual(rows[1], {'time': self.second, 'values': {'price': 12}})
        self.assertEqual(self.db.execute('SELECT last_success,data_as_of,next_attempt,error FROM ingestion').fetchone(),
                         (999999, self.second, 888888, 'preserve-error'))
        self.assertEqual(self.db.execute('SELECT first,last,observations FROM network_coverage WHERE metric=?', ('price',)).fetchone(),
                         (self.first, self.second, 2))
        seal_file, = (self.folder / 'audit').glob('*.seal.json')
        seal = json.loads(seal_file.read_text(encoding='utf-8'))
        raw_gzip = (seal_file.parent / seal['auditFile']).read_bytes()
        self.assertEqual(hashlib.sha256(raw_gzip).hexdigest(), seal['gzipSha256'])
        audit = json.loads(gzip.decompress(raw_gzip))
        self.assertEqual(audit['networkMonths'][0]['beforePayload'], json.dumps(self.before_rows))
        self.assertEqual(audit['operations'][0]['actualBefore']['monthFetchedAt'], 100)

    def test_replay_accepts_exact_new_values_without_rewriting_or_second_audit(self):
        self.apply()
        before = fingerprint(self.db)
        changes = self.db.total_changes
        result = self.apply()
        self.assertEqual((result['changed'], result['alreadyNew']), (0, 3))
        self.assertEqual(fingerprint(self.db), before)
        self.assertEqual(changes, self.db.total_changes)
        self.assertEqual(len(list((self.folder / 'audit').glob('*.audit.json.gz'))), 1)

    def test_conflicting_live_scalar_or_status_fails_without_partial_changes(self):
        row = copy.deepcopy(self.before_rows)
        row[0]['values']['mvrv'] = 2.1
        self.db.execute('UPDATE network_months SET payload=?', (json.dumps(row),)); self.db.commit()
        before = fingerprint(self.db)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'cas-value-conflict'):
            self.apply()
        self.assertEqual(fingerprint(self.db), before)
        row[0]['values']['mvrv'] = 2
        row[0]['statuses']['mvrv'] = 'changed-concurrently'
        self.db.execute('UPDATE network_months SET payload=?', (json.dumps(row),)); self.db.commit()
        with self.assertRaisesRegex(reconcile.ReconcileError, 'cas-status-conflict'):
            self.apply()

    def test_audit_disk_failure_rolls_back_and_no_latest_rows_are_inserted(self):
        before = fingerprint(self.db)
        with mock.patch.object(reconcile, 'seal_audit', side_effect=OSError('simulated audit disk failure')):
            with self.assertRaises(OSError):
                self.apply()
        self.assertEqual(fingerprint(self.db), before)

    def test_overlong_asset_transaction_rolls_back_after_audit_without_commit(self):
        before = fingerprint(self.db)
        with mock.patch.object(reconcile.time, 'monotonic', side_effect=[0, 11]):
            with self.assertRaisesRegex(reconcile.ReconcileError, 'transaction-exceeded'):
                self.apply()
        self.assertEqual(fingerprint(self.db), before)
        self.assertEqual(len(list((self.folder / 'audit').glob('*.seal.json'))), 1)

    def test_coverage_first_date_cannot_be_silently_changed(self):
        self.db.execute('UPDATE network_coverage SET first=? WHERE metric=?', (self.first - reconcile.DAY, 'price'))
        self.db.commit()
        before = fingerprint(self.db)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'coverage-would-regress'):
            self.apply()
        self.assertEqual(fingerprint(self.db), before)

    def test_database_trigger_cannot_mutate_ingestion_or_other_tables(self):
        self.db.execute("CREATE TRIGGER unexpected AFTER UPDATE ON network_months BEGIN UPDATE ingestion SET last_success=0; END")
        self.db.commit()
        before = fingerprint(self.db)
        with self.assertRaises(sqlite3.DatabaseError):
            self.apply()
        self.assertEqual(fingerprint(self.db), before)
        self.assertEqual(self.db.execute('SELECT last_success FROM ingestion').fetchone()[0], 999999)

    def test_unrelated_later_day_and_missing_source_values_are_preserved(self):
        rows = self.before_rows + [{'time': self.second, 'values': {'transactions': 9}, 'statuses': {'transactions': 'retained'}}]
        self.db.execute('UPDATE network_months SET payload=?,fetched_at=?', (json.dumps(rows), 999999)); self.db.commit()
        self.apply()
        after = json.loads(self.db.execute('SELECT payload FROM network_months').fetchone()[0])
        self.assertEqual(after[1]['values'], {'transactions': 9, 'price': 12})
        self.assertEqual(after[1]['statuses'], {'transactions': 'retained'})
        self.assertEqual(self.db.execute('SELECT fetched_at FROM network_months').fetchone()[0], 999999 if 999999 > self.cutoff else self.cutoff)

    def make_source(self):
        asset = 'XRP'
        fields = bootstrap_network.fields_for(asset)
        first = bootstrap_network.stamp(bootstrap_network.HISTORY[asset] + 'T00:00:00Z')
        raw = {'data': [{'asset': registry.network_id(asset), 'time': '2013-01-01T00:00:00.000000000Z',
                         **{field: None if field == 'PriceUSD' else '0' for field in fields.values()}}]}
        raw['data'][0]['TxTfrCnt'] = '136'
        fetched = first + 2 * reconcile.DAY
        normalized = {'asset': asset, 'providerAsset': registry.network_id(asset), 'fetchedAt': fetched,
                      'cutoffExclusive': fetched, 'rows': bootstrap_network.normalize(raw, asset, fetched)}
        stored = {'asset': asset, 'reference': [], 'networkMonths': [{'bucket': first, 'fetchedAt': 100,
                  'rows': [{'time': first, 'values': {'transfers': 0}, 'statuses': {'transfers': 'before'}}]}]}
        def blob(name, body):
            data = reconcile.dumps(body); compressed = gzip.compress(data, mtime=0)
            (self.folder / name).write_bytes(compressed)
            return {'file': name, 'sha256': hashlib.sha256(compressed).hexdigest(),
                    'uncompressedSha256': hashlib.sha256(data).hexdigest()}
        entry = {'asset': asset, 'providerAsset': registry.network_id(asset), 'sourceFetchedAt': fetched,
                 'fields': fields, 'raw': blob('raw.gz', raw), 'normalized': blob('normalized.gz', normalized),
                 'stored': blob('stored.gz', stored), 'definitions': [{'kind': 'network', 'metric': 'transfers',
                     'unitContract': '건 / 일', 'rawSourceField': 'TxTfrCnt', 'derived': False}]}
        delta = {'asset': asset, 'reviewOnly': True, 'sourceRawSha256': entry['raw']['uncompressedSha256'],
                 'changes': [{'kind': 'network', 'metric': 'transfers', 'time': first,
                              'classification': 'value-difference-review-candidate', 'sourceValue': 136,
                              'storedValue': 0, 'storedFetchedAt': 100}]}
        entry['delta'] = blob('delta.gz', delta)
        return entry, fetched, blob, raw, normalized, delta

    def test_raw_revision_validation_keeps_source_hash_before_and_exact_value(self):
        entry, cutoff, *_ = self.make_source()
        result = reconcile.validate_asset(self.folder, entry, registry.ASSETS, cutoff)
        self.assertEqual(len(result['operations']), 1)
        self.assertEqual(result['operations'][0]['sourceValue'], 136)
        self.assertEqual(result['operations'][0]['beforeStatus'], 'before')

    def test_hash_unit_formula_and_null_substitution_fail_closed(self):
        entry, cutoff, blob, raw, normalized, delta = self.make_source()
        wrong = copy.deepcopy(entry); wrong['raw']['sha256'] = '0' * 64
        with self.assertRaisesRegex(reconcile.ReconcileError, 'compressed-hash'):
            reconcile.validate_asset(self.folder, wrong, registry.ASSETS, cutoff)
        wrong = copy.deepcopy(entry); wrong['definitions'][0]['unitContract'] = 'USD'
        with self.assertRaisesRegex(reconcile.ReconcileError, 'unit-contract'):
            reconcile.validate_asset(self.folder, wrong, registry.ASSETS, cutoff)
        wrong = copy.deepcopy(entry); broken = copy.deepcopy(normalized); broken['rows'][0]['values']['transfers'] = 137
        wrong['normalized'] = blob('wrong-normalized.gz', broken)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'raw-formula-mismatch'):
            reconcile.validate_asset(self.folder, wrong, registry.ASSETS, cutoff)
        wrong = copy.deepcopy(entry); broken = copy.deepcopy(delta); broken['changes'][0]['sourceValue'] = 137
        wrong['delta'] = blob('wrong-delta.gz', broken)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'delta-source-value'):
            reconcile.validate_asset(self.folder, wrong, registry.ASSETS, cutoff)
        wrong = copy.deepcopy(entry); broken = copy.deepcopy(raw); broken['data'][0]['TxTfrCnt'] = None
        wrong['raw'] = blob('null-raw.gz', broken)
        broken_normal = copy.deepcopy(normalized); broken_normal['rows'] = bootstrap_network.normalize(broken, 'XRP', cutoff)
        wrong['normalized'] = blob('null-normalized.gz', broken_normal)
        broken_delta = copy.deepcopy(delta); broken_delta['sourceRawSha256'] = wrong['raw']['uncompressedSha256']
        wrong['delta'] = blob('null-delta.gz', broken_delta)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'delta-source-absent'):
            reconcile.validate_asset(self.folder, wrong, registry.ASSETS, cutoff)

    def test_wrong_asset_incomplete_day_duplicate_and_pagination_rejected(self):
        entry, cutoff, blob, raw, normalized, delta = self.make_source()
        for name, change in [('asset', {'asset': 'btc'}), ('day', {'time': '2013-01-03T00:00:00Z'})]:
            wrong = copy.deepcopy(entry); broken = copy.deepcopy(raw); broken['data'][0].update(change)
            wrong['raw'] = blob(name + '.gz', broken)
            with self.assertRaises(Exception):
                reconcile.validate_asset(self.folder, wrong, registry.ASSETS, cutoff)
        wrong = copy.deepcopy(entry); broken = copy.deepcopy(raw); broken['next_page_url'] = 'https://example.invalid'
        wrong['raw'] = blob('page.gz', broken)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'paginated'):
            reconcile.validate_asset(self.folder, wrong, registry.ASSETS, cutoff)

    def test_zero_reviewed_delta_does_not_start_a_transaction_or_write(self):
        validated = {**self.validated, 'operations': []}
        self.assertTrue(self.apply(validated)['emptyDelta'])
        self.assertFalse(self.db.in_transaction)
        self.assertFalse((self.folder / 'audit').exists())

    def make_backup(self):
        for i in range(17):
            self.db.execute('CREATE TABLE extra_' + str(i) + '(value TEXT)')
        self.db.commit()
        source = self.folder / 'snapshot.sqlite'; clone = self.folder / 'rehearsal.sqlite'
        saved = sqlite3.connect(source); self.db.backup(saved); content = fingerprint(saved); saved.close()
        shutil.copyfile(source, clone)
        now = int(time.time())
        manifest = {'verified': True, 'completedAt': now, 'fileSha256': reconcile.sha_file(source), 'content': content}
        manifest_path = self.folder / 'manifest.json'; manifest_path.write_bytes(reconcile.dumps(manifest))
        proof = {'verified': True, 'independentRestoreVerified': True, 'liveDatabaseOverwritten': False,
                 'sourceSnapshotSha256': reconcile.sha_file(source), 'restoredSnapshotSha256': reconcile.sha_file(clone),
                 'manifestSha256': reconcile.sha_file(manifest_path), 'schemaSha256': content['schemaSha256'],
                 'userTableCount': 21, 'manifestRelativePath': 'manifest.json',
                 'sourceSnapshotRelativePath': 'snapshot.sqlite', 'restoreRelativePath': 'rehearsal.sqlite',
                 'verifiedAt': now, 'contentMatches': True}
        proof_path = self.folder / 'proof.json'; proof_path.write_bytes(reconcile.dumps(proof))
        return manifest_path, proof_path, now

    def test_backup_requires_every_table_hash_integrity_and_independent_clone(self):
        manifest, proof, now = self.make_backup()
        result = reconcile.verify_backup(self.folder, manifest, reconcile.sha_file(manifest), proof,
                                         reconcile.sha_file(proof), now)
        self.assertEqual(len(result['content']['tables']), 21)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'expired'):
            reconcile.verify_backup(self.folder, manifest, reconcile.sha_file(manifest), proof,
                                     reconcile.sha_file(proof), now + 3601)
        clone = sqlite3.connect(self.folder / 'rehearsal.sqlite')
        clone.execute("INSERT INTO extra_0 VALUES('tampered')"); clone.commit(); clone.close()
        with self.assertRaisesRegex(reconcile.ReconcileError, 'snapshot-hash'):
            reconcile.verify_backup(self.folder, manifest, reconcile.sha_file(manifest), proof,
                                     reconcile.sha_file(proof), now)
        document = json.loads(proof.read_text(encoding='utf-8'))
        document['restoredSnapshotSha256'] = reconcile.sha_file(self.folder / 'rehearsal.sqlite')
        proof.write_bytes(reconcile.dumps(document))
        with self.assertRaisesRegex(reconcile.ReconcileError, 'full-content-fingerprint'):
            reconcile.verify_backup(self.folder, manifest, reconcile.sha_file(manifest), proof,
                                     reconcile.sha_file(proof), now)

    def test_resume_is_explicit_and_bound_to_review_and_backup_identities(self):
        path = self.folder / 'checkpoint.json'
        state = reconcile.checkpoint_state(path, False, self.identities, 123)
        self.assertFalse(path.exists())
        path.write_bytes(reconcile.dumps(state))
        with self.assertRaisesRegex(reconcile.ReconcileError, 'explicit-resume'):
            reconcile.checkpoint_state(path, False, self.identities, 123)
        self.assertEqual(reconcile.checkpoint_state(path, True, self.identities, 123), state)
        with self.assertRaisesRegex(reconcile.ReconcileError, 'identity-mismatch'):
            reconcile.checkpoint_state(path, True, {**self.identities, 'reviewManifestSha256': '0' * 64}, 123)

    def test_capacity_guard_refuses_low_disk_before_memory_probe(self):
        usage = type('Usage', (), {'free': reconcile.SPACE_FLOOR - 1})()
        with mock.patch.object(reconcile.shutil, 'disk_usage', return_value=usage):
            with self.assertRaisesRegex(reconcile.ReconcileError, 'disk-below-8gib'):
                reconcile.resource_guard(self.folder)


if __name__ == '__main__':
    unittest.main()
