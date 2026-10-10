"""Offline audit of shipped logo bytes, provenance and registry identity."""
import hashlib
import json
import pathlib
import re
import struct
import urllib.parse
import zlib


def png_dimensions(data):
    assert data.startswith(b'\x89PNG\r\n\x1a\n'), 'Not PNG'
    offset, dimensions, ended = 8, None, False
    while offset < len(data):
        assert offset + 12 <= len(data), 'Truncated PNG chunk'
        length, = struct.unpack('>I', data[offset:offset + 4])
        tag = data[offset + 4:offset + 8]
        end = offset + 8 + length
        assert end + 4 <= len(data), 'Truncated PNG payload'
        assert zlib.crc32(data[offset + 4:end]) == struct.unpack('>I', data[end:end + 4])[0], 'PNG CRC'
        if dimensions is None:
            assert tag == b'IHDR' and length == 13, 'Missing PNG header'
            dimensions = struct.unpack('>II', data[offset + 8:offset + 16])
        offset = end + 4
        if tag == b'IEND':
            assert length == 0 and offset == len(data), 'PNG trailing bytes'
            ended = True
            break
    assert ended and dimensions and all(32 <= d <= 4096 for d in dimensions), 'PNG dimensions/end'
    return dimensions


def validate_logos(root):
    registry = json.loads((root / 'shared/asset-registry.json').read_text(encoding='utf-8'))['assets']
    manifest = json.loads((root / 'public/coin-logos/sources.json').read_text(encoding='utf-8'))
    assert manifest['version'] == 1
    entries = {r['asset']: r for r in manifest['entries']}
    assert len(entries) == len(manifest['entries']) == len(registry) == 150
    assert set(entries) == {a['id'] for a in registry}
    hashes, total = set(), 0
    providers = {'Upbit': 'static.upbit.com', 'Binance': 'bin.bnbstatic.com', 'Trust Wallet': 'raw.githubusercontent.com'}
    for asset in registry:
        r = entries[asset['id']]
        path = asset['logo']
        assert re.fullmatch(r'/coin-logos/v2/[a-z0-9]+-[a-f0-9]{12}\.png', path), path
        assert path == r['path'] and path.rsplit('/', 1)[1].startswith(asset['id'].lower() + '-'), path
        body = (root / 'public' / path.lstrip('/')).read_bytes()
        png_dimensions(body)
        digest = hashlib.sha256(body).hexdigest()
        assert digest == r['sha256'] and digest[:12] in path and digest not in hashes, asset['id']
        hashes.add(digest)
        assert len(body) == r['bytes'] and len(body) <= 500000
        source = urllib.parse.urlsplit(r['sourceUrl'])
        assert source.scheme == 'https' and source.hostname == providers[r['provider']] and not source.username
        assert r['englishName'] == asset['englishName'] and r['verifiedPair'] in asset['markets'].values()
        assert r['identitySourceUrl'].startswith('https://') and r['identityReview'] and r['checkedAt']
        total += len(body)
    assert {p.name for p in (root / 'public/coin-logos/v2').iterdir()} == {pathlib.PurePosixPath(r['path']).name for r in entries.values()}
    return {'assets': len(entries), 'bytes': total, 'distinctImages': len(hashes)}
