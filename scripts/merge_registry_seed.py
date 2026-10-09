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
            'network_coverage': ['asset', 'metric'],
            'reference_prices': ['asset'],
            'derivative_series': ['asset', 'metric'],
        }
        report = {'inserted': {}, 'preservedExistingPartitions': {}, 'updates': 0, 'deletes': 0,
                  'addedNetworkMetricValues': 0, 'existingNetworkValuesReplaced': 0}
        existing_network = set(db.execute('SELECT asset,metric FROM main.network_coverage'))
        incoming_network = set(db.execute('SELECT asset,metric FROM seed.network_coverage'))
        existing_network_assets = {asset for asset, _ in existing_network}
        new_metrics = {}
        for asset, metric in incoming_network - existing_network:
            if asset in existing_network_assets:
                new_metrics.setdefault(asset, set()).add(metric)
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
            # An existing asset can gain a newly verified metric. Add that metric's
            # observations without filling gaps or changing any existing metric.
            for asset, metrics in new_metrics.items():
                for bucket, payload, fetched in db.execute('SELECT bucket,payload,fetched_at FROM seed.network_months WHERE asset=?', (asset,)).fetchall():
                    previous = db.execute('SELECT payload FROM main.network_months WHERE asset=? AND bucket=?', (asset,bucket)).fetchone()
                    days = {day['time']: day for day in json.loads(previous[0])} if previous else {}
                    added = 0
                    for incoming in json.loads(payload):
                        values = {key:value for key,value in incoming['values'].items() if key in metrics}
                        if not values:
                            continue
                        day = days.setdefault(incoming['time'], {'time': incoming['time'], 'values': {}})
                        for key,value in values.items():
                            if key not in day['values']:
                                day['values'][key] = value
                                if key in incoming.get('statuses', {}):
                                    day.setdefault('statuses', {})[key] = incoming['statuses'][key]
                                added += 1
                        if 'price' not in day['values'] and 'price' in incoming['values']:
                            day['values']['price'] = incoming['values']['price']
                    if added:
                        merged = json.dumps(sorted(days.values(), key=lambda d:d['time']), separators=(',', ':'))
                        if previous:
                            db.execute('UPDATE main.network_months SET payload=? WHERE asset=? AND bucket=?', (merged,asset,bucket))
                            report['updates'] += 1
                        else:
                            db.execute('INSERT INTO main.network_months VALUES(?,?,?,?)', (asset,bucket,merged,fetched))
                            report['inserted']['network_months'] += 1
                        report['addedNetworkMetricValues'] += added
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
