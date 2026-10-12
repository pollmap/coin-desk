"""Export the already-scanned Linux image, with source and artifact checksums."""
import argparse, gzip, hashlib, json, os, pathlib, re, shutil, subprocess
from vps_release import package

def prepare(image, commit, destination):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('Expected a full Git commit')
    if image != 'coin-desk:ci':
        raise ValueError('Only the verified CI image can be exported')
    destination = pathlib.Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    source = package(destination)
    image_id = subprocess.check_output(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], text=True).strip()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise ValueError('Invalid image ID')
    tag = 'coin-desk:git-' + commit
    subprocess.run(['docker', 'tag', image, tag], check=True)
    archive = destination / 'image.tar.gz'
    producer = subprocess.Popen(['docker', 'save', tag], stdout=subprocess.PIPE)
    try:
        with archive.open('xb') as raw:
            with gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=3, mtime=0) as compressed:
                shutil.copyfileobj(producer.stdout, compressed, 1024**2)
            raw.flush(); os.fsync(raw.fileno())
        if producer.wait() != 0:
            raise RuntimeError('Image export failed')
    finally:
        producer.stdout.close()
        if producer.poll() is None:
            producer.kill(); producer.wait()
    # Hash the compressed bytes without loading the whole image into RAM.
    with archive.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    manifest = {'commit': commit, 'release': source['release'], 'sourceArchive': pathlib.Path(source['archive']).name,
        'sourceArchiveSha256': source['sha256'], 'imageArchive': archive.name,
        'imageArchiveSha256': checksum, 'imageId': image_id, 'imageTag': tag,
        'imageBytes': archive.stat().st_size, 'containsPrivateData': False}
    (destination / 'deployment.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', default='coin-desk:ci')
    parser.add_argument('--commit', required=True)
    parser.add_argument('--destination', default='deployment-artifacts/verified-linux')
    args = parser.parse_args()
    print(json.dumps(prepare(args.image, args.commit, args.destination), indent=2))
