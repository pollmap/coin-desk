"""Deterministic local-install extension archive; never include profiles or private data."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ['manifest.json', 'background.js', 'protocol.js', 'site-bridge.js', 'x-reader.js', 'popup.html', 'popup.js', 'popup.css', 'README.md']
def main():
    target = ROOT / 'public/downloads/coin-desk-importer.zip'
    target.parent.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text(encoding='utf-8'))
    assert manifest['manifest_version'] == 3
    assert not {'cookies', 'debugger', 'webRequest', 'history'}.intersection(manifest['permissions'])
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as out:
        for name in FILES:
            info = zipfile.ZipInfo('coin-desk-importer/' + name, (2026, 9, 27, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(info, (ROOT / 'extension' / name).read_bytes())
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(FILES)
    print(f'Extension: {len(FILES)} files, {target.stat().st_size} bytes; CRC verified')
if __name__ == '__main__':
    main()
