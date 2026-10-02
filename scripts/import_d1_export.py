"""Validate a D1 SQL export into a NEW, isolated SQLite file. Never overwrite a DB."""
import argparse, hashlib, json, os, pathlib, sqlite3, tempfile, time
from backup_check import fingerprint, identifier

ROOT = pathlib.Path(__file__).resolve().parents[1]

def check_integrity(db):
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Database integrity or foreign-key check failed')

def shape(db, table):
    columns = db.execute('PRAGMA table_info(' + identifier(table) + ')').fetchall()
    indexes = sorted((row[2], tuple(x[2] for x in db.execute('PRAGMA index_info(' + identifier(row[1]) + ')')))
                     for row in db.execute('PRAGMA index_list(' + identifier(table) + ')'))
    return columns, indexes, db.execute('PRAGMA foreign_key_list(' + identifier(table) + ')').fetchall()

def import_export(source, destination, migrations=ROOT / 'migrations'):
    source, destination = pathlib.Path(source).resolve(strict=True), pathlib.Path(destination).resolve()
    if destination.exists() or pathlib.Path(str(destination) + '-wal').exists():
        raise ValueError('Destination exists; refusing to overwrite existing data')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.stat().st_size > 512 * 1024 * 1024:
        raise ValueError('Export exceeds the 512 MiB import limit')
    # Preserve CR/LF inside SQL string values as well as original schema text.
    with source.open('r', encoding='utf-8-sig', newline='') as export: text = export.read()
    expected = sqlite3.connect(':memory:')
    migrations = pathlib.Path(migrations)
    files = sorted(migrations.glob('*.sql'))
    if not files: raise ValueError('No migrations found')
    for file in files: expected.executescript(file.read_text(encoding='utf-8'))
    descriptor, temporary_name = tempfile.mkstemp(prefix='.import-', suffix='.sqlite', dir=destination.parent)
    os.close(descriptor)
    temporary = pathlib.Path(temporary_name)
    db = sqlite3.connect(temporary)
    try:
        # D1 exports have no enclosing transaction. Avoid an fsync per INSERT in
        # this disposable staging file only. Source and destination stay intact;
        # integrity/content checks precede the separate fsynced O_EXCL publish.
        db.execute('PRAGMA journal_mode=MEMORY')
        db.execute('PRAGMA synchronous=OFF')
        def authorize(action, arg1, arg2, *_):
            if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH): return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() in ('load_extension', 'readfile', 'writefile'):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_PRAGMA and str(arg1).lower() not in ('foreign_keys', 'defer_foreign_keys'):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        db.set_authorizer(authorize)
        db.executescript(text)
        db.set_authorizer(None)
        check_integrity(db)
        for (table,) in expected.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
            if shape(db, table) != shape(expected, table):
                raise ValueError('Export schema does not match migrations: ' + table)
        before = fingerprint(db)
        # Imported historical migrations are acknowledged, never replayed (0008 rebuilds cron_runs).
        db.execute('CREATE TABLE _coin_desk_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at INTEGER NOT NULL)')
        for file in files:
            checksum = hashlib.sha256(file.read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest()
            db.execute('INSERT INTO _coin_desk_migrations VALUES(?,?,?)', (file.name, checksum, int(time.time())))
        db.commit()
        restored = sqlite3.connect(':memory:')
        try:
            db.backup(restored)
            check_integrity(restored)
            if fingerprint(db) != fingerprint(restored): raise ValueError('Imported backup content mismatch')
        finally: restored.close()
        db.close()
        # Atomic creation with O_EXCL prevents a race from replacing another import.
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, 'wb') as output, temporary.open('rb') as data:
                while chunk := data.read(1024 * 1024): output.write(chunk)
                output.flush(); os.fsync(output.fileno())
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        report = {'verified': True, 'existingDataOverwritten': False, 'exportSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                  'migrationsAcknowledged': len(files), 'imported': before}
        destination.with_suffix('.import.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        return report
    finally:
        db.close(); expected.close(); temporary.unlink(missing_ok=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--destination', type=pathlib.Path, required=True)
    args = parser.parse_args()
    print(json.dumps(import_export(args.source, args.destination), indent=2))
