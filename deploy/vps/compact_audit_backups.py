"""Lossless repack of explicitly selected, inactive historical audit snapshots.

Never selects production data, daily backups or releases. Each input is hashed,
restored and checked against the original verified manifest before replacing its
physical copy with a gzip archive. Logical observations and sidecars are retained.
"""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile, time


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024**2): h.update(block)
    return h.hexdigest()


def compact(root, folders):
    root = root.resolve(strict=True)
    audit = root / 'audit'
    ids = subprocess.check_output(['docker', 'ps', '-aq'], text=True).split()
    mounts = [pathlib.Path(m['Source']).resolve() for c in json.loads(subprocess.check_output(['docker', 'inspect', *ids], text=True)) for m in c['Mounts']]
    sys.path.insert(0, str(root / 'current' / 'scripts'))
    from vps_backup import restore
    report = {'startedAt': int(time.time()), 'freeBeforeBytes': shutil.disk_usage(root).free, 'archives': [], 'productionAndDailyBackupsUnchanged': True}
    for relative in folders:
        folder = root / relative
        if folder.resolve(strict=True) != folder or audit not in folder.parents or not any(part == 'backups' or part.endswith('-backups') for part in folder.parts):
            raise ValueError('Only explicit non-symlink audit backup folders are allowed')
        if any(m == folder or m in folder.parents or folder in m.parents for m in mounts):
            raise ValueError('Mounted snapshot is not eligible')
        # Resume from a verified archive after an interrupted multi-folder run.
        if (folder/'COMPACTION.json').exists():
            receipt = json.loads((folder/'COMPACTION.json').read_text())
            if not receipt.get('fullContentRestoreVerified'): raise ValueError('Unverified previous archive')
            archive = folder/'snapshot-files.tar.gz'
            with tarfile.open(archive) as tar:
                members = tar.getmembers()
                if {m.name for m in members} != set(receipt['fileSha256']) or any(not m.isfile() for m in members): raise ValueError('Changed archive members')
                for m in members:
                    h = hashlib.sha256()
                    with tar.extractfile(m) as stream:
                        while block := stream.read(1024**2): h.update(block)
                    if h.hexdigest() != receipt['fileSha256'][m.name]: raise ValueError('Changed archive bytes')
            report['archives'].append({**receipt,'resumedVerifiedArchive':True})
            continue
        files = sorted(folder.iterdir())
        names = {p.name for p in files}
        if not names <= {'snapshot.sqlite', 'snapshot.sqlite-wal', 'snapshot.sqlite-shm', 'manifest.json'} or not {'snapshot.sqlite','manifest.json'} <= names:
            raise ValueError('Unexpected backup contents')
        if any(not p.is_file() or p.is_symlink() for p in files): raise ValueError('Non-regular backup')
        exact = {str(p.resolve()) for p in files}
        for proc in pathlib.Path('/proc').glob('[0-9]*'):
            for fd in (proc / 'fd').glob('*'):
                try: target = os.readlink(fd)
                except FileNotFoundError: continue
                if target in exact: raise ValueError('An active process has the snapshot open')
        manifest = json.loads((folder / 'manifest.json').read_text())
        checksums = {p.name: digest(p) for p in files}
        if not manifest.get('verified') or checksums['snapshot.sqlite'] != manifest['fileSha256']:
            raise ValueError('Original backup verification mismatch')
        archive = folder / 'snapshot-files.tar.gz'
        temporary = folder / 'snapshot-files.tar.gz.tmp'
        if archive.exists() or temporary.exists(): raise ValueError('Archive already exists')
        with temporary.open('xb') as raw:
            with tarfile.open(fileobj=raw, mode='w:gz', compresslevel=3) as tar:
                for p in files: tar.add(p, arcname=p.name, recursive=False)
            raw.flush(); os.fsync(raw.fileno())
        with tempfile.TemporaryDirectory(prefix='audit-restore-', dir=root/'audit') as temp:
            temp = pathlib.Path(temp)
            with tarfile.open(temporary) as tar:
                members = tar.getmembers()
                if {m.name for m in members} != names or any(not m.isfile() for m in members): raise ValueError('Unexpected archive member')
                tar.extractall(temp, filter='data')
            if any(digest(temp/name) != checksum for name,checksum in checksums.items()): raise ValueError('Expanded bytes differ')
            result = restore(temp/'snapshot.sqlite', temp/'restored.sqlite', temp/'manifest.json')
            if not result['verified']: raise ValueError('Restore failed')
        if any(digest(p) != checksums[p.name] for p in files): raise ValueError('Input changed during compaction')
        original = sum(p.stat().st_size for p in files)
        os.chmod(temporary,0o600); os.replace(temporary,archive)
        receipt = {'archive': str(archive.relative_to(root)), 'originalBytes': original, 'compressedBytes': archive.stat().st_size, 'fileSha256': checksums, 'fullContentRestoreVerified': True}
        (folder/'COMPACTION.json').write_text(json.dumps(receipt,indent=2))
        (folder/'ARCHIVE_RESTORE.txt').write_text('Expand snapshot-files.tar.gz into a NEW disposable directory. Verify all hashes in COMPACTION.json. Restore using scripts/vps_backup.py and the original manifest.json. Never overwrite a live DB. The original snapshot and SQLite sidecar bytes are preserved in the archive.\n')
        # This replaces inactive physical copies only AFTER a full content restore.
        for p in files:
            if p.name != 'manifest.json': p.unlink()
        report['archives'].append(receipt)
    report.update(completedAt=int(time.time()), freeAfterBytes=shutil.disk_usage(root).free)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--folder', action='append', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    report = compact(pathlib.Path(args.root), args.folder)
    pathlib.Path(args.output).write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
