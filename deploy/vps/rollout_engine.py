"""Selective VPS rollout engine, promoted from the verified 0.32/0.35 operator.

Run only on the owned VPS after final main CI and artifact SHA verification.
Base image/release, protected collectors, schema, volumes and other projects stay fixed.
Raw subprocess output and resolved Compose configuration stay in private audit files.
"""

import hashlib
import json
import os
import pathlib
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request


ROOT = pathlib.Path('/srv/services/coin-desk')
AUDIT = ROOT / 'audit/unconfigured'
OLD = ROOT / 'releases/unconfigured'
CHANGED = []
SERVICES = ['api', 'quotes', 'background', 'recent', 'analysis', 'backup', 'quote-hub', 'migrate']
PROTECTED = SERVICES[:]
RESERVE = 2 * 1024 ** 3
HISTORY_GUARD = 8 * 1024 ** 3
SHADOW_API = 'coin-desk-api-032-check'
SHADOW_HUB = 'coin-desk-hub-032-check'
SHADOW_NETWORK = 'coin-desk-ux-032-check'
API_PORT, HUB_PORT = 18432, 18433


def require(condition, message):
    if not condition:
        raise ValueError(message)


def require_hashrate_unit(payload, asset):
    meta = payload.get('meta') if isinstance(payload, dict) else None
    require(isinstance(meta, dict) and meta.get('unit') == 'GH/s',
            'Candidate hashrate unit mismatch: ' + asset)


def require_core_progress(before, after, now):
    old = {row[0]: row[1] for row in before['quotes']}
    require(len(old) == 6 and len(after['quotes']) == 6 and
            {row[0] for row in after['quotes']} == set(old) and
            all(row[1] > old[row[0]] for row in after['quotes']),
            'All six core natural confirmations must advance')
    require(all(isinstance(row[2], (int, float)) and now - 300 <= row[2] <= now + 60
                for row in after['quotes']), 'Core trade observations are not fresh')
    require(len(after['proof']) == 3 and len({row[0] for row in after['proof']}) == 3 and all(
        row[1] == 'trade' and isinstance(row[2], int) and row[2] == row[3]
        and now - 300 <= row[2] <= now + 60 and isinstance(row[4], int)
        for row in after['proof']), 'Natural core quote timestamps not yet proven')


def require_restored_image(before, restored, service):
    require(restored['Image'] == before['Image'] and
            restored['Config']['Image'] == before['Config']['Image'],
            'Rollback image differs from live baseline: ' + service)


def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name('.' + path.name + '.next')
    with open(temporary, 'w', encoding='utf-8') as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class Deployment:
    def __init__(self, commit):
        require(re.fullmatch('[a-f0-9]{40}', commit), 'Expected full main commit')
        require(ROOT.resolve() == ROOT and AUDIT.parent == ROOT / 'audit' and AUDIT.resolve() == AUDIT,
                'Owned, nonsymlink paths required')
        self.commit = commit
        self.manifest = json.loads((AUDIT / 'deployment.json').read_text())
        require(self.manifest.get('commit') == commit, 'Artifact commit mismatch')
        require(self.manifest.get('containsPrivateData') is False, 'Private-free artifact required')
        self.release = self.manifest['release']
        require(re.fullmatch('vps-[a-f0-9]{16}', self.release), 'Invalid release')
        require(self.release != OLD.name, 'New release required')
        self.new = ROOT / 'releases' / self.release
        self.image = 'coin-desk:' + self.release
        self.oldenv = ROOT / 'shared/secrets' / (OLD.name + '.env')
        self.newenv = ROOT / 'shared/secrets' / (self.release + '.env')
        self.report_path = AUDIT / 'prepare.json'
        self.report = json.loads(self.report_path.read_text()) if self.report_path.exists() else {
            'commit': commit, 'release': self.release, 'previousRelease': OLD.name,
            'changedServices': CHANGED, 'schemaChanged': False, 'capacitySamples': [],
            'capacityMode': 'Measured immutable CI image replacement; no VPS build',
            'historyGuardBytes': HISTORY_GUARD, 'general8GiBPreflightPassed': False,
        }
        require(self.report['commit'] == commit and self.report['release'] == self.release,
                'Preparation belongs to another artifact')
        self.command_count = 0

    def persist(self):
        private_json(self.report_path, self.report)

    def run(self, args, timeout=180, input_bytes=None):
        self.command_count += 1
        result = subprocess.run(args, input=input_bytes, capture_output=True, timeout=timeout)
        name = f'command-{int(time.time())}-{os.getpid()}-{self.command_count}.log'
        path = AUDIT / 'private-logs' / name
        path.parent.mkdir(exist_ok=True, mode=0o700)
        with open(path, 'xb') as output:
            os.chmod(path, 0o600)
            output.write(result.stdout + b'\n' + result.stderr)
        require(result.returncode == 0, 'Command failed; inspect private bounded log')
        return result.stdout

    def capacity(self, label, remaining=0, memory_required=1536 * 1024 ** 2):
        disk = shutil.disk_usage(ROOT)
        memory = {line.split(':')[0]: int(line.split()[1]) * 1024
                  for line in pathlib.Path('/proc/meminfo').read_text().splitlines()}
        self.report['capacitySamples'].append({
            'phase': label, 'at': int(time.time()), 'freeBytes': disk.free,
            'estimatedRemainingBytes': remaining, 'reserveBytes': RESERVE,
            'memoryAvailableBytes': memory['MemAvailable'],
            'historyAllowedByCapacity': disk.free >= HISTORY_GUARD,
        })
        self.persist()
        require(disk.free > remaining + RESERVE, 'Insufficient measured deployment disk reserve')
        require(memory['MemAvailable'] > memory_required, 'Insufficient bounded rehearsal memory')

    def config(self, folder, env):
        return ['docker', 'compose', '--env-file', str(env), '-f',
                str(folder / 'deploy/vps/compose.yaml'), '--profile', 'collectors']

    def containers(self):
        return {name: json.loads(self.run(['docker', 'inspect', '--format', '{{json .}}',
                                         'coin-desk-' + name + '-1'])) for name in SERVICES}

    def request(self, path, port=API_PORT, timeout=15):
        with urllib.request.urlopen('http://127.0.0.1:' + str(port) + path, timeout=timeout) as response:
            body = response.read(2 * 1024 ** 2 + 1)
            require(len(body) <= 2 * 1024 ** 2, 'Rehearsal response too large')
            return json.loads(body)

    def assert_current(self):
        require((ROOT / 'current').resolve() == OLD, 'Current release changed; re-audit first')
        require(self.oldenv.is_file() and not self.oldenv.is_symlink(), 'Previous private env missing')

    def write_environment(self):
        overrides = {
            'COIN_DESK_API_IMAGE': self.image, 'COIN_DESK_API_RELEASE': self.release,
            'COIN_DESK_HUB_IMAGE': self.image,
            'COIN_DESK_QUOTES_IMAGE': self.image, 'COIN_DESK_QUOTES_RELEASE': self.release,
            'COIN_DESK_BACKGROUND_IMAGE': self.image,
            'COIN_DESK_BACKGROUND_RELEASE': self.release,
        }
        original = self.oldenv.read_text()
        lines = [line for line in original.splitlines() if line.split('=', 1)[0] not in overrides]
        content = '\n'.join(lines + [key + '=' + value for key, value in overrides.items()]) + '\n'
        if self.newenv.exists():
            require(not self.newenv.is_symlink() and self.newenv.read_text() == content,
                    'Candidate env differs from reviewed overrides')
        else:
            descriptor = os.open(self.newenv, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as output:
                output.write(content)

    def validate_configs(self, before):
        previous = json.loads(self.run(self.config(OLD, self.oldenv) + ['config', '--format', 'json']))
        candidate = json.loads(self.run(self.config(self.new, self.newenv) + ['config', '--format', 'json']))
        private_json(AUDIT / 'private-logs/previous-compose.json', previous)
        private_json(AUDIT / 'private-logs/candidate-compose.json', candidate)
        require(previous['name'] == candidate['name'] == 'coin-desk', 'Compose project mismatch')
        require(previous['services'].keys() == candidate['services'].keys(), 'Service set changed')
        require(previous.get('networks') == candidate.get('networks'), 'Network configuration changed')
        for name, prior in previous['services'].items():
            next_config = candidate['services'][name]
            if name not in CHANGED:
                require(prior == next_config, 'Protected service configuration changed: ' + name)
            else:
                allowed_env = {'COIN_DESK_RELEASE'} if name != 'quote-hub' else set()
                if name == 'quotes':
                    allowed_env.add('COIN_DESK_QUOTE_HUB')
                require(set(prior) == set(next_config), 'Service fields changed: ' + name)
                for field, value in prior.items():
                    if field not in ['image', 'environment']:
                        require(value == next_config[field], 'Service containment changed: ' + name)
                old_env, next_env = prior.get('environment', {}), next_config.get('environment', {})
                require({k: v for k, v in old_env.items() if k not in allowed_env} ==
                        {k: v for k, v in next_env.items() if k not in allowed_env},
                        'Unapproved service environment change: ' + name)
                require(next_config['image'] == self.image, 'Changed service image mismatch')
                if name != 'quote-hub':
                    require(next_env['COIN_DESK_RELEASE'] == self.release, 'Service release mismatch')
            # The completed migrate container is intentionally older than current Compose.
            # Keep its identity; never restart it just to match the current base image.
            if name in before and name in CHANGED:
                require(prior['image'] == before[name]['Config']['Image'],
                        'Previous config differs from live image: ' + name)
        require(candidate['services']['quotes']['environment']['COIN_DESK_QUOTE_HUB'] ==
                'http://quote-hub:8091', 'Quote proof hub must remain private')
        self.report['protectedConfigsVerified'] = PROTECTED
        self.report['protectedContainerIdsBefore'] = {name: before[name]['Id'][:12] for name in PROTECTED}
        self.report['protectedHistoricalImagesObserved'] = {
            name: before[name]['Config']['Image'] for name in PROTECTED
        }
        self.persist()

    def source_and_image(self):
        for field, sha_field in [('sourceArchive', 'sourceArchiveSha256'),
                                 ('imageArchive', 'imageArchiveSha256')]:
            name = self.manifest[field]
            require(pathlib.Path(name).name == name and not (AUDIT / name).is_symlink(),
                    'Unsafe artifact name')
            require(digest(AUDIT / name) == self.manifest[sha_field], 'Artifact SHA mismatch')
        require(self.manifest['imageBytes'] == (AUDIT / self.manifest['imageArchive']).stat().st_size,
                'Image byte count mismatch')
        with tarfile.open(AUDIT / self.manifest['sourceArchive'], 'r:gz') as archive:
            members = archive.getmembers()
            require(len({entry.name for entry in members}) == len(members), 'Duplicate source member')
            for entry in members:
                path = pathlib.PurePosixPath(entry.name)
                require(entry.isfile() and not path.is_absolute() and '..' not in path.parts,
                        'Unsafe source member')
            source_bytes = sum(entry.size for entry in members)
        with tarfile.open(AUDIT / self.manifest['imageArchive'], 'r:gz') as archive:
            rows = json.load(archive.extractfile('manifest.json'))
            require(len(rows) == 1 and rows[0]['RepoTags'] == [self.manifest['imageTag']],
                    'Image export mismatch')
            row = rows[0]
            require(re.fullmatch('blobs/sha256/[a-f0-9]{64}', row['Config']), 'Invalid image config path')
            config_body = archive.extractfile(row['Config']).read()
            cfg = json.loads(config_body)
            config_id = 'sha256:' + hashlib.sha256(config_body).hexdigest()
            require(row['Config'] == 'blobs/sha256/' + config_id.split(':')[1], 'Config hash mismatch')
            index = json.load(archive.extractfile('index.json'))
            require(len(index['manifests']) == 1, 'Unexpected image count')
            oci_id = index['manifests'][0]['digest']
            require(re.fullmatch('sha256:[a-f0-9]{64}', oci_id), 'Invalid OCI descriptor')
            oci_body = archive.extractfile('blobs/sha256/' + oci_id.split(':')[1]).read()
            require('sha256:' + hashlib.sha256(oci_body).hexdigest() == oci_id, 'OCI hash mismatch')
            oci = json.loads(oci_body)
            require(oci['config']['digest'] == config_id, 'OCI config mismatch')
            require([layer['digest'] for layer in oci['layers']] == cfg['rootfs']['diff_ids'],
                    'Layer chain mismatch')
            require(cfg['os'] == 'linux' and cfg['architecture'] == 'amd64', 'Wrong image platform')
            require(self.manifest['imageId'] in [config_id, oci_id], 'CI image ID mismatch')
            image_bytes = sum(member.size for member in archive.getmembers())
        database_bytes = (ROOT / 'shared/data/coin-desk.sqlite').stat().st_size
        remaining = image_bytes + source_bytes + database_bytes * 3 + 256 * 1024 ** 2
        self.report['deploymentBudget'] = {
            'uploadedImageBytes': self.manifest['imageBytes'],
            'uploadedSourceBytes': (AUDIT / self.manifest['sourceArchive']).stat().st_size,
            'imageExportUncompressedBytes': image_bytes, 'sourceUncompressedBytes': source_bytes,
            'databaseBytes': database_bytes, 'backupRestoreAllowanceBytes': database_bytes * 3,
            'temporaryAssetsOverlayAllowanceBytes': 256 * 1024 ** 2,
            'additionalBytesBeforeLoad': remaining, 'reserveBytes': RESERVE,
        }
        self.capacity('before source extraction/image load; uploaded archives already counted', remaining)
        require(not self.new.exists(), 'Candidate source directory already exists; inspect before retry')
        self.new.mkdir()
        with tarfile.open(AUDIT / self.manifest['sourceArchive'], 'r:gz') as archive:
            archive.extractall(self.new, filter='data')
        source = json.loads((self.new / 'release-manifest.json').read_text())
        require(source['release'] == self.release and source['containsPrivateData'] is False,
                'Source release mismatch')
        for name, sha in source['files'].items():
            path = pathlib.PurePosixPath(name)
            require(not path.is_absolute() and '..' not in path.parts and digest(self.new / name) == sha,
                    'Source file checksum mismatch')
        prior = json.loads((OLD / 'release-manifest.json').read_text())
        require({k: v for k, v in source['files'].items() if k.startswith('migrations/')} ==
                {k: v for k, v in prior['files'].items() if k.startswith('migrations/')},
                'Schema/migration change requires a different reviewed procedure')
        self.run(['docker', 'load', '-i', str(AUDIT / self.manifest['imageArchive'])], timeout=300)
        loaded = json.loads(self.run(['docker', 'image', 'inspect', self.manifest['imageTag']]))[0]
        require(loaded['Id'] in [config_id, oci_id] and loaded['RootFS']['Layers'] == cfg['rootfs']['diff_ids']
                and loaded['Os'] == 'linux' and loaded['Architecture'] == 'amd64',
                'Loaded image differs from verified CI image')
        self.run(['docker', 'tag', self.manifest['imageTag'], self.image])
        self.report['imagePortability'] = {
            'ciConfigId': config_id, 'ociManifestId': oci_id, 'loadedId': loaded['Id'],
            'verifiedIds': [config_id, oci_id], 'layerChainVerified': True, 'platformVerified': True,
        }
        self.report['sourceFilesVerified'] = len(source['files'])
        self.capacity('after verified image load', database_bytes * 3 + 256 * 1024 ** 2)

    def backup_and_restore(self):
        sys.path.insert(0, str(self.new / 'scripts'))
        from vps_backup import backup, restore
        require(not (AUDIT / 'backups').exists(), 'Audit backup already exists; inspect before retry')
        saved = backup(ROOT / 'shared/data/coin-desk.sqlite', AUDIT / 'backups',
                       AUDIT / 'backup-status.json', budget_bytes=512 * 1024 ** 2)
        snapshots = list((AUDIT / 'backups').glob('*/snapshot.sqlite'))
        require(len(snapshots) == 1, 'Exactly one new verified audit backup required')
        clone = AUDIT / 'rehearsal.sqlite'
        restore(snapshots[0], clone, snapshots[0].parent / 'manifest.json')
        db = sqlite3.connect(clone)
        try:
            require(db.execute('PRAGMA journal_mode=DELETE').fetchone()[0] == 'delete',
                    'Read-only rehearsal journal conversion failed')
        finally:
            db.close()
        os.chown(clone, 10001, 10001)
        os.chmod(clone, 0o640)
        # A new directory contains only this audit snapshot; no product backup retention/prune is run.
        self.report.update(backupVerified=saved['verified'], backupCompletedAt=saved['completedAt'],
                           backupFileSha256=saved['fileSha256'])
        self.capacity('after online backup and independent restore')

    def retain_assets(self):
        producer = subprocess.Popen(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                                     '--entrypoint', 'tar', 'coin-desk:' + OLD.name,
                                     '-C', '/app/dist/assets', '-cf', '-', '.'], stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE)
        try:
            result = subprocess.run(['python3', str(self.new / 'deploy/vps/retain_assets.py'),
                                     str(ROOT / 'shared/assets')], stdin=producer.stdout,
                                    capture_output=True, timeout=90)
            producer.stdout.close()
            require(producer.wait(timeout=15) == 0 and result.returncode == 0,
                    'Prior immutable asset retention failed')
        finally:
            if producer.poll() is None:
                producer.kill()
                producer.wait()
        self.report['previousStaticAssetsRetained'] = True
        with open(AUDIT / 'canonical-dist.tar', 'xb') as output:
            os.chmod(AUDIT / 'canonical-dist.tar', 0o600)
            result = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                                     '--entrypoint', 'tar', self.image, '-C', '/app', '-cf', '-', 'dist'],
                                    stdout=output, stderr=subprocess.PIPE, timeout=90)
            require(result.returncode == 0, 'Canonical dist extraction failed')
        self.report['canonicalDistSha256'] = digest(AUDIT / 'canonical-dist.tar')
        self.persist()

    def wait_process(self, port, attempts=35):
        for attempt in range(attempts):
            try:
                require(self.request('/healthz', port).get('ok') is True, 'Process health failed')
                return
            except Exception:
                if attempt + 1 == attempts:
                    raise
                time.sleep(1)

    def hub_proof(self, shadow=True, seconds=30):
        deadline = time.monotonic() + seconds
        while True:
            if shadow:
                data = self.request('/snapshot?market=binance&assets=BTC,DOGE,ETH', HUB_PORT)
            else:
                code = "fetch('http://quote-hub:8091/snapshot?market=binance&assets=BTC,DOGE,ETH').then(async r=>{if(!r.ok)throw Error('hub');console.log(await r.text())}).catch(()=>process.exit(1))"
                data = json.loads(self.run(['docker', 'exec', 'coin-desk-quotes-1',
                                            'node', '-e', code], timeout=10))
            trades = data.get('trades', [])
            now = time.time()
            present = {t.get('asset') for t in trades if t.get('market') == 'binance'
                       and isinstance(t.get('lastTradeId'), int) and t['lastTradeId'] >= 0
                       and isinstance(t.get('tradedAt'), (int, float))
                       and now - 300 <= t['tradedAt'] <= now + 60
                       and isinstance(t.get('price'), (int, float)) and t['price'] > 0}
            if data.get('connected') is True and present >= {'BTC', 'DOGE', 'ETH'}:
                return {'connected': True, 'confirmedAssets': sorted(present),
                        'boundedProofRows': len(trades), 'checkedAt': int(now)}
            require(time.monotonic() < deadline, 'Core quote hub proof warm-up timed out')
            time.sleep(1)

    def operating_snapshot(self):
        db = sqlite3.connect((ROOT / 'shared/data/coin-desk.sqlite').as_uri() + '?mode=ro', uri=True)
        try:
            keys = ['quote:' + asset + ':' + market for asset in ['BTC', 'DOGE', 'ETH']
                    for market in ['binance', 'upbit']]
            quotes = db.execute('SELECT key,last_success,data_as_of FROM ingestion WHERE key IN (' +
                                ','.join('?' for _ in keys) + ') ORDER BY key', keys).fetchall()
            guarded = "CASE WHEN json_valid(data) THEN data ELSE '{}' END"
            proof = db.execute("SELECT key,json_extract(" + guarded + ",'$.timestampKind'),"
                               "json_extract(" + guarded + ",'$.time'),"
                               "json_extract(" + guarded + ",'$.actualTradeAt'),"
                               "json_extract(" + guarded + ",'$.lastTradeId') "
                               "FROM snapshots WHERE key IN ('quote:BTC:binance','quote:DOGE:binance',"
                               "'quote:ETH:binance') AND json_valid(data) ORDER BY key").fetchall()
            lanes = db.execute('SELECT lane,MAX(scheduled_at),MAX(completed_at) '
                               'FROM _coin_desk_runtime_runs GROUP BY lane ORDER BY lane').fetchall()
            return {'checkedAt': int(time.time()), 'quotes': quotes, 'proof': proof, 'lanes': lanes,
                    'readOnly': True, 'directCollectionOrOverviewCalled': False,
                    'otherVisitorsAbsentGuaranteed': False}
        finally:
            db.close()

    def rehearsal(self, report_name='candidate-runtime.json'):
        require(re.fullmatch('[a-z0-9-]+\\.json', report_name) and not (AUDIT / report_name).exists(),
                'Candidate report must be new; preserve previous evidence')
        for name in [SHADOW_API, SHADOW_HUB]:
            require(subprocess.run(['docker', 'inspect', name], capture_output=True).returncode != 0,
                    'Rehearsal container already exists')
        require(subprocess.run(['docker', 'network', 'inspect', SHADOW_NETWORK],
                               capture_output=True).returncode != 0, 'Rehearsal network already exists')
        for port in [API_PORT, HUB_PORT]:
            with socket.socket() as connection:
                connection.bind(('127.0.0.1', port))
        self.run(['docker', 'network', 'create', '--label', 'coin-desk-audit=' + AUDIT.name, SHADOW_NETWORK])
        created = []
        try:
            common = ['--network', SHADOW_NETWORK, '--read-only', '--cap-drop', 'ALL',
                      '--label', 'coin-desk-audit=' + AUDIT.name,
                      '--security-opt', 'no-new-privileges:true', '--user', '10001:10001',
                      '--tmpfs', '/tmp:size=64m,mode=1777', '--log-driver', 'local',
                      '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3']
            created.append(SHADOW_HUB)
            self.run(['docker', 'run', '-d', '--name', SHADOW_HUB, '--network-alias', 'quote-hub',
                      *common, '--memory', '192m', '--cpus', '.25', '-p',
                      f'127.0.0.1:{HUB_PORT}:8091', '-e', 'HOST=0.0.0.0', '-e', 'PORT=8091',
                      self.image, 'node', 'server/quote-hub.mjs'])
            self.wait_process(HUB_PORT)
            self.report['candidateHubProof'] = self.hub_proof()
            created.append(SHADOW_API)
            self.run(['docker', 'run', '-d', '--name', SHADOW_API, *common, '--memory', '768m',
                      '--cpus', '1', '-p', f'127.0.0.1:{API_PORT}:8080', '-v',
                      str(AUDIT / 'rehearsal.sqlite') + ':/app/data/rehearsal.sqlite:ro', '-v',
                      str(ROOT / 'shared/assets') + ':/app/retained-assets:ro',
                      '-e', 'COIN_DESK_DB=/app/data/rehearsal.sqlite', '-e',
                      'COIN_DESK_RELEASE=' + self.release, '-e', 'HOST=0.0.0.0', '-e', 'PORT=8080',
                      '-e', 'COIN_DESK_PUBLIC_ORIGIN=https://coin-desk.62.171.141.206.sslip.io',
                      '-e', 'COIN_DESK_QUOTE_HUB=http://quote-hub:8091',
                      '-e', 'COIN_DESK_RETAINED_ASSETS=/app/retained-assets',
                      '-e', 'COIN_DESK_CSP_MODE=enforce', self.image, 'node', 'server/index.mjs'])
            self.wait_process(API_PORT)
            self.run(['python3', str(self.new / 'deploy/vps/verify_runtime.py'), '--base',
                      f'http://127.0.0.1:{API_PORT}', '--database', str(AUDIT / 'rehearsal.sqlite'),
                      '--shadow', '--output', str(AUDIT / report_name)], timeout=300)
            unit_evidence = []
            for asset in ['DASH', 'ZEC']:
                response = self.request('/api/v1/network?asset=' + asset + '&metric=hashrate&limit=2')
                require_hashrate_unit(response, asset)
                unit_evidence.append({'asset': asset, 'unit': response['meta']['unit'],
                                      'dataAsOf': response['meta'].get('dataAsOf'),
                                      'rows': len(response.get('data', []))})
            self.report['candidateReadApisVerified'] = True
            self.report['candidateHashrateUnitsVerified'] = ['DASH', 'ZEC']
            self.report['candidateHashrateUnitEvidence'] = unit_evidence
            self.report['candidateRuntimeReport'] = report_name
            before = self.operating_snapshot()
            time.sleep(30)
            after = self.operating_snapshot()
            private_json(AUDIT / 'prepare-natural-sample.json', {
                'seconds': 30, 'before': before, 'after': after, 'sampleOnly': True,
                'candidateCollectorActivated': False,
            })
        finally:
            for name in reversed(created):
                owned = json.loads(self.run(['docker', 'inspect', '--format', '{{json .Config.Labels}}', name]))
                require(owned.get('coin-desk-audit') == AUDIT.name, 'Refuse unowned rehearsal cleanup')
                self.run(['docker', 'rm', '-f', name])
            network = json.loads(self.run(['docker', 'network', 'inspect', SHADOW_NETWORK]))[0]
            require(network.get('Labels', {}).get('coin-desk-audit') == AUDIT.name,
                    'Refuse unowned rehearsal network cleanup')
            self.run(['docker', 'network', 'rm', SHADOW_NETWORK])
        self.capacity('after isolated rehearsal')
        self.report['prepared'] = True
        self.persist()

    def prepare(self):
        self.assert_current()
        require(not self.report.get('prepared') and not self.report.get('backupVerified'),
                'Preparation already began; inspect checkpoints before rerun')
        before = self.containers()
        self.source_and_image()
        self.write_environment()
        self.validate_configs(before)
        self.backup_and_restore()
        self.retain_assets()
        self.rehearsal()

    def initial_container_ids(self, names):
        """Read the first private inspect checkpoint without exposing Config.Env."""
        initial = {}
        folder = AUDIT / 'private-logs'
        files = sorted(folder.glob('command-*.log'), key=lambda path: (path.stat().st_mtime_ns, path.name))
        require(len(files) <= 256, 'Unexpected audit log set; inspect before resume')
        for path in files:
            if path.is_symlink() or path.stat().st_size > 512 * 1024:
                continue
            try:
                item, _ = json.JSONDecoder().raw_decode(path.read_text())
            except (OSError, ValueError):
                continue
            if not isinstance(item, dict) or not isinstance(item.get('Config'), dict):
                continue
            labels = item['Config'].get('Labels') or {}
            name = labels.get('com.docker.compose.service')
            identity = item.get('Id', '')
            if name in names and name not in initial and labels.get('com.docker.compose.project') == 'coin-desk':
                require(re.fullmatch('[a-f0-9]{64}', identity), 'Invalid initial container identity')
                initial[name] = identity
        require(set(initial) == set(names), 'Initial inspect checkpoint incomplete')
        return initial

    def initial_protected_ids(self):
        return self.initial_container_ids(PROTECTED)

    def assert_protected_ids(self, before, initial):
        require(set(initial) == set(PROTECTED), 'Protected identity set incomplete')
        for name in PROTECTED:
            require(before[name]['Id'] == initial[name], 'Initial protected container changed: ' + name)

    def verify_loaded_checkpoint(self, require_clean_backup):
        """Recheck immutable artifacts and all original service IDs, without reloading."""
        self.assert_current()
        require(not self.report.get('prepared'), 'Already prepared; refuse repeated rehearsal')
        if require_clean_backup:
            require(not self.report.get('backupVerified') and not (AUDIT / 'backups').exists() and
                    not (AUDIT / 'rehearsal.sqlite').exists(),
                    'Resume is limited to the clean pre-backup checkpoint')
        require(self.newenv.is_file() and not self.newenv.is_symlink(), 'Existing exact candidate env required')
        for name in [SHADOW_API, SHADOW_HUB]:
            probe = subprocess.run(['docker', 'inspect', name], capture_output=True, timeout=5)
            require(probe.returncode != 0, 'Resume shadow container already exists')
        probe = subprocess.run(['docker', 'network', 'inspect', SHADOW_NETWORK],
                               capture_output=True, timeout=5)
        require(probe.returncode != 0, 'Resume shadow network already exists')
        require(self.report.get('imagePortability', {}).get('layerChainVerified') is True and
                self.report.get('imagePortability', {}).get('platformVerified') is True and
                self.report.get('sourceFilesVerified', 0) > 0,
                'Prior verified source/image checkpoint required')
        for field, sha_field in [('sourceArchive', 'sourceArchiveSha256'),
                                 ('imageArchive', 'imageArchiveSha256')]:
            name = self.manifest[field]
            require(pathlib.Path(name).name == name and not (AUDIT / name).is_symlink() and
                    digest(AUDIT / name) == self.manifest[sha_field], 'Resume artifact hash mismatch')
        require(self.new.is_dir() and not self.new.is_symlink(), 'Verified source directory required')
        with tarfile.open(AUDIT / self.manifest['sourceArchive'], 'r:gz') as archive:
            source_body = archive.extractfile('release-manifest.json').read()
        require((self.new / 'release-manifest.json').read_bytes() == source_body,
                'Resume source manifest differs from the checked archive')
        source = json.loads(source_body)
        require(source['release'] == self.release and source['containsPrivateData'] is False and
                len(source['files']) == self.report['sourceFilesVerified'], 'Resume source identity mismatch')
        for name, checksum in source['files'].items():
            path = pathlib.PurePosixPath(name)
            require(not path.is_absolute() and '..' not in path.parts and
                    not (self.new / name).is_symlink() and
                    (self.new / name).resolve().is_relative_to(self.new) and
                    digest(self.new / name) == checksum, 'Resume source checksum mismatch')
        prior = json.loads((OLD / 'release-manifest.json').read_text())
        require({k: v for k, v in source['files'].items() if k.startswith('migrations/')} ==
                {k: v for k, v in prior['files'].items() if k.startswith('migrations/')},
                'Resume migration set changed')
        with tarfile.open(AUDIT / self.manifest['imageArchive'], 'r:gz') as archive:
            manifest = json.load(archive.extractfile('manifest.json'))
            require(len(manifest) == 1 and manifest[0]['RepoTags'] == [self.manifest['imageTag']],
                    'Resume image archive identity mismatch')
            config_body = archive.extractfile(manifest[0]['Config']).read()
            cfg = json.loads(config_body)
            require('sha256:' + hashlib.sha256(config_body).hexdigest() ==
                    self.report['imagePortability']['ciConfigId'], 'Resume CI config hash mismatch')
        loaded = json.loads(self.run(['docker', 'image', 'inspect', self.image]))[0]
        require(loaded['Id'] in self.report['imagePortability']['verifiedIds'] and
                loaded['RootFS']['Layers'] == cfg['rootfs']['diff_ids'] and
                loaded['Os'] == 'linux' and loaded['Architecture'] == 'amd64',
                'Resume loaded image differs from prior checked artifact')
        database_bytes = (ROOT / 'shared/data/coin-desk.sqlite').stat().st_size
        self.capacity('resume verified source/image checkpoint; no reload or re-extraction',
                      (database_bytes * 3 if require_clean_backup else 0) + 256 * 1024 ** 2)
        before = self.containers()
        initial = self.initial_container_ids(SERVICES)
        for name in SERVICES:
            require(before[name]['Id'] == initial[name], 'Initial service container changed: ' + name)
        self.write_environment()
        self.validate_configs(before)
        self.report['resumedVerifiedImageCheckpoint'] = True
        self.report['initialAllServiceIdsReverified'] = {name: identity[:12] for name, identity in initial.items()}
        self.persist()

    def resume_after_image(self):
        self.verify_loaded_checkpoint(require_clean_backup=True)
        self.backup_and_restore()
        self.retain_assets()
        self.rehearsal()

    def verify_backup_checkpoint(self):
        require(self.report.get('backupVerified') is True and
                0 <= time.time() - self.report['backupCompletedAt'] < 3600 and
                self.report.get('previousStaticAssetsRetained') is True,
                'Fresh verified backup and retained assets checkpoint required')
        snapshots = list((AUDIT / 'backups').glob('*/snapshot.sqlite'))
        require(len(snapshots) == 1 and not snapshots[0].is_symlink() and
                snapshots[0].resolve().is_relative_to(AUDIT), 'Exactly one owned audit backup required')
        manifest = json.loads((snapshots[0].parent / 'manifest.json').read_text())
        require(manifest.get('verified') is True and
                manifest.get('fileSha256') == self.report['backupFileSha256'] and
                digest(snapshots[0]) == self.report['backupFileSha256'], 'Existing backup SHA mismatch')
        clone = AUDIT / 'rehearsal.sqlite'
        require(clone.is_file() and not clone.is_symlink(), 'Existing independent restore required')
        sys.path.insert(0, str(self.new / 'scripts'))
        from backup_check import fingerprint
        from import_d1_export import check_integrity
        db = sqlite3.connect(clone.as_uri() + '?mode=ro', uri=True)
        try:
            check_integrity(db)
            require(db.execute('PRAGMA journal_mode').fetchone()[0] == 'delete',
                    'Read-only clone must retain DELETE journal')
            require(fingerprint(db) == manifest['content'], 'Existing clone logical content mismatch')
        finally:
            db.close()
        require(digest(AUDIT / 'canonical-dist.tar') == self.report['canonicalDistSha256'],
                'Existing canonical dist SHA mismatch')
        self.report['existingBackupCloneDistReverified'] = True
        self.persist()

    def resume_after_backup(self):
        """Rehearsal only: keep the previously verified snapshot, clone and static assets."""
        self.verify_loaded_checkpoint(require_clean_backup=False)
        self.verify_backup_checkpoint()
        self.capacity('before replaying candidate rehearsal only', 256 * 1024 ** 2)
        self.rehearsal(report_name='candidate-runtime-after-unit-fix.json')

    def activate(self):
        self.assert_current()
        require(self.report.get('prepared') and self.report.get('backupVerified') and
                time.time() - self.report['backupCompletedAt'] < 3600,
                'Fresh verified backup and prepared candidate required')
        self.capacity('before staged selective replacement', 128 * 1024 ** 2)
        before = self.containers()
        self.validate_configs(before)
        require(digest(AUDIT / 'canonical-dist.tar') == self.report['canonicalDistSha256'],
                'Canonical dist changed')
        old_command, new_command = self.config(OLD, self.oldenv), self.config(self.new, self.newenv)
        result = {'commit': self.commit, 'release': self.release, 'previousRelease': OLD.name,
                  'startedAt': int(time.time()), 'attemptedServices': [], 'verifiedServices': [],
                  'schemaChanged': False, 'promoted': False, 'rollbackServices': []}
        try:
            for service in CHANGED:
                self.capacity('before replacement of ' + service, 128 * 1024 ** 2,
                              memory_required=1024 * 1024 ** 2)
                result['attemptedServices'].append(service)
                private_json(AUDIT / 'activation.json', result)
                self.run(new_command + ['up', '-d', '--no-deps', '--wait', '--wait-timeout',
                                        '180', service], timeout=210)
                current = self.containers()
                require(current[service]['Image'] in self.report['imagePortability']['verifiedIds']
                        and current[service]['Config']['Image'] == self.image,
                        'Activated image differs from approved artifact')
                for name in SERVICES:
                    if name not in result['attemptedServices']:
                        require(current[name]['Id'] == before[name]['Id'],
                                'Unapproved service replacement: ' + name)
                if service == 'quote-hub':
                    result['productionHubProof'] = self.hub_proof(shadow=False)
                if service == 'api':
                    self.wait_process(18420)
                result['verifiedServices'].append(service)
                private_json(AUDIT / 'activation.json', result)
            natural_before = self.operating_snapshot()
            for _ in range(8):
                time.sleep(15)
            natural_after = self.operating_snapshot()
            private_json(AUDIT / 'activation-natural-sample.json', {
                'seconds': 120, 'before': natural_before, 'after': natural_after, 'sampleOnly': True,
            })
            require_core_progress(natural_before, natural_after, time.time())
            result['sixCoreConfirmationsAdvanced'] = True
            result['naturalCoreProofVerified'] = True
            for name in PROTECTED:
                require(self.containers()[name]['Id'] == before[name]['Id'],
                        'Protected collector changed')
            link = ROOT / ('.current-' + AUDIT.name + '-next')
            require(not link.exists() and not link.is_symlink(), 'Temporary current link already exists')
            link.symlink_to(self.new)
            os.replace(link, ROOT / 'current')
            result['promoted'] = True
            result['protectedContainerIdsVerified'] = PROTECTED
        except BaseException:
            for service in reversed(result['attemptedServices']):
                try:
                    self.run(old_command + ['up', '-d', '--no-deps', '--wait', '--wait-timeout',
                                            '180', service], timeout=210)
                    restored = self.containers()[service]
                    require_restored_image(before[service], restored, service)
                    result['rollbackServices'].append(service)
                except BaseException:
                    result.setdefault('rollbackFailures', []).append(service)
            result['codeRolledBack'] = len(result['rollbackServices']) == len(result['attemptedServices'])
            result['liveDatabaseRestored'] = False
            raise
        finally:
            result['completedAt'] = int(time.time())
            private_json(AUDIT / 'activation.json', result)
            self.capacity('after activation or rollback', memory_required=512 * 1024 ** 2)
