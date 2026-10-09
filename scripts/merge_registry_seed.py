"""Insert reviewed histories for missing source partitions; never replace existing data.

Run against a stopped, backed-up project database. The seed is a source-verified
isolated SQLite file produced by verify_registry_data.py, not a public upload.
"""
from contextlib import closing
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from backup_check import fingerprint
from import_d1_export import check_integrity


def merge(seed, target, seed_report, backup_manifest):
    seed, target = Path(seed).resolve(strict=True), Path(target).resolve(strict=True)
    if seed == target:
        raise ValueError('Seed and target must differ')
    verified = json.loads(Path(seed_report).read_text(encoding='utf-8'))
    if verified.get('fixture') is not False or verified['integrity'] != 'ok' or hashlib.sha256(seed.read_bytes()).hexdigest() != verified['seedSha256']:
        raise ValueError('Seed verification or hash failed')
    manifest = json.loads(Path(backup_manifest).read_text(encoding='utf-8'))
    if not manifest.get('verified'):
        raise ValueError('A verified backup is required')
    with closing(sqlite3.connect(target)) as db:
        if fingerprint(db) != manifest['content']:
            raise ValueError('Target changed after backup; stop writers and take a fresh backup')
        db.execute('ATTACH DATABASE ? AS seed', (str(seed),))
        partitions = {
            'candles': ['asset', 'market', 'interval'],
            'price_archive': ['asset', 'market', 'interval'],
            'network_months': ['asset'],
            'network_coverage': ['asset'],
            'reference_prices': ['asset'],
            'derivative_series': ['asset', 'metric'],
        }
        report = {'inserted': {}, 'preservedExistingPartitions': {}, 'updates': 0, 'deletes': 0}
        with db:
            for table, keys in partitions.items():
                before = db.total_changes
                # Each existing asset/source partition is owned by its live collector.
                # Source expansion may only introduce partitions absent from the target.
                columns = ','.join(keys)
                existing = set(db.execute(f'SELECT DISTINCT {columns} FROM main.{table}').fetchall())
                incoming = set(db.execute(f'SELECT DISTINCT {columns} FROM seed.{table}').fetchall())
                for partition in sorted(incoming-existing):
                    conditions = ' AND '.join(f'{key}=?' for key in keys)
                    db.execute(f'INSERT INTO main.{table} SELECT * FROM seed.{table} WHERE {conditions}', partition)
                report['inserted'][table] = db.total_changes-before
                report['preservedExistingPartitions'][table] = len(existing)
            for table in ['ingestion', 'state', 'raw_samples']:
                before = db.total_changes
                db.execute(f'INSERT OR IGNORE INTO main.{table} SELECT * FROM seed.{table}')
                report['inserted'][table] = db.total_changes-before
            check_integrity(db)
        report['integrity'] = 'ok'
        report['seedSha256'] = verified['seedSha256']
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['seed','target','seed-report','backup-manifest']:
        parser.add_argument('--'+key, required=True)
    print(json.dumps(merge(**vars(parser.parse_args())), indent=2))
