"""Read-only VPS baseline. Does not read service environments or credentials."""
import argparse, json, pathlib, shutil, socket, subprocess

def run(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if result.returncode: raise RuntimeError('Baseline command failed: '+command[0])
    return result.stdout.strip()

def inspect(port):
    if not 1024 <= port <= 65535: raise ValueError('Use an unprivileged loopback port')
    sock=socket.socket()
    try: sock.bind(('127.0.0.1',port))
    except OSError: raise ValueError('Candidate loopback port is already occupied')
    finally: sock.close()
    docker=json.loads('['+','.join(run(['docker','ps','--format','{{json .}}']).splitlines())+']')
    # Do not expose Docker inspect Config.Env / mount contents.
    containers=[]
    for row in docker:
        detail=json.loads(run(['docker','inspect','--format','{{json .State}}',row['ID']]))
        containers.append({'name':row['Names'],'state':detail['Status'],'health':detail.get('Health',{}).get('Status'),'image':row['Image'],'ports':row['Ports']})
    memory={k:int(v.split()[0])*1024 for k,v in (line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())}
    disk=shutil.disk_usage('/srv')
    if memory['MemAvailable'] < 3.5*1024**3 or disk.free < 8*1024**3:
        raise RuntimeError('Insufficient measured memory/disk headroom for the proposed resource limits')
    if not pathlib.Path('/srv/platform/templates/compose.yaml').is_file(): raise RuntimeError('Shared platform baseline is unavailable')
    if shutil.which('nginx') is None: raise RuntimeError('Existing Nginx is unavailable')
    run(['nginx','-t'])
    units=json.loads(run(['systemctl','list-units','--all','--type=service','--type=timer','--output=json']))
    return {'candidatePort':port,'memoryAvailableBytes':memory['MemAvailable'],'diskFreeBytes':disk.free,
            'dockerCompose':run(['docker','compose','version','--short']), 'containers':containers,
            'failedUnits':run(['systemctl','--failed','--no-legend','--plain']).splitlines(),
            'activeUnits':[row['unit'] for row in units if row['active']=='active'],
            'platformStatusPresent':pathlib.Path('/srv/platform/status/latest.json').is_file(),
            'miraePresent':pathlib.Path('/srv/mirae').exists(), 'readOnly':True}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,required=True)
    print(json.dumps(inspect(parser.parse_args().port),indent=2))
