"""Deploy only a reviewed main-CI bundle. No build, migration or collector restart.

The bundle contains deployment.json, source-scope.json, reviewed-pins.json,
selective_release.py, rollout_engine.py, and the two CI archives. Commands
default to inspection; mutations require --execute. Logs remain in the bundle.
"""
import argparse, datetime, hashlib, json, pathlib, re, subprocess, tarfile

HOST = 'chanhee-vps'
REMOTE_ROOT = '/srv/services/coin-desk'
EXPECTED_JOBS = {'checks','browser (chromium)','browser (webkit)','container','verify'}
INPUTS = {'deployment.json','source-scope.json','selective_release.py','rollout_engine.py'}

def require(condition, message):
    if not condition: raise ValueError(message)

def sha(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream,'sha256').hexdigest()

def validate_bundle(folder):
    require(not folder.is_symlink(), 'Bundle cannot be a symlink')
    pins = json.loads((folder/'reviewed-pins.json').read_text(encoding='utf-8'))
    artifact = json.loads((folder/'deployment.json').read_text(encoding='utf-8'))
    require(re.fullmatch('[a-f0-9]{40}',pins.get('commit','')), 'Exact main commit required')
    require(re.fullmatch('vps-[a-f0-9]{16}',pins.get('release','')), 'Invalid release')
    require(re.fullmatch('vps-[a-f0-9]{16}',pins.get('previousRelease','')), 'Invalid previous release')
    require(re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',pins.get('auditName','')), 'Invalid owned audit name')
    require(pins.get('changedServices') in [['api'],['quote-hub','api']], 'Only API or API/hub scope allowed')
    require(pins.get('executeAllowed') is True and pins.get('mainCiAllFivePassed') is True, 'Reviewed CI bundle required')
    require(pins.get('mainCiHead') == pins['commit'], 'Reviewed CI head differs')
    require(set(pins.get('files',{})) == INPUTS, 'Unexpected helper or input set')
    for name, expected in pins['files'].items():
        path=folder/name
        require(not path.is_symlink() and sha(path)==expected, 'Reviewed file changed: '+name)
    require(artifact['commit']==pins['commit'] and artifact['release']==pins['release'] and artifact['containsPrivateData'] is False, 'Artifact identity/privacy differs')
    for field, digest in [('sourceArchive','sourceArchiveSha256'),('imageArchive','imageArchiveSha256')]:
        name=artifact[field]
        require(pathlib.Path(name).name==name and '\\' not in name, 'Unsafe archive name')
        path=folder/name
        require(not path.is_symlink() and sha(path)==artifact[digest], 'CI archive differs: '+field)
    return pins,artifact

class Runner:
    def __init__(self,folder):
        self.folder=folder
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        self.log=folder/('rollout-'+stamp+'.private.log')
    def run(self,args,timeout=90,body=None):
        result=subprocess.run(args,input=body,capture_output=True,timeout=timeout)
        with self.log.open('ab') as output: output.write(result.stdout+b'\n'+result.stderr+b'\n')
        require(result.returncode==0, 'Phase stopped; inspect private log; no automatic retry')
        return result.stdout
    def ssh(self,code,timeout=90):
        return json.loads(self.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',HOST,'python3 -'],timeout,(code+'\n').encode()))
    def verify_ci(self,pins):
        prefix='repos/pollmap/coin-desk/'
        run=json.loads(self.run(['gh','api',prefix+'actions/runs/'+str(pins['mainCiRunId'])]))
        jobs=json.loads(self.run(['gh','api',prefix+'actions/runs/'+str(pins['mainCiRunId'])+'/jobs']))['jobs']
        current=json.loads(self.run(['gh','api',prefix+'commits/main']))
        require(current['sha']==pins['commit']==run['head_sha'] and run['head_branch']=='main' and run['event']=='push' and run['conclusion']=='success', 'Main/CI identity moved; review first')
        require(len(jobs)==5 and {j['name'] for j in jobs}==EXPECTED_JOBS and all(j['status']=='completed' and j['conclusion']=='success' for j in jobs), 'Five successful final main jobs required')

def stage(runner,pins,artifact,remote):
    require(not (runner.folder/'prepare-result.json').exists(), 'Preserve prior prepare result')
    files=['reviewed-pins.json',*sorted(INPUTS),artifact['sourceArchive'],artifact['imageArchive']]
    checks={name:sha(runner.folder/name) for name in files}
    needed=sum((runner.folder/name).stat().st_size for name in files)
    runner.ssh('target='+repr(remote)+'\nprevious='+repr(pins['previousRelease'])+'\nneeded='+str(needed)+'\n'+'''
import pathlib,shutil,json
root=pathlib.Path('/srv/services/coin-desk');p=pathlib.Path(target)
assert root.resolve()==root and p.parent.resolve()==root/'audit'
assert (root/'current').resolve()==root/'releases'/previous
assert not p.exists() and not p.is_symlink(), 'Preserve prior stage; inspect checkpoint'
assert shutil.disk_usage(root).free >= 8589934592+needed+1610612736
p.mkdir(mode=0o700)
print(json.dumps({'newOwnedStage':True,'productionChanged':False}))
''')
    for name in files:
        runner.run(['scp','-q','-o','BatchMode=yes',str(runner.folder/name),HOST+':'+remote+'/'+name],180)
    runner.ssh('target='+repr(remote)+'\nchecks='+repr(checks)+'\n'+'''
import pathlib,hashlib,json
p=pathlib.Path(target)
for n,s in checks.items():
 f=p/n; assert f.is_file() and not f.is_symlink() and hashlib.file_digest(f.open('rb'),'sha256').hexdigest()==s
print(json.dumps({'transportFilesVerified':len(checks)}))
''')

def phase(runner,pins,remote,operation):
    target=runner.folder/(operation+'-result.json')
    require(not target.exists(), 'Preserve prior phase result')
    result=runner.ssh('target='+repr(remote)+'\ncommit='+repr(pins['commit'])+'\nphase='+repr(operation)+'\n'+'''
import pathlib,subprocess,json,hashlib
p=pathlib.Path(target);pins=json.loads((p/'reviewed-pins.json').read_text())
for n,s in pins['files'].items(): assert hashlib.file_digest((p/n).open('rb'),'sha256').hexdigest()==s
r=subprocess.run(['python3',str(p/'selective_release.py'),phase,commit,'--audit',str(p),'--execute-reviewed-selective-rollout'],capture_output=True,text=True,timeout=850)
(p/(phase+'-wrapper.private.log')).write_text(r.stdout+'\n'+r.stderr)
assert r.returncode==0, 'Remote phase failed; preserve checkpoint'
prepared=json.loads((p/'prepare.json').read_text())
out={k:prepared[k] for k in ['commit','release','prepared','backupVerified','canonicalDistSha256']}
if phase=='activate':
 out['activation']=json.loads((p/'activation.json').read_text());out['currentRelease']=(p.parent.parent/'current').resolve().name
print(json.dumps(out))
''',880)
    target.write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result

def canonical(runner,pins,remote):
    prepared=json.loads((runner.folder/'prepare-result.json').read_text())
    require(prepared['commit']==pins['commit'] and prepared['prepared'] and prepared['backupVerified'], 'Prepared identity differs')
    path=runner.folder/'canonical-dist.tar';public=runner.folder/'canonical-public'
    require(not path.exists() and not public.exists(), 'Preserve canonical proof before retry')
    runner.run(['scp','-q','-o','BatchMode=yes',HOST+':'+remote+'/canonical-dist.tar',str(path)],120)
    require(sha(path)==prepared['canonicalDistSha256'], 'Canonical transport changed')
    public.mkdir()
    with tarfile.open(path) as archive:
        members=archive.getmembers()
        require(len(members)==len({m.name for m in members}), 'Duplicate canonical path')
        for member in members:
            p=pathlib.PurePosixPath(member.name)
            require(not p.is_absolute() and '..' not in p.parts and p.parts[0]=='dist' and (member.isdir() or member.isfile()), 'Unsafe canonical path')
        archive.extractall(public,filter='data')
    files={p.relative_to(public/'dist').as_posix():{'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted((public/'dist').rglob('*')) if p.is_file()}
    (runner.folder/'canonical-assets.json').write_text(json.dumps({**prepared,'files':files},indent=2),encoding='utf-8')
    return {'publicFiles':len(files),'canonicalDistSha256':prepared['canonicalDistSha256']}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['inspect','stage-prepare','activate','canonical'])
    parser.add_argument('--bundle',required=True,type=pathlib.Path)
    parser.add_argument('--execute',action='store_true')
    args=parser.parse_args();folder=args.bundle.resolve(strict=True)
    pins,artifact=validate_bundle(folder)
    if args.phase=='inspect' or not args.execute:
        print(json.dumps({'validated':True,'mutations':False,'commit':pins['commit'],'release':pins['release'],'services':pins['changedServices']}));return
    runner=Runner(folder);runner.verify_ci(pins)
    remote=REMOTE_ROOT+'/audit/'+pins['auditName']
    if args.phase=='stage-prepare':
        stage(runner,pins,artifact,remote);result=phase(runner,pins,remote,'prepare')
        result['canonical']=canonical(runner,pins,remote)
    elif args.phase=='activate': result=phase(runner,pins,remote,'activate')
    else: result=canonical(runner,pins,remote)
    print(json.dumps(result))

if __name__=='__main__': main()
