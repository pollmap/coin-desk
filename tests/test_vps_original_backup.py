"""Real isolated SQLite + immutable Original metadata backup/restore regression checks."""
import copy, datetime, hashlib, json, pathlib, sqlite3, sys, tempfile, unittest
from contextlib import closing
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import rainbow_reference_backup as metadata
from vps_backup import backup, restore

class OriginalBackup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name); self.data = self.root/'data'; self.data.mkdir()
        self.db = self.data/'coin-desk.sqlite'
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('CREATE TABLE observations(id INTEGER PRIMARY KEY, value TEXT)')
            db.execute('INSERT INTO observations VALUES(1,?)', ('0.00000123',))
            db.commit()
        self.reference = json.loads((ROOT/'shared/btc-rainbow-original-reference.json').read_text())
        self.directory = self.data/'rainbow-original'; self.directory.mkdir()
        self.write_snapshot(self.reference)
        self.write_index(self.reference)

    def write_snapshot(self, reference, directory=None):
        target = (directory or self.directory)/('snapshot-'+reference['snapshotId']+'.json')
        target.write_text(json.dumps(reference, separators=(',', ':')), encoding='utf-8')
        return target

    def write_index(self, latest, older=None):
        versions = {r['modelVersion']:r['snapshotId'] for r in (older or [])+[latest]}
        (self.directory/'index.json').write_text(json.dumps({'schemaVersion':1,'latest':latest['modelVersion'],'versions':versions}))

    def added_reference(self, historical=False):
        result = copy.deepcopy(self.reference)
        if historical:
            result['dates'].append('2024-05-24'); result['dates'].sort()
        else:
            day = datetime.date.fromisoformat(result['dates'][-1])+datetime.timedelta(days=1)
            result['dates'].append(day.isoformat())
            result['verifiedAt'] += 86400
        result['snapshotId'] = hashlib.sha256('\n'.join(result['dates']).encode()).hexdigest()
        if historical: result['modelVersion'] = 'bc-original-'+result['formulaHash'][:12]+'-'+result['snapshotId'][:12]
        return result

    def make_backup(self):
        result = backup(self.db, self.root/'backups', self.root/'backup-status.json')
        folder = next(p for p in (self.root/'backups').iterdir() if not p.name.startswith('.'))
        return result, folder

    def recover(self, folder, target=None):
        return restore(folder/'snapshot.sqlite', target or self.root/'restored/coin-desk.sqlite', folder/'manifest.json')

    def test_backup_preserves_latest_binding_all_prior_models_and_append_snapshots(self):
        appended, revision = self.added_reference(), self.added_reference(True)
        self.write_snapshot(appended); self.write_snapshot(revision)
        self.write_index(revision, [appended])
        (self.directory/'status.json').write_text(json.dumps({'lastAttempt':self.reference['verifiedAt'],'lastVerifiedAt':self.reference['verifiedAt'],'snapshotId':revision['snapshotId'],'code':'ok'}))
        (self.directory/'refresh.lock').write_text('transient lease must not be restored')
        (self.directory/'.private-write.tmp').write_text('unfinished transient file')
        expected, _ = metadata.inventory(self.directory)
        report, folder = self.make_backup(); self.assertEqual(report['referenceMetadata'], expected)
        self.assertEqual(expected['snapshotCount'], 3); self.assertEqual(len(expected['versions']), 2)
        result = self.recover(folder)
        self.assertTrue(result['referenceMetadata']['restored'])
        actual, _ = metadata.inventory(self.root/'restored/rainbow-original'); self.assertEqual(actual, expected)
        self.assertFalse((self.root/'restored/rainbow-original/refresh.lock').exists())
        with closing(sqlite3.connect(self.root/'restored/coin-desk.sqlite')) as db:
            self.assertEqual(db.execute('SELECT value FROM observations').fetchone(), ('0.00000123',))
        self.assertTrue(json.loads((self.root/'backup-status.json').read_text())['referenceMetadata']['snapshotCount']==3)

    def test_metadata_is_verified_before_creating_a_restore_database(self):
        _, folder = self.make_backup()
        path = folder/'rainbow-original'/('snapshot-'+self.reference['snapshotId']+'.json')
        value = json.loads(path.read_text()); value['dates'].pop(); path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'date content hash'): self.recover(folder)
        self.assertFalse((self.root/'restored/coin-desk.sqlite').exists())
        self.assertTrue(self.db.is_file())

    def test_index_binding_and_snapshot_file_bytes_are_both_verified(self):
        _, folder = self.make_backup(); directory = folder/'rainbow-original'
        path = directory/'index.json'; original = path.read_bytes()
        value = json.loads(original); value['versions'][value['latest']] = 'a'*64; path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'index snapshot binding'): self.recover(folder)
        path.write_bytes(original+b'\n')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'): self.recover(folder)

    def test_backup_rejects_corruption_without_modifying_source_or_previous_backups(self):
        _, folder = self.make_backup(); expected = (folder/'manifest.json').read_bytes()
        path = self.directory/'index.json'; invalid = json.loads(path.read_text()); invalid['latest']='missing'; path.write_text(json.dumps(invalid))
        source_before = self.db.read_bytes(); broken_before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'index structure'): self.make_backup()
        self.assertEqual(self.db.read_bytes(), source_before); self.assertEqual(path.read_bytes(), broken_before)
        self.assertEqual((folder/'manifest.json').read_bytes(), expected)
        self.assertFalse(list((self.root/'backups').glob('.pending-*')))
        self.assertFalse(json.loads((self.root/'backup-status.json').read_text())['verified'])

    def test_different_existing_metadata_is_never_overwritten(self):
        _, folder = self.make_backup(); target = self.root/'restored'; target.mkdir()
        preserved = target/'rainbow-original'; preserved.mkdir(); (preserved/'status.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'existing destination differs'): self.recover(folder)
        self.assertEqual((preserved/'status.json').read_text(), '{}')
        self.assertFalse((target/'coin-desk.sqlite').exists())

    def test_matching_existing_metadata_can_be_reused_without_rewriting(self):
        _, folder = self.make_backup(); self.recover(folder)
        index = self.root/'restored/rainbow-original/index.json'; stat = index.stat()
        result = self.recover(folder, self.root/'restored/second.sqlite')
        self.assertTrue(result['referenceMetadata']['reusedMatchingDestination'])
        self.assertEqual(index.stat().st_mtime_ns, stat.st_mtime_ns)

    def test_older_supported_backup_can_restore_after_current_source_hash_changes(self):
        report, folder = self.make_backup(); self.assertEqual(report['referenceMetadata']['compatibility'], 'supported')
        with patch.object(metadata, 'SCRIPT_HASH', '0'*64):
            result = self.recover(folder)
            self.assertEqual(result['referenceMetadata']['compatibility'], 'stored_model_not_supported_by_current_release')
        self.assertEqual((self.root/'restored/rainbow-original/index.json').read_bytes(), (self.directory/'index.json').read_bytes())

    def test_legacy_database_only_backup_remains_restorable_and_explicitly_incomplete(self):
        _, folder = self.make_backup(); manifest = folder/'manifest.json'
        value = json.loads(manifest.read_text()); value.pop('referenceMetadata'); manifest.write_text(json.dumps(value))
        result = self.recover(folder)
        self.assertEqual(result['referenceMetadata']['state'], 'not_in_legacy_backup')
        self.assertFalse((self.root/'restored/rainbow-original').exists())

    def test_missing_metadata_directory_is_explicit_and_not_synthesized(self):
        self.directory.rename(self.data/'preserved-original')
        report, folder = self.make_backup(); self.assertEqual(report['referenceMetadata']['state'], 'absent')
        self.assertEqual(self.recover(folder)['referenceMetadata']['state'], 'absent')
        self.assertTrue((self.data/'preserved-original/index.json').is_file())

    def test_size_guard_and_pinned_formula_match_frontend_baseline(self):
        self.assertEqual(metadata.FORMULA_HASH, self.reference['formulaHash'])
        self.assertEqual(metadata.SCRIPT_HASH, self.reference['sourceScriptHash'])
        with patch.object(metadata, 'MAX_BYTES', 100):
            with self.assertRaisesRegex(ValueError, 'total byte limit'): metadata.inventory(self.directory)

if __name__ == '__main__': unittest.main()
