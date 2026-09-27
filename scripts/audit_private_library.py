"""Read-only archive audit. Reports counts/hashes, never publishes private post text/media."""
from pathlib import Path
import argparse
import hashlib
import json

def audit(root: Path, decode_images=False):
    results = []
    for author in ('token_night', 'Astro1062'):
        folder = root / author
        source = folder / 'posts.jsonl'
        ids, references, dates, errors = set(), set(), [], []
        rows = 0
        with source.open(encoding='utf-8-sig') as stream:
            for number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                    rows += 1
                    pid = str(row['post_id'])
                    if pid in ids:
                        errors.append(f'duplicate row {number}')
                    ids.add(pid)
                    dates.append(row.get('date_utc', ''))
                    for media in row.get('images', []):
                        relative = str(media.get('file', '')).replace('\\', '/')
                        if not relative:
                            continue
                        file = (folder / relative).resolve()
                        if not file.is_relative_to(folder.resolve()):
                            errors.append(f'unsafe media row {number}')
                            continue
                        references.add(file)
                        if not file.is_file() or file.stat().st_size == 0:
                            errors.append(f'missing media row {number}: {relative}')
                except (ValueError, KeyError, TypeError) as error:
                    errors.append(f'row {number}: {type(error).__name__}')
        files = sorted(p.resolve() for p in (folder / 'images').iterdir() if p.is_file())
        manifest = hashlib.sha256()
        empty = 0
        for file in files:
            payload = file.read_bytes()
            empty += not bool(payload)
            if decode_images:
                from PIL import Image
                try:
                    with Image.open(file) as image: image.verify()
                except Exception as error:
                    errors.append(f'image decode {file.name}: {type(error).__name__}')
            manifest.update(file.name.encode())
            manifest.update(hashlib.sha256(payload).digest())
        results.append(dict(author=author, rows=rows, unique_ids=len(ids), image_files=len(files), referenced_files=len(references), unreferenced_files=len(set(files)-references), image_bytes=sum(f.stat().st_size for f in files), empty_files=empty, image_decode_checked=decode_images, earliest=min(dates), latest=max(dates), source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), media_manifest_sha256=manifest.hexdigest(), errors=errors, content_review='not_complete'))
    return dict(accounts=results, total_rows=sum(r['rows'] for r in results), total_images=sum(r['image_files'] for r in results), scope='Stored local records only; not all X history or full semantic/image review')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--decode-images', action='store_true')
    args = parser.parse_args()
    report = audit(args.source,args.decode_images)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if any(r['errors'] for r in report['accounts']):
        raise SystemExit(1)
