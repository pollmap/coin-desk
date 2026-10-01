"""Change only the managed Coin Desk loopback upstream, with Nginx rollback."""
import argparse,datetime,json,pathlib,re,subprocess,urllib.request

def route(port):
    if not 1024<=port<=65535: raise ValueError('Invalid loopback port')
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/healthz',timeout=15) as response:
        if not json.load(response)['ok']: raise ValueError('Rollback API is unhealthy')
    target=pathlib.Path('/etc/nginx/sites-available/coin-desk.conf')
    before=target.read_text()
    if '# Managed by Coin Desk: project-only route' not in before: raise ValueError('Refusing to edit an unmanaged route')
    after,count=re.subn(r'proxy_pass http://127\.0\.0\.1:\d+;', 'proxy_pass http://127.0.0.1:'+str(port)+';',before)
    if count!=1: raise ValueError('Unexpected Coin Desk Nginx route shape')
    hosts=set(re.findall(r'server_name ([a-z0-9.-]+);',before))
    if len(hosts)!=1: raise ValueError('Unexpected hostname ownership')
    backup=pathlib.Path('/srv/services/coin-desk/audit/nginx')
    backup.mkdir(parents=True,exist_ok=True)
    (backup/('route-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.conf')).write_text(before)
    try:
        target.write_text(after)
        subprocess.run(['nginx','-t'],check=True)
        subprocess.run(['systemctl','reload','nginx'],check=True)
        with urllib.request.urlopen('https://'+next(iter(hosts))+'/healthz',timeout=20) as response:
            if not json.load(response)['ok']: raise ValueError('Public rollback HTTPS failed')
    except BaseException:
        target.write_text(before)
        subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,required=True)
    route(parser.parse_args().port)
