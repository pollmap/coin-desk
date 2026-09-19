"""Package reproducible app source; exclude credentials, caches and local databases."""
import pathlib, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT.parent / 'Coin-Desk-source.zip'
ROOT_FILES = ['.gitignore', '.gitattributes', '.nvmrc', '.prettierrc.json', 'README.md', 'package.json',
              'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'wrangler.jsonc', 'index.html']
files = [ROOT / name for name in ROOT_FILES]
for folder in ['src', 'shared', 'worker', 'migrations', 'scripts', 'tests', 'docs', '.github', 'pages', 'public']:
    files.extend(p for p in (ROOT / folder).rglob('*')
                 if p.is_file() and '__pycache__' not in p.parts and '.wrangler' not in p.parts and p.suffix != '.pyc')
with zipfile.ZipFile(DEST, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, 'coin-desk/' + path.relative_to(ROOT).as_posix())
with zipfile.ZipFile(DEST) as archive:
    assert archive.testzip() is None
    assert not any('/work/' in n or '/node_modules/' in n or '/.wrangler/' in n for n in archive.namelist())
print(f'{DEST.name}: {len(files)} files, {DEST.stat().st_size:,} bytes; archive verified')
