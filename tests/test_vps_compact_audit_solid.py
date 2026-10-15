"""VPS offline safety/restore checks; no Docker, SSH or production connection."""
import hashlib
import importlib.util
import io
import json
import lzma
from pathlib import Path
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('solid_audit', ROOT/'deploy/vps/compact_audit_solid.py')
solid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(solid)
sys.path.insert(0, str(ROOT/'scripts'))
from backup_check import fingerprint


class SolidAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'coin-desk'
        self.backup = self.root/'audit/old/backups/verified'
        self.backup.mkdir(parents=True)
        self.scripts = self.root/'current/scripts'
        self.scripts.mkdir(parents=True)
        for name in ['vps_backup.py', 'backup_check.py', 'import_d1_export.py']:
            shutil.copyfile(ROOT/'scripts'/name, self.scripts/name)
        path = self.backup/'snapshot.sqlite'
        db = sqlite3.connect(path)
        for i in range(21):
            db.execute(f'CREATE TABLE t{i}(value TEXT)')
            db.execute(f'INSERT INTO t{i} VALUES (?)', (f'관측 {i}',))
        db.commit()
        content = fingerprint(db)
        db.close()
        (self.backup/'manifest.json').write_text(json.dumps({'verified':True,
            'fileSha256':solid.digest(path), 'content':content}), encoding='utf-8')
        self.names = [x.relative_to(self.root).as_posix() for x in self.backup.iterdir()]

    def manifest(self):
        return solid.source_manifest(self.root, self.names, lambda paths: None)

    def budget(self, root, maximum, reserve, timeout=600):
        return solid.Budget(root, maximum, reserve, timeout,
                            free_disk=lambda:32*solid.GIB, memory=lambda:8*solid.GIB)

    def test_rejects_live_backups_release_traversal_and_repeated_inputs(self):
        for name in ['shared/data/coin-desk.sqlite', 'backups/verified/snapshot.sqlite',
                     'releases/vps-test/snapshot.sqlite', 'audit/../../secrets.json',
                     'audit/space-035/old.json', '/audit/old.json', 'audit\\old.json',
                     'audit/old/./backups/verified/manifest.json',
                     'audit//old/backups/verified/manifest.json']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                solid.source_manifest(self.root, [name], lambda paths: None)
        with self.assertRaises(ValueError):
            solid.source_manifest(self.root, self.names+self.names, lambda paths: None)

    def test_activity_inventory_is_required_and_mounted_inputs_rejected(self):
        with mock.patch.object(solid.subprocess, 'check_output', side_effect=[
                'container-id', json.dumps([{'Source':str(self.backup)}])]):
            with self.assertRaisesRegex(ValueError, 'mounted'):
                solid.inactive_sources([self.backup/'snapshot.sqlite'])
        with mock.patch.object(solid.subprocess, 'check_output', return_value=''):
            with self.assertRaisesRegex(ValueError, 'inventory'):
                solid.inactive_sources([self.backup/'snapshot.sqlite'])

    def test_budget_rejects_output_memory_disk_and_deadline_overruns(self):
        budget=self.budget(self.root,1024,1024)
        with self.assertRaisesRegex(ValueError,'quota'):
            budget.check(1025)
        budget.deadline=0
        with self.assertRaisesRegex(ValueError,'timeout'):
            budget.check()
        with self.assertRaisesRegex(ValueError,'memory'):
            solid.Budget(self.root,1024,1024,memory=lambda:solid.MEMORY_RESERVE,
                         free_disk=lambda:32*solid.GIB)
        with self.assertRaisesRegex(ValueError,'space'):
            solid.Budget(self.root,1024,1024,memory=lambda:8*solid.GIB,
                         free_disk=lambda:solid.DISK_RESERVE)

    def test_pilot_checks_all_bytes_and_restores_all_21_tables_without_replacement(self):
        before=self.manifest()
        report=solid.pilot(self.root,self.names,'audit/space-035/pilot-test',
                           'audit/old/backups/verified',8*1024**2,30,
                           activity_check=lambda paths:None,budget_factory=self.budget)
        self.assertTrue(report['verified'])
        self.assertEqual(report['verifiedArchiveMembers'],2)
        self.assertEqual(report['independentRestore']['userTables'],21)
        self.assertFalse(report['originalDeletionPerformed'])
        self.assertFalse(report['sourceReplacementSupported'])
        self.assertEqual(self.manifest(),before)
        self.assertTrue((self.root/'audit/space-035/pilot-test/restored.sqlite').is_file())
        with self.assertRaisesRegex(ValueError,'overwrite'):
            solid.pilot(self.root,self.names,'audit/space-035/pilot-test',
                        'audit/old/backups/verified',8*1024**2,30,
                        activity_check=lambda paths:None,budget_factory=self.budget)

    def test_rejects_wrong_archive_bytes(self):
        manifest=self.manifest()
        archive=Path(self.temp.name)/'corrupt.tar.xz'
        with tarfile.open(archive,'w:xz') as tar:
            content=json.dumps(manifest).encode()
            info=tarfile.TarInfo(solid.MANIFEST_NAME);info.size=len(content)
            tar.addfile(info,io.BytesIO(content))
            for row in manifest['files']:
                payload=b'wrong source bytes'
                info=tarfile.TarInfo(row['name']);info.size=len(payload)
                tar.addfile(info,io.BytesIO(payload))
        with self.assertRaisesRegex(ValueError,'bytes differ'):
            solid.verify_archive(archive,manifest,self.budget(self.root,8*1024**2,1024))
        valid=Path(self.temp.name)/'valid.tar.xz'
        with tarfile.open(valid,'w:xz') as tar:
            payload=json.dumps(manifest).encode()
            info=tarfile.TarInfo(solid.MANIFEST_NAME);info.size=len(payload)
            tar.addfile(info,io.BytesIO(payload))
            for row in manifest['files']:
                tar.add(self.root/row['name'],arcname=row['name'],recursive=False)
        truncated=Path(self.temp.name)/'truncated.tar.xz'
        truncated.write_bytes(valid.read_bytes()[:-8])
        with self.assertRaises((ValueError,EOFError,tarfile.ReadError,lzma.LZMAError)):
            solid.verify_archive(truncated,manifest,self.budget(self.root,8*1024**2,1024))

    def test_manifest_detects_changed_original_and_preserves_content_hashes(self):
        before=self.manifest()
        (self.backup/'snapshot.sqlite').write_bytes(b'changed original')
        after=self.manifest()
        self.assertNotEqual(before,after)
        a={x['name']:x['sha256'] for x in before['files']}
        b={x['name']:x['sha256'] for x in after['files']}
        self.assertNotEqual(a['audit/old/backups/verified/snapshot.sqlite'],
                            b['audit/old/backups/verified/snapshot.sqlite'])


if __name__ == '__main__':
    unittest.main()
