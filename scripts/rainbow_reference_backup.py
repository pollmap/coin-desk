"""Bounded, immutable Original date-map backup. No database, network or source-price reads."""
import datetime, hashlib, json, os, pathlib, re, shutil, tempfile

MAX_BYTES = 64 * 1024**2
FORMULA_HASH = 'ceeeec89e244ac085be1e95e967a8674f2186d300655125668db862a46d1783a'
SCRIPT_HASH = '1d734930a9b59ff0471179f10df1ae4f3569e759a39c8abd2369fa953c8b3cb9'
VERSION = re.compile(r'bc-original-[a-f0-9]{12}-[a-f0-9]{12}')
HASH = re.compile(r'[a-f0-9]{64}')
SNAPSHOT = re.compile(r'snapshot-([a-f0-9]{64})\.json')

def require(value, message):
    if not value: raise ValueError('Original metadata: ' + message)

def checksum(body): return hashlib.sha256(body).hexdigest()

def same_content(actual, expected):
    # Compatibility is derived from the restoring release, not immutable backup content.
    # An old snapshot is still preserved when a newer release cannot execute its model.
    return {k: v for k, v in actual.items() if k != 'compatibility'} == {k: v for k, v in expected.items() if k != 'compatibility'}

def regular_bytes(path, maximum):
    require(path.is_file() and not path.is_symlink(), 'regular nonsymlink file required')
    require(path.stat().st_size <= maximum, 'file size limit')
    body = path.read_bytes()
    require(len(body) <= maximum, 'file grew beyond limit')
    return body

def validate_snapshot(body, snapshot_id):
    value = json.loads(body)
    require(value.get('schemaVersion') == 1 and isinstance(value.get('modelVersion'), str) and
            VERSION.fullmatch(value['modelVersion']), 'snapshot model version')
    for key in ['snapshotId', 'formulaHash', 'sourceScriptHash']:
        require(isinstance(value.get(key), str) and HASH.fullmatch(value[key]), 'snapshot hash')
    require(value['snapshotId'] == snapshot_id and
            value['modelVersion'].startswith('bc-original-' + value['formulaHash'][:12] + '-'), 'snapshot identity')
    dates = value.get('dates')
    require(isinstance(dates, list) and 730 <= len(dates) <= 12000 and dates[0] == '2012-01-01', 'date count/start')
    require(type(value.get('verifiedAt')) is int and 0 <= value['verifiedAt'] <= 253402214400, 'verification time')
    last_day = datetime.datetime.fromtimestamp(value['verifiedAt'], datetime.timezone.utc).date().isoformat()
    previous = ''
    for date in dates:
        require(isinstance(date, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date), 'date format')
        require(datetime.date.fromisoformat(date).isoformat() == date and previous < date <= last_day, 'date order/cutoff')
        previous = date
    require(checksum('\n'.join(dates).encode()) == snapshot_id, 'date content hash')
    return value

def inventory(directory):
    """Capture one atomic index and all immutable snapshots, including older append snapshots."""
    directory = pathlib.Path(directory)
    if not directory.exists():
        require(not directory.is_symlink(), 'dangling directory symlink')
        return {'schemaVersion': 1, 'state': 'absent', 'files': {}, 'totalBytes': 0,
                'latestModelVersion': None, 'latestSnapshotId': None, 'versions': {},
                'snapshotCount': 0, 'compatibility': 'bundled_reference_only'}, {}
    require(directory.is_dir() and not directory.is_symlink(), 'nonsymlink directory required')
    entries = list(directory.iterdir())
    require(len(entries) <= 1100, 'file count limit')
    bodies, snapshots, total = {}, {}, 0
    # The index is atomic; immutable files referenced by it are already durable.
    selected = sorted(p for p in entries if p.name in ['index.json', 'status.json'] or SNAPSHOT.fullmatch(p.name))
    for path in selected:
        maximum = 65536 if path.name == 'index.json' else 8192 if path.name == 'status.json' else 262144
        body = regular_bytes(path, maximum)
        total += len(body); require(total <= MAX_BYTES, 'total byte limit')
        bodies[path.name] = body
        match = SNAPSHOT.fullmatch(path.name)
        if match: snapshots[match[1]] = validate_snapshot(body, match[1])
    require(len(snapshots) <= 1024, 'snapshot count limit')
    versions, latest = {}, None
    if 'index.json' in bodies:
        index = json.loads(bodies['index.json'])
        versions, latest = index.get('versions'), index.get('latest')
        require(index.get('schemaVersion') == 1 and isinstance(versions, dict) and 1 <= len(versions) <= 64 and
                isinstance(latest, str) and latest in versions, 'index structure')
        for version, snapshot_id in versions.items():
            require(VERSION.fullmatch(version) and isinstance(snapshot_id, str) and HASH.fullmatch(snapshot_id), 'index identity')
            require(snapshot_id in snapshots and snapshots[snapshot_id]['modelVersion'] == version, 'index snapshot binding')
        state = 'verified'
    else: state = 'unindexed_snapshots' if snapshots else 'bundled_reference_only'
    if 'status.json' in bodies:
        status = json.loads(bodies['status.json'])
        require(isinstance(status, dict) and set(status) <= {'lastAttempt', 'lastVerifiedAt', 'snapshotId', 'code'}, 'status fields')
        require(all(type(status[k]) is int and status[k] >= 0 for k in ['lastAttempt', 'lastVerifiedAt'] if k in status), 'status time')
        require('code' not in status or re.fullmatch(r'(?:ok|original_reference_[a-z_]+)', str(status['code'])), 'status code')
        require('snapshotId' not in status or HASH.fullmatch(str(status['snapshotId'])), 'status snapshot')
    current = snapshots[versions[latest]] if latest else None
    compatible = current and current['formulaHash'] == FORMULA_HASH and current['sourceScriptHash'] == SCRIPT_HASH
    report = {'schemaVersion': 1, 'state': state,
        'files': {name: {'bytes': len(body), 'sha256': checksum(body)} for name, body in bodies.items()},
        'totalBytes': total, 'latestModelVersion': latest, 'latestSnapshotId': versions.get(latest),
        'versions': versions, 'snapshotCount': len(snapshots),
        'compatibility': 'supported' if compatible else 'stored_model_not_supported_by_current_release' if current else 'bundled_reference_only'}
    return report, bodies

def copy_for_backup(source, destination):
    report, bodies = inventory(source)
    if report['state'] == 'absent': return report
    destination = pathlib.Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'new backup directory required')
    destination.mkdir(mode=0o700)
    for name, body in bodies.items():
        path = destination/name
        with path.open('xb') as stream: stream.write(body); stream.flush(); os.fsync(stream.fileno())
        path.chmod(0o600)
    actual, _ = inventory(destination)
    require(actual == report, 'copied inventory differs')
    return report

def verify_backup(directory, expected):
    require(isinstance(expected, dict) and expected.get('schemaVersion') == 1, 'manifest version')
    actual, bodies = inventory(directory)
    require(same_content(actual, expected), 'backup inventory/checksum mismatch')
    return bodies

def restore_metadata(source, destination, expected):
    bodies = verify_backup(source, expected)
    destination = pathlib.Path(destination)
    if expected['state'] == 'absent':
        return {'state': 'absent', 'restored': False, 'compatibility': 'bundled_reference_only'}
    if destination.exists() or destination.is_symlink():
        actual, _ = inventory(destination)
        require(same_content(actual, expected), 'existing destination differs; use a new isolated restore folder')
        return {'state': expected['state'], 'restored': False, 'reusedMatchingDestination': True,
                'compatibility': actual['compatibility']}
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = pathlib.Path(tempfile.mkdtemp(prefix='.rainbow-restore-', dir=destination.parent))
    try:
        for name, body in bodies.items():
            with (stage/name).open('xb') as stream: stream.write(body); stream.flush(); os.fsync(stream.fileno())
            (stage/name).chmod(0o600)
        actual, _ = inventory(stage); require(same_content(actual, expected), 'restored inventory differs')
        require(not destination.exists() and not destination.is_symlink(), 'destination appeared during restore')
        # Rename only a newly created, fully verified directory; never replace live metadata.
        os.rename(stage, destination)
    finally:
        if stage.exists(): shutil.rmtree(stage)
    return {'state': expected['state'], 'restored': True, 'files': len(bodies),
            'latestModelVersion': expected['latestModelVersion'], 'compatibility': actual['compatibility']}
