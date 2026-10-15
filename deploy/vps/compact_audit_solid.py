"""Plan or pilot a lossless solid archive of explicitly named inactive audit files.

This tool never removes, renames or rewrites an input. A pilot stores a new
archive, verifies every member and independently restores one original SQLite
backup in a NEW isolated directory. Physical replacement requires another tool
and a separate reviewed operation; it is deliberately absent here.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tarfile
import time

GIB = 1024**3
DISK_RESERVE = 2 * GIB
MEMORY_RESERVE = 3 * GIB // 2
HISTORY_GUARD = 8 * GIB
MANIFEST_NAME = 'BORICHART-AUDIT-MANIFEST.json'
SUFFIXES = ('.sqlite', '.sqlite-wal', '.sqlite-shm', '.sqlite.gz', '.tar', '.tar.gz', '.json', '.zip')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def selected_path(root, name):
    require(isinstance(name, str), 'An explicit relative audit file is required')
    rel = PurePosixPath(name)
    require(not rel.is_absolute() and len(rel.parts) >= 2 and rel.as_posix() == name,
            'An explicit relative audit file is required')
    require(rel.parts[0] == 'audit' and '..' not in rel.parts and '\\' not in name,
            'Only owned audit files are allowed')
    require(rel.parts[1] != 'space-035' and name.endswith(SUFFIXES),
            'Output files or unsupported input formats are not eligible')
    path = root.joinpath(*rel.parts)
    require(path.resolve(strict=True) == path and path.is_file() and not path.is_symlink(),
            'Audit input must be a canonical regular file')
    return path


def inactive_sources(paths):
    """Fail closed on unknown container mounts or unreadable process descriptors."""
    ids = subprocess.check_output(['docker', 'ps', '-aq'], text=True, timeout=15).split()
    require(bool(ids), 'Container-reference inventory is required')
    lines = subprocess.check_output(['docker', 'inspect', '--format', '{{json .Mounts}}', *ids],
                                    text=True, timeout=20).splitlines()
    mounts = [Path(m['Source']).resolve() for line in lines for m in json.loads(line)]
    for path in paths:
        require(not any(m == path or m in path.parents or path in m.parents for m in mounts),
                'A selected source is mounted by a container')
    require(Path('/proc/self/fd').is_dir(), 'Readable Linux process descriptor inventory required')
    exact = {str(path) for path in paths}
    for process in Path('/proc').glob('[0-9]*'):
        try:
            for fd in (process / 'fd').iterdir():
                try:
                    require(os.readlink(fd) not in exact, 'A selected source is open by a process')
                except FileNotFoundError:
                    continue
        except FileNotFoundError:
            continue


def source_manifest(root, names, activity_check=inactive_sources):
    root = Path(root).absolute()
    require(root.resolve(strict=True) == root and not root.is_symlink(), 'Canonical project root required')
    require(root.name == 'coin-desk', 'Expected isolated project root')
    require(1 <= len(names) <= 256 and len(set(names)) == len(names), 'Select 1–256 unique files')
    paths = [selected_path(root, name) for name in sorted(names)]
    activity_check(paths)
    rows = []
    for path in paths:
        s = path.stat()
        rows.append({'name': path.relative_to(root).as_posix(), 'bytes': s.st_size,
                     'allocatedBytes': getattr(s, 'st_blocks', (s.st_size + 511) // 512) * 512,
                     'sha256': digest(path), 'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid,
                     'gid': s.st_gid, 'mtimeNs': s.st_mtime_ns, 'device': s.st_dev, 'inode': s.st_ino})
    require(sum(x['bytes'] for x in rows) <= 6 * GIB, 'Pilot input exceeds 6 GiB')
    return {'format': 'bori-solid-audit-pilot-v1', 'files': rows,
            'logicalBytes': sum(x['bytes'] for x in rows), 'sourceDeletionSupported': False,
            'operatingDatabaseAndDailyBackupsSelected': False, 'historyGuardBytesUnchanged': HISTORY_GUARD}


def available_memory():
    rows = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    return int(rows['MemAvailable'].split()[0]) * 1024


class Budget:
    def __init__(self, root, maximum_output, restore_reserve, timeout=600,
                 free_disk=None, memory=None):
        require(0 < maximum_output <= 2 * GIB, 'Archive quota must be at most 2 GiB')
        require(0 < restore_reserve <= GIB, 'Independent restore quota must be at most 1 GiB')
        require(1 <= timeout <= 600, 'Pilot timeout must be at most 600 seconds')
        self.free_disk = free_disk or (lambda: shutil.disk_usage(root).free)
        self.memory = memory or available_memory
        self.maximum_output, self.restore_reserve = maximum_output, restore_reserve
        self.deadline = time.monotonic() + timeout
        self.written = 0
        require(self.memory() >= MEMORY_RESERVE + 768 * 1024**2,
                'Insufficient memory for compression while preserving 1.5 GiB reserve')
        require(self.free_disk() >= DISK_RESERVE + maximum_output + restore_reserve + 1024**2,
                'Insufficient space for archive, restore and 2 GiB reserve')

    def check(self, additional=0, restoring=False):
        require(time.monotonic() <= self.deadline, 'Pilot timeout exceeded')
        require(self.memory() >= MEMORY_RESERVE, '1.5 GiB remaining memory reserve violated')
        reserve = DISK_RESERVE + (0 if restoring else self.restore_reserve)
        require(self.free_disk() >= reserve + additional + 1024**2,
                '2 GiB disk or restore reserve violated')
        if not restoring:
            require(self.written + additional <= self.maximum_output, 'Archive quota exceeded')


class LimitedWriter:
    def __init__(self, stream, budget):
        self.stream, self.budget = stream, budget

    def write(self, data):
        self.budget.check(len(data))
        count = self.stream.write(data)
        self.budget.written += count
        return count

    def flush(self):
        self.stream.flush()


def verify_archive(archive, manifest, budget):
    expected = {x['name']: x for x in manifest['files']}
    seen = set()
    with lzma.open(archive, 'rb') as decoded, tarfile.open(fileobj=decoded, mode='r|') as tar:
        for member in tar:
            budget.check()
            require(member.isfile() and member.name not in seen, 'Unexpected or duplicate archive member')
            seen.add(member.name)
            with tar.extractfile(member) as stream:
                if member.name == MANIFEST_NAME:
                    require(json.load(stream) == manifest, 'Embedded manifest mismatch')
                    continue
                require(member.name in expected, 'Unexpected archive member')
                row = expected[member.name]
                h = hashlib.sha256()
                size = 0
                while block := stream.read(1024**2):
                    budget.check()
                    h.update(block)
                    size += len(block)
                require(size == row['bytes'] and h.hexdigest() == row['sha256'], 'Expanded source bytes differ')
                require(member.mode == row['mode'] and member.uid == row['uid'] and member.gid == row['gid'],
                        'Archive permission or owner metadata differs')
        # TAR's end marker can precede the XZ checksum/footer. Drain the decoder
        # rather than treating a readable last member as a complete archive.
        while tail := tar.fileobj.read(1024**2):
            budget.check()
            require(not tail.strip(b'\0'), 'Unexpected data after the TAR end marker')
    require(seen == set(expected) | {MANIFEST_NAME}, 'Archive member set differs')
    return len(expected)


def independent_restore(root, archive, output, manifest, backup_folder, budget):
    folder = PurePosixPath(backup_folder)
    expected = {x['name']: x for x in manifest['files'] if PurePosixPath(x['name']).parent == folder}
    require({str(folder / 'snapshot.sqlite'), str(folder / 'manifest.json')} <= set(expected),
            'Select the original snapshot and its verified manifest for independent restore')
    destination = output / 'restore-source'
    destination.mkdir(mode=0o700)
    with lzma.open(archive, 'rb') as decoded, tarfile.open(fileobj=decoded, mode='r|') as tar:
        for member in tar:
            if member.name not in expected:
                continue
            row = expected[member.name]
            path = destination / PurePosixPath(member.name).name
            with path.open('xb') as target, tar.extractfile(member) as source:
                os.chmod(path, 0o600)
                while block := source.read(1024**2):
                    budget.check(len(block), restoring=True)
                    target.write(block)
            require(digest(path) == row['sha256'], 'Independent extraction bytes differ')
    report = json.loads((destination / 'manifest.json').read_text())
    require(report.get('verified') is True and len(report.get('content', {}).get('tables', {})) == 21,
            'A verified 21-user-table backup manifest is required')
    budget.check(restoring=True)
    sys.dont_write_bytecode = True
    scripts = (root / 'current' / 'scripts').resolve(strict=True)
    require(root in scripts.parents and scripts.is_dir(), 'Backup verifier must remain inside the project')
    sys.path.insert(0, str(scripts))
    from vps_backup import restore
    result = restore(destination / 'snapshot.sqlite', output / 'restored.sqlite', destination / 'manifest.json')
    require(result['verified'] is True, 'Independent schema/content/index restore failed')
    budget.check(restoring=True)
    return {'verified': True, 'userTables': 21, 'originalBackupFolder': str(folder),
            'schemaSha256': report['content']['schemaSha256'], 'liveDatabaseOverwritten': False}


def pilot(root, names, output_name, backup_folder, maximum_output=GIB, timeout=600,
          activity_check=inactive_sources, budget_factory=Budget):
    started = time.monotonic()
    root = Path(root).absolute()
    manifest = source_manifest(root, names, activity_check)
    outrel = PurePosixPath(output_name)
    require(outrel.as_posix() == output_name and len(outrel.parts) == 3 and
            outrel.parts[:2] == ('audit', 'space-035') and
            outrel.name.startswith('pilot-') and '..' not in outrel.parts,
            'Use a new explicit audit/space-035/pilot-* directory')
    parent = root / 'audit' / 'space-035'
    require(not parent.is_symlink() and parent.resolve() == parent, 'Canonical owned output parent required')
    output = root.joinpath(*outrel.parts)
    require(not output.exists() and not output.is_symlink(), 'Pilot must not resume or overwrite files')
    backup_files = [x for x in manifest['files'] if PurePosixPath(x['name']).parent == PurePosixPath(backup_folder)]
    require(any(PurePosixPath(x['name']).name == 'snapshot.sqlite' for x in backup_files),
            'Independent restore source must be selected')
    restore_reserve = 2 * sum(x['bytes'] for x in backup_files) + 32 * 1024**2
    budget = budget_factory(root, maximum_output, restore_reserve, timeout)
    budget.deadline = started + timeout
    budget.check()
    parent.mkdir(mode=0o700, exist_ok=True)
    output.mkdir(mode=0o700)
    archive = output / 'audit-files.tar.xz'
    filters = [{'id': lzma.FILTER_LZMA2, 'dict_size': 64 * 1024**2,
                'mode': lzma.MODE_FAST, 'mf': lzma.MF_HC4, 'nice_len': 64, 'depth': 0}]
    with archive.open('xb') as raw:
        os.chmod(archive, 0o600)
        with lzma.LZMAFile(LimitedWriter(raw, budget), 'w', format=lzma.FORMAT_XZ, filters=filters) as packed:
            with tarfile.open(fileobj=packed, mode='w|', format=tarfile.PAX_FORMAT) as tar:
                body = json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()
                info = tarfile.TarInfo(MANIFEST_NAME)
                info.size, info.mode = len(body), 0o600
                tar.addfile(info, io.BytesIO(body))
                for row in manifest['files']:
                    budget.check()
                    path = root / row['name']
                    tar.add(path, arcname=row['name'], recursive=False)
        raw.flush()
        os.fsync(raw.fileno())
    members = verify_archive(archive, manifest, budget)
    restored = independent_restore(root, archive, output, manifest, backup_folder, budget)
    after = source_manifest(root, names, activity_check)
    require(after == manifest, 'Original file bytes, permissions or inode changed during pilot')
    report = {'format': manifest['format'], 'verified': True, 'sourceFiles': manifest,
              'archiveRelativePath': str(archive.relative_to(root)), 'archiveSha256': digest(archive),
              'archiveBytes': archive.stat().st_size, 'originalBytes': manifest['logicalBytes'],
              'verifiedArchiveMembers': members, 'independentRestore': restored,
              'originalInputsUnchanged': True, 'originalDeletionPerformed': False,
              'sourceReplacementSupported': False, 'dictionaryBytes': 64 * 1024**2,
              'memoryReserveBytes': MEMORY_RESERVE, 'diskReserveBytes': DISK_RESERVE,
              'historyGuardBytesUnchanged': HISTORY_GUARD,
              'pilotFilesRetained': True, 'completedAt': int(time.time())}
    path = output / 'PILOT.json'
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(report, stream, indent=2)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--file', action='append', required=True)
    parser.add_argument('--pilot-output')
    parser.add_argument('--restore-folder')
    parser.add_argument('--max-output-bytes', type=int, default=GIB)
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args()
    if args.pilot_output:
        require(bool(args.restore_folder), 'Pilot requires an independent restore folder')
        result = pilot(args.root, args.file, args.pilot_output, args.restore_folder,
                       args.max_output_bytes, args.timeout)
    else:
        require(not args.restore_folder, 'Restore-folder only applies to an explicit pilot')
        result = source_manifest(Path(args.root), args.file)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
