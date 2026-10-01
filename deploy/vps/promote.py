"""Promote only a verified release; preserve unrelated service health and platform registry."""
import argparse,json,os,pathlib,subprocess
ROOT=pathlib.Path('/srv/services/coin-desk')

def promote(release,hostname):
    import re
    if not re.fullmatch(r'vps-[a-f0-9]{16}',release): raise ValueError('Invalid release ID')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]+[a-z0-9]',hostname) or '..' in hostname: raise ValueError('Invalid hostname')
    audit=ROOT/'audit'/release
    before=json.loads((audit/'before.json').read_text())
    result=json.loads((audit/'activated.json').read_text())
    if not result.get('naturalProgressVerified'): raise ValueError('Natural scheduler progress was not verified')
    for row in before['containers']:
        if row['name'].startswith('coin-desk-'): continue
        state=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .State}}',row['name']],text=True))
        if state['Status']!=row['state'] or (row.get('health')=='healthy' and state.get('Health',{}).get('Status')!='healthy'):
            raise ValueError('Unrelated service worsened; promotion refused')
    for unit in before.get('activeUnits',[]):
        if subprocess.run(['systemctl','is-active','--quiet',unit]).returncode:
            raise ValueError('Existing service/timer worsened; promotion refused')
    current=ROOT/'current'
    if current.exists() and not current.is_symlink(): raise ValueError('current is not a managed symlink')
    previous=os.readlink(current) if current.is_symlink() else None
    if previous: (audit/'previous-release.txt').write_text(previous)
    temporary=ROOT/'.current-next'
    if temporary.exists() or temporary.is_symlink(): raise ValueError('An unfinished promotion already exists')
    # Append a dedicated entry; do not rewrite the platform's other service registry.
    registry=pathlib.Path('/srv/platform/SERVICES.md')
    with registry.open('a',encoding='utf-8') as output:
        output.write('\n\n## Coin Desk '+release+'\n\nRoot: /srv/services/coin-desk; Compose: coin-desk; HTTPS: https://'+hostname+'; persistent SQLite: shared/data/coin-desk.sqlite; verified local backups: backups/. Same-host backups are not offsite.\n')
        output.flush();os.fsync(output.fileno())
    temporary.symlink_to(ROOT/'releases'/release)
    os.replace(temporary,current)
    (audit/'promotion.json').write_text(json.dumps({'promoted':True,'release':release,'previous':previous,'unrelatedServicesPreserved':True},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--release',required=True);parser.add_argument('--hostname',required=True)
    args=parser.parse_args();promote(args.release,args.hostname)
