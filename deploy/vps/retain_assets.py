"""Retain content-addressed build assets for already-open tabs; never replace a collision."""
import hashlib
import pathlib
import re
import sys
import tarfile


def retain(stream, destination):
    root = pathlib.Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True)
    count = 0
    with tarfile.open(fileobj=stream, mode='r|*') as archive:
        for member in archive:
            if member.isdir():
                continue
            name = member.name.removeprefix('./')
            if not member.isfile() or not re.fullmatch(r'[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.(js|css|woff2|png|svg)', name):
                raise ValueError('Unexpected build asset')
            if member.size > 10 * 1024 * 1024:
                raise ValueError('Build asset exceeds limit')
            body = archive.extractfile(member).read()
            target = root / name
            if target.is_symlink():
                raise ValueError('Asset symlink rejected')
            if target.exists():
                if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(body).digest():
                    raise ValueError('Immutable asset collision')
            else:
                with target.open('xb') as output:
                    output.write(body)
                target.chmod(0o644)
            count += 1
    return count


if __name__ == '__main__':
    print('Verified retained assets:', retain(sys.stdin.buffer, sys.argv[1]))
