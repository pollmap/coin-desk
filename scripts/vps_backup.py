"""Online SQLite snapshot, full restore verification, bounded project-only retention."""
import argparse, datetime, errno, hashlib, json, os, pathlib, shutil, sqlite3, sys, tempfile, time
from backup_check import fingerprint
from import_d1_export import check_integrity

def atomic_json(path, data):
    # An interrupted/concurrent writer must not leave a shared empty status file.
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name, suffix='.tmp', dir=path.parent)
    temporary = pathlib.Path(name)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, indent=2)
            stream.flush(); os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def failure_code(error):
    if isinstance(error, OSError):
        return {errno.ENOSPC: 'storage_full', errno.EACCES: 'storage_permission', errno.EROFS: 'storage_read_only'}.get(error.errno, 'storage_io')
    if isinstance(error, sqlite3.Error): return 'sqlite_backup'
    return 'backup_verification'

def restore(snapshot, destination, manifest):
    snapshot = pathlib.Path(snapshot).resolve(strict=True)
    destination = pathlib.Path(destination).resolve()
    if destination.exists(): raise ValueError('Restore requires a new destination; stop services before switching DB paths')
    report = json.loads(pathlib.Path(manifest).read_text(encoding='utf-8'))
    if not report.get('verified') or hashlib.sha256(snapshot.read_bytes()).hexdigest() != report['fileSha256']:
        raise ValueError('Snapshot checksum/verification failed')
    source = sqlite3.connect(snapshot.as_uri() + '?mode=ro', uri=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    target = sqlite3.connect(destination)
    try:
        source.backup(target); check_integrity(target)
        if fingerprint(target) != report['content']: raise ValueError('Restored content mismatch')
    except BaseException:
        target.close(); destination.unlink(missing_ok=True); raise
    finally: source.close(); target.close()
    return {'verified': True, 'liveDatabaseOverwritten': False}

def backup(source, folder, status, retention_days=14, budget_bytes=2*1024**3):
    source = pathlib.Path(source).resolve()
    folder, status = pathlib.Path(folder).resolve(), pathlib.Path(status).resolve()
    if source == status or source.parent == folder: raise ValueError('Backups must have a separate project backup directory')
    if retention_days < 2 or budget_bytes < 1024*1024: raise ValueError('Invalid retention or budget')
    folder.mkdir(parents=True, exist_ok=True); status.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        atomic_json(status, {'ok': False, 'verified': False, 'startedAt': int(time.time()), 'reason': 'backup_in_progress'})
        temporary = pathlib.Path(tempfile.mkdtemp(prefix='.pending-', dir=folder))
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        snapshot = temporary / 'snapshot.sqlite'
        live = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
        saved = sqlite3.connect(snapshot)
        try:
            live.backup(saved, pages=512, sleep=0.05)
            check_integrity(saved); content = fingerprint(saved)
        finally: live.close(); saved.close()
        report = {'verified': True, 'completedAt': int(time.time()), 'fileSha256': hashlib.sha256(snapshot.read_bytes()).hexdigest(), 'content': content}
        atomic_json(temporary / 'manifest.json', report)
        restore(snapshot, temporary / 'restored.sqlite', temporary / 'manifest.json')
        (temporary / 'restored.sqlite').unlink()
        os.chmod(snapshot, 0o600)
        final = folder / stamp
        os.replace(temporary, final)
        # Only our verified, nonsymlink timestamp directories are eligible for pruning.
        def owned(entry):
            if not entry.is_dir() or entry.is_symlink() or not entry.name.endswith('Z') or not entry.name[:-1].replace('T','').isdigit(): return False
            try:
                manifest=json.loads((entry/'manifest.json').read_text(encoding='utf-8'))
                return manifest.get('verified') is True and 'content' in manifest and (entry/'snapshot.sqlite').is_file()
            except (OSError,ValueError): return False
        entries = sorted(p for p in folder.iterdir() if owned(p))
        cutoff = time.time() - retention_days * 86400
        total = sum(p.stat().st_size for p in folder.rglob('*') if p.is_file() and not p.is_symlink())
        for entry in entries[:-2]:
            if entry.stat().st_mtime < cutoff or total > budget_bytes:
                size = sum(p.stat().st_size for p in entry.iterdir() if p.is_file())
                if entry.parent != folder: raise ValueError('Unsafe retention target')
                shutil.rmtree(entry); total -= size
        if total > budget_bytes: raise ValueError('Backup budget exceeded; keeping the latest two verified snapshots')
        atomic_json(status, {'ok': True, 'verified': True, 'completedAt': report['completedAt'], 'retainedBytes': total, 'offsite': False})
        return report
    except BaseException as error:
        code = failure_code(error)
        # Log only a bounded code even when disk failure prevents status writes.
        print(json.dumps({'event': 'backup_failed', 'code': code}), file=sys.stderr)
        try:
            atomic_json(status, {'ok': False, 'verified': False, 'failedAt': int(time.time()), 'reason': 'backup_or_budget_verification_failed', 'code': code})
        except OSError:
            pass
        raise
    finally:
        if temporary is not None and temporary.exists(): shutil.rmtree(temporary)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    make = sub.add_parser('backup')
    make.add_argument('--source', required=True); make.add_argument('--folder', required=True); make.add_argument('--status', required=True)
    make.add_argument('--retention-days', type=int, default=14); make.add_argument('--budget-bytes', type=int, default=2*1024**3)
    recover = sub.add_parser('restore')
    recover.add_argument('--snapshot', required=True); recover.add_argument('--destination', required=True); recover.add_argument('--manifest', required=True)
    args = vars(parser.parse_args()); operation = args.pop('operation')
    try:
        print(json.dumps(backup(**args) if operation == 'backup' else restore(**args), indent=2))
    except Exception as error:
        print(json.dumps({'event': 'backup_command_failed', 'code': failure_code(error)}), file=sys.stderr)
        sys.exit(1)
