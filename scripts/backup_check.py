"""Read-only recovery drill; raw artifacts stay in ignored work/."""
import argparse, datetime, hashlib, json, pathlib, sqlite3, tempfile

def identifier(name):
    return '"' + name.replace('"', '""') + '"'

def fingerprint(db):
    schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
    tables = {}
    for kind, name, _, _ in schema:
        if kind != 'table': continue
        def encode(row):
            return json.dumps([[type(v).__name__, v.hex() if isinstance(v, bytes) else v] for v in row], ensure_ascii=False, separators=(',', ':')).encode()
        hashes = sorted(hashlib.sha256(encode(row)).digest() for row in db.execute('SELECT * FROM ' + identifier(name)))
        digest = hashlib.sha256()
        for item in hashes: digest.update(item)
        tables[name] = {'rows': len(hashes), 'sha256': digest.hexdigest()}
    return {'schemaSha256': hashlib.sha256(json.dumps(schema, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(), 'schemaObjects': len(schema), 'tables': tables}

def verify(source_path, output_dir):
    source_path = pathlib.Path(source_path).resolve(strict=True)
    output_dir = pathlib.Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder = pathlib.Path(tempfile.mkdtemp(prefix=stamp + '-', dir=output_dir))
    if source_path.suffix.lower() == '.sql':
        source = sqlite3.connect(folder / 'export-import.sqlite')
        source.executescript('BEGIN;\n' + source_path.read_text(encoding='utf-8-sig') + '\nCOMMIT;')
    else:
        source = sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True)
    backup = sqlite3.connect(folder / 'backup.sqlite')
    restored = sqlite3.connect(folder / 'restored.sqlite')
    try:
        source.backup(backup)
        backup.backup(restored)
        expected, actual = fingerprint(backup), fingerprint(restored)
        integrity = [row[0] for row in restored.execute('PRAGMA integrity_check')]
        foreign_keys = restored.execute('PRAGMA foreign_key_check').fetchall()
        if expected != actual or integrity != ['ok'] or foreign_keys:
            raise AssertionError('Backup schema/content/integrity mismatch')
        report = {'verifiedAt': stamp, 'backupRestoreIdentical': True, 'liveDatabaseOverwritten': False, 'integrity': integrity, 'foreignKeyViolations': len(foreign_keys), **actual}
        (folder / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        return report
    finally:
        source.close(); backup.close(); restored.close()

if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, default=root / 'work/local.sqlite')
    parser.add_argument('--output', type=pathlib.Path, default=root / 'work/recovery')
    args = parser.parse_args()
    print(json.dumps(verify(args.source, args.output), indent=2))
