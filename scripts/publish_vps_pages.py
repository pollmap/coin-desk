"""Publish the immutable main-CI web assets after the same VPS release is active."""
import argparse,json,pathlib,re,subprocess
from deploy_vps import Runner,sha,require,validate_bundle

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle',required=True,type=pathlib.Path)
    parser.add_argument('--execute',action='store_true')
    args=parser.parse_args();folder=args.bundle.resolve(strict=True)
    pins,_=validate_bundle(folder)
    manifest=json.loads((folder/'canonical-assets.json').read_text())
    activation=json.loads((folder/'activate-result.json').read_text())
    require(activation['activation']['promoted'] and activation['currentRelease']==pins['release']==manifest['release'], 'Activate the same verified VPS release first')
    require(activation['commit']==manifest['commit']==pins['commit'], 'Canonical/activation commit differs')
    dist=folder/'canonical-public/dist'
    require(dist.is_dir() and not dist.is_symlink(), 'Verified canonical dist required')
    actual=set()
    for path in dist.rglob('*'):
        require(not path.is_symlink() and path.resolve().is_relative_to(dist), 'Canonical path escapes tree')
        if path.is_file():actual.add(path.relative_to(dist).as_posix())
    require(actual==set(manifest['files']), 'Canonical file set changed')
    for name,expected in manifest['files'].items():
        path=dist/name
        require(path.stat().st_size==expected['bytes'] and sha(path)==expected['sha256'], 'Canonical asset changed')
    if not args.execute:
        print(json.dumps({'validated':True,'mutations':False,'files':len(actual),'commit':pins['commit']}));return
    runner=Runner(folder);runner.verify_ci(pins)
    receipt=folder/'pages-deployment.json'
    require(not receipt.exists(), 'Preserve the previous publication outcome')
    command=['node','node_modules/wrangler/bin/wrangler.js','pages','deploy',str(dist),'--cwd','pages','--project-name','coin-desk','--branch','main','--commit-hash',pins['commit'],'--commit-message','Verified Bori Chart main release','--commit-dirty=true']
    result=subprocess.run(command,capture_output=True,timeout=600)
    output=(result.stdout+b'\n'+result.stderr).decode('utf-8','replace')
    (folder/'pages-deploy.private.log').write_text(output,encoding='utf-8')
    proof={'exit':result.returncode,'commit':pins['commit'],'release':pins['release'],
        'deploymentUrls':sorted(set(re.findall(r'https://[a-z0-9]+\.coin-desk\.pages\.dev',output))),
        'canonicalDistSha256':manifest['canonicalDistSha256'],'staticSource':'Verified main CI image canonical dist'}
    receipt.write_text(json.dumps(proof,indent=2),encoding='utf-8')
    print(json.dumps(proof));raise SystemExit(result.returncode)

if __name__=='__main__':main()
