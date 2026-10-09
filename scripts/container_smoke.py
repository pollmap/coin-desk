"""CI-only container smoke test: disposable tmpfs database, no collectors or production mounts."""
import json, subprocess, time, urllib.error, urllib.request, uuid

def run(*args):
    return subprocess.check_output(list(args),text=True,stderr=subprocess.STDOUT).strip()

def smoke(image='coin-desk:ci'):
    name='coin-desk-ci-'+uuid.uuid4().hex[:16]
    try:
        run('docker','run','-d','--name',name,'--read-only','--cap-drop=ALL',
            '--security-opt=no-new-privileges:true','--tmpfs','/tmp:size=64m',
            '--tmpfs','/app/data:rw,uid=10001,gid=10001,mode=0700,size=32m',
            '--memory','512m','--cpus','1','-p','127.0.0.1::8080',image,
            'sh','-c','node server/migrate.mjs && exec node server/index.mjs')
        port=run('docker','port',name,'8080/tcp').removeprefix('127.0.0.1:')
        if not port.isdigit(): raise ValueError('Unexpected container port mapping')
        base='http://127.0.0.1:'+port
        ready=False
        for _ in range(30):
            try:
                with urllib.request.urlopen(base+'/healthz',timeout=3) as response: ready=json.load(response)['ok']
                if ready: break
            except (OSError,ValueError): time.sleep(1)
        if not ready: raise ValueError('Container never became healthy')
        seed="import sqlite3; db=sqlite3.connect('/app/data/coin-desk.sqlite'); db.execute('INSERT INTO reference_prices VALUES(?,?,?,?)',('BTC',1700000000,35000,1700000001)); db.commit(); db.close()"
        run('docker','exec',name,'python3','-c',seed)
        with urllib.request.urlopen(base+'/api/v1/reference?asset=BTC',timeout=10) as response:
            result=json.load(response);assert result['data'][0]['value']==35000 and result['meta']['unit']=='USD'
        with urllib.request.urlopen(base+'/',timeout=10) as response: assert 'id="root"' in response.read().decode()
        with urllib.request.urlopen(base+'/api/v1/runtime',timeout=10) as response: assert json.load(response)['kind']=='vps'
        try: urllib.request.urlopen(base+'/api/v1/reference?asset=BEAM',timeout=10)
        except urllib.error.HTTPError as error: assert error.code==400
        else: raise ValueError('Unsupported USD request was accepted')
        print('Container process/SQLite/static/API smoke passed; fixture only, collectors off')
    finally:
        subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

if __name__=='__main__': smoke()
