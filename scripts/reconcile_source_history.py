"""Review-only by default. Apply hash-pinned Coin Metrics deltas after verified backup.

No networking, collection, schema migration, deletion, seed or ingestion-success writes.
Production execution is Linux only; source packs remain private, noncommercial audit data.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
import uuid

from backup_check import fingerprint
import bootstrap_network
import registry as registry_module

DAY = 86400
SPACE_FLOOR = 8 * 1024**3
MEMORY_FLOOR = 1536 * 1024**2
ALLOWED = {'source-only-latest-tail', 'value-difference-review-candidate'}
RAW = bootstrap_network.FIELDS
DERIVED = {'realized_cap': ['market_cap', 'mvrv'], 'realized_price': ['price', 'mvrv'],
           'nupl': ['mvrv'], 'exchange_netflow': ['exchange_inflow', 'exchange_outflow']}


class ReconcileError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise ReconcileError(code)


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate-json-key')
        result[key] = value
    return result


def read_json(path, maximum=4 * 1024**2):
    with Path(path).open('rb') as stream:
        body = stream.read(maximum + 1)
    require(len(body) <= maximum, 'json-body-limit')
    return json.loads(body, object_pairs_hook=object_pairs)


def contained(root, relative):
    require(isinstance(relative, str) and not Path(relative).is_absolute(), 'absolute-artifact-path')
    candidate = root / relative
    require(not candidate.is_symlink(), 'symlink-artifact')
    path = candidate.resolve(strict=True)
    require(path.is_relative_to(root.resolve()) and path.is_file(), 'artifact-outside-root')
    return path


def read_pack(folder, descriptor):
    path = contained(folder, descriptor['file'])
    compressed_sha = descriptor.get('sha256', descriptor.get('gzipSha256'))
    raw_sha = descriptor.get('uncompressedSha256', descriptor.get('rawSha256'))
    require(path.stat().st_size <= 4 * 1024**2 and sha_file(path) == compressed_sha,
            'source-compressed-hash')
    with gzip.open(path, 'rb') as stream:
        body = stream.read(16 * 1024**2 + 1)
    require(len(body) <= 16 * 1024**2 and hashlib.sha256(body).hexdigest() == raw_sha,
            'source-raw-hash-or-limit')
    return json.loads(body, object_pairs_hook=object_pairs)


def valid_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def valid_day(value, cutoff):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value < cutoff and value % DAY == 0


def unit(asset, metric):
    fixed = {'price': 'USD', 'PriceUSD': 'USD', 'mvrv': '배', 'active_addresses': '주소 / 일',
             'balance_addresses': '주소', 'transactions': '건 / 일', 'transfers': '건 / 일',
             'market_cap': 'USD', 'realized_cap': 'USD', 'realized_price': 'USD', 'nupl': '비율',
             'blocks': '블록 / 일', 'supply': asset, 'fees_native': asset + ' / 일',
             'issuance': asset + ' / 일', 'exchange_inflow': asset + ' / 일',
             'exchange_outflow': asset + ' / 일', 'exchange_netflow': asset + ' / 일',
             'exchange_balance': asset, 'hashrate': 'GH/s' if asset in {'DASH', 'ZEC'} else 'TH/s'}
    require(metric in fixed, 'unknown-metric-unit')
    return fixed[metric]


def normalize_price(body, provider, cutoff):
    rows, seen = [], set()
    for raw in body['data']:
        require(raw.get('asset') == provider and isinstance(raw.get('time'), str), 'raw-asset-time')
        instant = dt.datetime.fromisoformat(raw['time'].replace('Z', '+00:00'))
        require(instant.utcoffset() == dt.timedelta(0), 'raw-time-not-utc')
        time_value = instant.timestamp()
        require(time_value.is_integer() and valid_day(int(time_value), cutoff) and time_value not in seen,
                'raw-day-duplicate-or-incomplete')
        seen.add(time_value)
        require('PriceUSD' in raw, 'missing-raw-price-field')
        price = raw['PriceUSD']
        if price is None:
            continue
        require(not isinstance(price, bool) and isinstance(price, (int, float, str))
                and str(price).strip(), 'raw-price-type')
        price = float(price)
        require(math.isfinite(price) and price > 0, 'raw-price-value')
        rows.append({'time': int(time_value), 'values': {'price': price}})
    return sorted(rows, key=lambda row: row['time'])


def validate_asset(folder, entry, registry, cutoff):
    """Revalidate original bytes, existing normalizer, exact baseline and every reviewed scalar."""
    asset = entry['asset']
    require(asset in registry and registry[asset].get('network'), 'asset-not-registered')
    network = registry[asset]['network']
    require(isinstance(entry['sourceFetchedAt'], int) and cutoff <= entry['sourceFetchedAt'] <= int(time.time()) + 60,
            'source-fetch-time-invalid')
    require(entry['providerAsset'] == network['id'], 'provider-asset-mismatch')
    fields = {key: value for key, value in RAW.items() if value in network['metrics']}
    require(entry['fields'] == fields and set(fields.values()) == set(network['metrics']), 'raw-field-mapping')
    raw = read_pack(folder, entry['raw'])
    require(isinstance(raw, dict) and isinstance(raw.get('data'), list)
            and len(raw['data']) <= 10000 and not raw.get('next_page_url')
            and not raw.get('next_page_token'), 'source-incomplete-or-paginated')
    require(all(valid_day(bootstrap_network.stamp(row['time']), cutoff) for row in raw['data']),
            'source-incomplete-day')
    normalized = read_pack(folder, entry['normalized'])
    require(normalized.get('asset') == asset and normalized.get('providerAsset') == network['id']
            and normalized.get('fetchedAt') == entry['sourceFetchedAt']
            and normalized.get('cutoffExclusive') == cutoff, 'normalized-identity')
    expected = (bootstrap_network.normalize(raw, asset, entry['sourceFetchedAt'])
                if len(fields) > 1 else normalize_price(raw, network['id'], cutoff))
    require(normalized.get('rows') == expected, 'normalized-raw-formula-mismatch')
    source_rows = {row['time']: row for row in expected}
    stored = read_pack(folder, entry['stored'])
    require(stored.get('asset') == asset, 'baseline-asset')
    before_ref = {row[0]: (row[1], row[2]) for row in stored['reference']}
    require(len(before_ref) == len(stored['reference']), 'baseline-reference-duplicate')
    before_network = {}
    for month in stored['networkMonths']:
        for row in month['rows']:
            require(row['time'] not in before_network, 'baseline-network-duplicate')
            before_network[row['time']] = (row, month['fetchedAt'])
    definitions = {(row['kind'], row['metric']): row for row in entry['definitions']}
    for (kind, metric), definition in definitions.items():
        require(kind in {'reference', 'network', 'network-internal-price'}, 'metric-kind')
        require(definition['unitContract'] == unit(asset, metric), 'unit-contract-mismatch')
        if kind == 'reference':
            require(metric == 'PriceUSD' and definition['rawSourceField'] == 'PriceUSD', 'reference-definition')
        elif metric in DERIVED:
            require(all(key in fields for key in DERIVED[metric]) and definition.get('derived') is True,
                    'derived-definition')
        else:
            require(metric in fields, 'unsupported-network-field')
    if 'delta' not in entry:
        return {'asset': asset, 'operations': [], 'sourceFetchedAt': entry['sourceFetchedAt'], 'sourceEntry': entry}
    delta = read_pack(folder, entry['delta'])
    require(delta.get('asset') == asset and delta.get('reviewOnly') is True
            and delta.get('sourceRawSha256') == entry['raw']['uncompressedSha256'], 'delta-identity')
    operations, seen = [], set()
    for change in delta['changes']:
        kind, metric, stamp = change['kind'], change['metric'], change['time']
        require(change['classification'] in ALLOWED and valid_day(stamp, cutoff), 'delta-class-or-date')
        require((kind, metric) in definitions and (kind, metric, stamp) not in seen, 'delta-unsupported-or-duplicate')
        seen.add((kind, metric, stamp))
        source_metric = 'price' if kind == 'reference' else metric
        source_row = source_rows.get(stamp)
        require(source_row is not None and source_metric in source_row['values'], 'delta-source-absent')
        value = source_row['values'][source_metric]
        require(valid_number(change['sourceValue']) and change['sourceValue'] == value, 'delta-source-value')
        baseline = before_ref.get(stamp) if kind == 'reference' else before_network.get(stamp)
        old = baseline[0] if kind == 'reference' and baseline else (
            baseline[0]['values'].get(metric) if baseline else None)
        old_status = baseline[0].get('statuses', {}).get(metric) if baseline and kind != 'reference' else None
        require(change.get('storedValue') == old and old != value, 'delta-baseline-value')
        if change['classification'] == 'source-only-latest-tail':
            times = list(before_ref) if kind == 'reference' else [t for t, (row, _) in before_network.items() if metric in row['values']]
            require(old is None and times and stamp > max(times), 'delta-not-latest-tail')
        else:
            require(old is not None and change.get('storedFetchedAt') == baseline[1], 'delta-not-exact-before')
        operations.append({**change, 'beforeStatus': old_status,
                           'sourceStatus': source_row.get('statuses', {}).get(source_metric)})
    return {'asset': asset, 'operations': operations, 'sourceFetchedAt': entry['sourceFetchedAt'], 'sourceEntry': entry}


def schema_sha(db):
    rows = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
    return hashlib.sha256(dumps(rows)).hexdigest()


def verify_backup(project, manifest_path, manifest_sha, proof_path, proof_sha, now):
    require(sha_file(manifest_path) == manifest_sha and sha_file(proof_path) == proof_sha, 'backup-proof-hash')
    manifest, proof = read_json(manifest_path), read_json(proof_path)
    require(manifest.get('verified') is True and proof.get('verified') is True
            and proof.get('independentRestoreVerified') is True
            and proof.get('liveDatabaseOverwritten') is False and proof.get('contentMatches') is True,
            'backup-not-independently-restored')
    require(0 <= now - manifest['completedAt'] <= 3600 and 0 <= now - proof['verifiedAt'] <= 3600,
            'backup-expired-or-future')
    require(contained(project, proof['manifestRelativePath']) == manifest_path.resolve(), 'backup-manifest-path')
    require(proof['manifestSha256'] == manifest_sha and proof['schemaSha256'] == manifest['content']['schemaSha256']
            and proof['userTableCount'] == len(manifest['content']['tables']) == 21, 'backup-schema-table-proof')
    for relative, checksum in [(proof['sourceSnapshotRelativePath'], proof['sourceSnapshotSha256']),
                               (proof['restoreRelativePath'], proof['restoredSnapshotSha256'])]:
        path = contained(project, relative)
        require(sha_file(path) == checksum, 'backup-snapshot-hash')
        db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
        try:
            require(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
                    and not db.execute('PRAGMA foreign_key_check').fetchall(), 'backup-integrity')
            require(fingerprint(db) == manifest['content'], 'backup-full-content-fingerprint')
        finally:
            db.close()
    require(proof['sourceSnapshotSha256'] == manifest['fileSha256'], 'backup-original-raw-sha')
    return manifest


def resource_guard(project):
    require(shutil.disk_usage(project).free >= SPACE_FLOOR, 'disk-below-8gib')
    meminfo = Path('/proc/meminfo')
    require(meminfo.is_file(), 'linux-memory-proof-required')
    available = next((int(line.split()[1]) * 1024 for line in meminfo.read_text().splitlines()
                      if line.startswith('MemAvailable:')), 0)
    require(available >= MEMORY_FLOOR, 'memory-below-1point5gib')
    status = Path('/proc/self/status').read_text()
    resident = next((int(line.split()[1]) * 1024 for line in status.splitlines()
                     if line.startswith('VmRSS:')), 0)
    require(resident < MEMORY_FLOOR, 'process-memory-exceeds-1point5gib')


def write_authorizer(action, table, column, database, trigger):
    if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE}:
        return sqlite3.SQLITE_OK if table in {'reference_prices', 'network_months', 'network_coverage'} else sqlite3.SQLITE_DENY
    if action in {sqlite3.SQLITE_DELETE, sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_DROP_TABLE,
                  sqlite3.SQLITE_ALTER_TABLE, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_DROP_TRIGGER,
                  sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_DROP_INDEX}:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def fsync_directory(folder):
    descriptor = os.open(folder, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_file(path, body):
    missing = []
    directory = path.parent
    while not directory.exists():
        missing.append(directory)
        directory = directory.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o700, exist_ok=True)
        # A synced file/leaf directory alone does not persist a newly created parent entry.
        fsync_directory(directory.parent)
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def seal_audit(folder, audit):
    name = audit['asset'] + '-' + uuid.uuid4().hex
    raw = dumps(audit)
    packed = gzip.compress(raw, compresslevel=6, mtime=0)
    artifact = folder / (name + '.audit.json.gz')
    require(not artifact.exists(), 'audit-already-exists')
    durable_file(artifact, packed)
    seal = {'asset': audit['asset'], 'auditFile': artifact.name,
            'gzipSha256': hashlib.sha256(packed).hexdigest(), 'rawSha256': hashlib.sha256(raw).hexdigest(),
            'reviewManifestSha256': audit['reviewManifestSha256'], 'backupManifestSha256': audit['backupManifestSha256'],
            'preparedAt': int(time.time()), 'committedNotClaimedBySealAlone': True}
    durable_file(folder / (name + '.seal.json'), dumps(seal))
    return seal


def checkpoint_state(path, resume, identities, now):
    checkpoint = {'schemaVersion': 1, **identities, 'startedAt': now, 'assets': []}
    if path and path.exists():
        require(resume, 'checkpoint-exists-use-explicit-resume')
        checkpoint = read_json(path)
        require(checkpoint.get('schemaVersion') == 1 and isinstance(checkpoint.get('assets'), list),
                'resume-checkpoint-schema')
        require(all(checkpoint.get(key) == value for key, value in identities.items()), 'resume-identity-mismatch')
    elif resume:
        raise ReconcileError('resume-checkpoint-missing')
    return checkpoint


def bucket(stamp):
    day = dt.datetime.fromtimestamp(stamp, dt.timezone.utc)
    return int(day.replace(day=1).timestamp())


def apply_asset(db, validated, cutoff, execute=False, audit_dir=None, identities=None):
    """CAS inside one short asset transaction. All other values and ingestion are untouched."""
    asset = validated['asset']
    if not validated['operations']:
        return {'asset': asset, 'changed': 0, 'alreadyNew': 0, 'emptyDelta': True}
    db.set_authorizer(write_authorizer)
    started = time.monotonic()
    db.execute('BEGIN IMMEDIATE' if execute else 'BEGIN')
    try:
        months = {}
        for b, payload, fetched in db.execute('SELECT bucket,payload,fetched_at FROM network_months WHERE asset=? ORDER BY bucket', (asset,)):
            rows = json.loads(payload, object_pairs_hook=object_pairs)
            require(isinstance(rows, list) and len(rows) <= 31, 'stored-month-size')
            require(all(valid_day(r['time'], 4102444800) and bucket(r['time']) == b for r in rows), 'stored-month-day')
            by_day = {row['time']: row for row in rows}
            require(len(by_day) == len(rows), 'stored-month-duplicate')
            months[b] = {'beforePayload': payload, 'beforeFetchedAt': fetched, 'rows': by_day, 'changed': False}
        require(len(months) <= 601, 'stored-months-limit')
        references, operations, already, changed = [], [], 0, 0
        for operation in validated['operations']:
            stamp, metric, source = operation['time'], operation['metric'], operation['sourceValue']
            require(valid_day(stamp, cutoff) and valid_number(source), 'invalid-reviewed-operation')
            if operation['kind'] == 'reference':
                before = db.execute('SELECT value,fetched_at FROM reference_prices WHERE asset=? AND time=?', (asset, stamp)).fetchone()
                old = before[0] if before else None
                current_status = None
            else:
                b = bucket(stamp)
                month = months.setdefault(b, {'beforePayload': None, 'beforeFetchedAt': None, 'rows': {}, 'changed': False})
                row = month['rows'].get(stamp)
                old = row.get('values', {}).get(metric) if row else None
                current_status = row.get('statuses', {}).get(metric) if row else None
                before = {'value': old, 'status': current_status, 'monthFetchedAt': month['beforeFetchedAt']}
            if old == source:
                already += 1
                continue
            require(old == operation['storedValue'], 'cas-value-conflict:' + asset + ':' + metric + ':' + str(stamp))
            require(current_status == operation['beforeStatus'], 'cas-status-conflict:' + asset + ':' + metric)
            operations.append({**operation, 'actualBefore': before})
            changed += 1
            if operation['kind'] == 'reference':
                references.append({'time': stamp, 'before': before, 'afterValue': source,
                                   'afterFetchedAt': max(before[1] if before else 0, validated['sourceFetchedAt'])})
            else:
                row = month['rows'].setdefault(stamp, {'time': stamp, 'values': {}})
                row['values'][metric] = source
                if operation['sourceStatus'] is not None:
                    row.setdefault('statuses', {})[metric] = operation['sourceStatus']
                month['changed'] = True
        changed_months = []
        for b, month in months.items():
            if month['changed']:
                payload = dumps([row for _, row in sorted(month['rows'].items())]).decode()
                changed_months.append({'bucket': b, 'beforePayload': month['beforePayload'],
                                       'beforeFetchedAt': month['beforeFetchedAt'], 'afterPayload': payload,
                                       'afterFetchedAt': max(month['beforeFetchedAt'] or 0, validated['sourceFetchedAt'])})
        coverage = {}
        if changed_months:
            for month in months.values():
                for row in month['rows'].values():
                    for metric, value in row['values'].items():
                        require(valid_number(value), 'stored-network-value')
                        unit(asset, metric)
                        c = coverage.setdefault(metric, [row['time'], row['time'], 0])
                        c[0] = min(c[0], row['time']); c[1] = max(c[1], row['time']); c[2] += 1
        prior_coverage = {r[0]: r[1:] for r in db.execute('SELECT metric,first,last,observations,fetched_at FROM network_coverage WHERE asset=?', (asset,))}
        for metric, (first, last, observations) in coverage.items():
            prior = prior_coverage.get(metric)
            require(prior is None or (prior[0] == first and prior[1] <= last and prior[2] <= observations),
                    'coverage-would-regress-first-or-count')
        require(not coverage or all(metric in coverage for metric in prior_coverage), 'coverage-would-remove-metric')
        if not execute:
            db.rollback()
            return {'asset': asset, 'changed': changed, 'alreadyNew': already,
                    'networkMonths': len(changed_months), 'references': len(references), 'dryRun': True}
        require(audit_dir is not None and identities is not None, 'execution-needs-audit-and-identities')
        if not changed:
            db.rollback()
            return {'asset': asset, 'changed': 0, 'alreadyNew': already, 'replayed': True}
        audit = {'schemaVersion': 1, 'asset': asset, **identities, 'sourceFetchedAt': validated['sourceFetchedAt'],
                 'sourceRawSha256': validated['sourceEntry']['raw']['uncompressedSha256'],
                 'normalizedSha256': validated['sourceEntry']['normalized']['uncompressedSha256'],
                 'operations': operations, 'references': references, 'networkMonths': changed_months,
                 'networkCoverageBefore': prior_coverage, 'networkCoverageAfter': coverage,
                 'ingestionChanged': False, 'sourceMissingDeleted': False}
        seal = seal_audit(audit_dir, audit)
        for reference in references:
            db.execute('INSERT INTO reference_prices(asset,time,value,fetched_at) VALUES(?,?,?,?) ON CONFLICT(asset,time) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at',
                       (asset, reference['time'], reference['afterValue'], reference['afterFetchedAt']))
        for month in changed_months:
            db.execute('INSERT INTO network_months(asset,bucket,payload,fetched_at) VALUES(?,?,?,?) ON CONFLICT(asset,bucket) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at',
                       (asset, month['bucket'], month['afterPayload'], month['afterFetchedAt']))
        for metric, (first, last, observations) in coverage.items():
            prior = prior_coverage.get(metric)
            if prior and tuple(prior[:3]) == (first, last, observations):
                continue
            db.execute('INSERT INTO network_coverage(asset,metric,first,last,observations,fetched_at) VALUES(?,?,?,?,?,?) ON CONFLICT(asset,metric) DO UPDATE SET first=excluded.first,last=excluded.last,observations=excluded.observations,fetched_at=excluded.fetched_at',
                       (asset, metric, first, last, observations, max(prior[3] if prior else 0, validated['sourceFetchedAt'])))
        require(time.monotonic() - started <= 10, 'asset-transaction-exceeded-10seconds')
        db.commit()
        return {'asset': asset, 'changed': changed, 'alreadyNew': already,
                'networkMonths': len(changed_months), 'references': len(references), 'auditSeal': seal}
    except BaseException:
        db.rollback()
        raise


def run(args):
    now = int(time.time())
    project = args.project_root.resolve(strict=True)
    database = args.database.resolve(strict=True)
    require(database.is_relative_to(project) and database.is_file(), 'database-outside-project')
    resource_guard(project)
    require(sha_file(args.review_manifest) == args.review_sha256, 'review-manifest-hash')
    review = read_json(args.review_manifest)
    require(review.get('schemaVersion') == 1 and review.get('reviewOnly') is True
            and review.get('provider') == 'Coin Metrics Community', 'review-schema-provider')
    require(sha_file(args.registry) == review['registrySha256']
            and sha_file(Path(bootstrap_network.__file__)) == review['normalizerSha256']
            and sha_file(args.unit_catalog) == review['unitCatalogSha256'], 'registry-normalizer-unit-hash')
    registry_body = read_json(args.registry)
    require(registry_body == registry_module.REGISTRY, 'normalizer-registry-disagreement')
    registry = {row['id']: row for row in registry_body['assets']}
    expected = {asset for asset, row in registry.items() if row.get('network') and 'PriceUSD' in row['network']['metrics']}
    require(len(registry) == 150 and len(expected) == review['expectedSourceAssets'] == 143
            and len(review['assets']) == 143 and {r['asset'] for r in review['assets']} == expected,
            'full-source-registry-incomplete')
    require(sum(len(entry['definitions']) for entry in review['assets']) == review['expectedStoredSeries'] == 585,
            'stored-series-definition-count')
    require(sum(len(row['network']['metrics']) for row in registry.values() if row.get('network'))
            == review['expectedRawFields'] == 450, 'raw-support-count')
    cutoff = review['cutoffExclusive']
    require(valid_day(cutoff, now // DAY * DAY + DAY) and cutoff <= now // DAY * DAY,
            'review-cutoff-not-confirmed')
    folder = args.source_dir.resolve(strict=True)
    source_paths = {contained(folder, entry[kind]['file']) for entry in review['assets']
                    for kind in ['raw', 'normalized', 'stored', 'delta'] if kind in entry}
    require(sum(path.stat().st_size for path in source_paths) <= 50 * 1024**2, 'source-packs-exceed-50mib')
    # Revalidate every source and baseline before opening a writable live connection.
    validated = [validate_asset(folder, entry, registry, cutoff) for entry in review['assets']]
    require(sum(len(item['operations']) for item in validated) == review['expectedReviewedOperations'],
            'review-operation-count')
    backup = verify_backup(project, args.backup_manifest, args.backup_manifest_sha256,
                           args.backup_restore_proof, args.backup_restore_proof_sha256, now)
    resource_guard(project)
    if args.execute_reviewed_delta:
        require(os.name == 'posix', 'execute-linux-only')
        require(project == Path('/srv/services/coin-desk')
                and database == project / 'shared/data/coin-desk.sqlite', 'execute-live-project-path')
        require(args.audit_dir is not None and args.checkpoint is not None, 'execute-audit-checkpoint-required')
        for output in [args.audit_dir, args.checkpoint]:
            require(output.resolve().is_relative_to(project) and not output.is_symlink(), 'output-outside-project')
    identities = {'reviewManifestSha256': args.review_sha256, 'backupManifestSha256': args.backup_manifest_sha256,
                  'backupRestoreProofSha256': args.backup_restore_proof_sha256}
    checkpoint = checkpoint_state(args.checkpoint, args.resume, identities, now)
    db = sqlite3.connect(database.as_uri() + ('?mode=rw' if args.execute_reviewed_delta else '?mode=ro'), uri=True, timeout=1)
    report = {'dryRun': not args.execute_reviewed_delta, **identities, 'assets': [],
              'scope': 'Coin Metrics only; excludes Bitview, mempool, dominance and exchange OHLCV',
              'schemaChanged': False, 'ingestionChanged': False, 'sourceMissingDeleted': False}
    try:
        db.execute('PRAGMA foreign_keys=ON')
        require(schema_sha(db) == backup['content']['schemaSha256'], 'live-schema-differs-from-backup')
        for item in validated:
            resource_guard(project)
            require(int(time.time()) - backup['completedAt'] <= 3600, 'backup-expired-during-apply')
            # Checkpoint entries do not bypass CAS: a replay must still match the new source values.
            fresh = validate_asset(folder, item['sourceEntry'], registry, cutoff)
            result = apply_asset(db, fresh, cutoff, args.execute_reviewed_delta, args.audit_dir, identities)
            report['assets'].append(result)
            if args.execute_reviewed_delta:
                checkpoint['assets'].append(result)
                checkpoint['updatedAt'] = int(time.time())
                durable_file(args.checkpoint, dumps(checkpoint))
        report['changed'] = sum(item['changed'] for item in report['assets'])
        report['alreadyNew'] = sum(item.get('alreadyNew', 0) for item in report['assets'])
        report['complete'] = True
        return report
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['project-root', 'database', 'source-dir', 'registry', 'unit-catalog', 'review-manifest',
                 'backup-manifest', 'backup-restore-proof']:
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ['review-sha256', 'backup-manifest-sha256', 'backup-restore-proof-sha256']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--execute-reviewed-delta', action='store_true')
    parser.add_argument('--audit-dir', type=Path)
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    try:
        for value in [args.review_sha256, args.backup_manifest_sha256, args.backup_restore_proof_sha256]:
            require(re.fullmatch('[a-f0-9]{64}', value), 'invalid-sha256-input')
        print(json.dumps(run(args), ensure_ascii=False))
    except Exception as error:
        code = str(error) if isinstance(error, ReconcileError) else type(error).__name__
        print(json.dumps({'complete': False, 'failureCode': code, 'noAutomaticRetry': True}), flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
