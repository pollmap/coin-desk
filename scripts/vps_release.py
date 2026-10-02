"""Build an allowlisted, secret-free VPS source archive with content checksums."""
import hashlib, io, json, pathlib, tarfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
TEXT_EXTENSIONS={'.sh','.py','.mjs','.js','.ts','.tsx','.json','.jsonc','.css','.html','.sql','.md','.txt','.yaml','.yml','.svg','.webmanifest'}

def release_bytes(path):
    body=path.read_bytes()
    # Honor the repository's eol=lf even when a Windows editor left CRLF in
    # an otherwise clean checkout. Hash exactly the bytes sent to Linux.
    if path.suffix in TEXT_EXTENSIONS or path.name in ['Dockerfile','.dockerignore']:
        body=body.replace(b'\r\n',b'\n')
    return body

def package(output=ROOT/'deployment-artifacts'):
    output=pathlib.Path(output);output.mkdir(parents=True,exist_ok=True)
    files=[ROOT/name for name in ['package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts','Dockerfile','.dockerignore']]
    for directory in ['src','shared','worker','server','scripts','migrations','public','extension','deploy']:
        files.extend(path for path in (ROOT/directory).rglob('*') if path.is_file() and not path.is_symlink()
                     and '__pycache__' not in path.parts and path.suffix not in ['.pyc','.sqlite','.sql-export']
                     and not path.name.startswith('.env') and 'downloads' not in path.relative_to(ROOT).parts)
    contents={path.relative_to(ROOT).as_posix():release_bytes(path) for path in sorted(files)}
    checksums={name:hashlib.sha256(body).hexdigest() for name,body in contents.items()}
    digest=hashlib.sha256(json.dumps(checksums,sort_keys=True).encode()).hexdigest()
    release='vps-'+digest[:16]
    manifest={'release':release,'sourceSha256':digest,'files':checksums,'containsPrivateData':False}
    target=output/(release+'.tar.gz')
    with tarfile.open(target,'w:gz') as archive:
        for path in sorted(files):
            name=path.relative_to(ROOT).as_posix();body=contents[name]
            item=archive.gettarinfo(str(path),arcname=name);item.size=len(body)
            archive.addfile(item,io.BytesIO(body))
        body=json.dumps(manifest,indent=2).encode();item=tarfile.TarInfo('release-manifest.json');item.size=len(body);item.mode=0o644
        archive.addfile(item,io.BytesIO(body))
    with tarfile.open(target,'r:gz') as archive:
        for item in archive:
            if item.name=='release-manifest.json': continue
            if not item.isfile() or hashlib.sha256(archive.extractfile(item).read()).hexdigest()!=checksums[item.name]: raise ValueError('Release archive verification failed')
    (output/(release+'.json')).write_text(json.dumps({**manifest,'archiveSha256':hashlib.sha256(target.read_bytes()).hexdigest()},indent=2),encoding='utf-8')
    return {'release':release,'archive':str(target),'files':len(checksums),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}

if __name__=='__main__': print(json.dumps(package(),indent=2))
