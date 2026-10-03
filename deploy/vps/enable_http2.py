"""Enable HTTP/2 on the owned Nginx 1.24 route; preserve upstreams and SSE settings."""
import datetime, json, pathlib, re, socket, ssl, subprocess


def configure(text):
    if not text.startswith('# Managed by Coin Desk: project-only route\n'):
        raise ValueError('Unmanaged route')
    hosts=set(re.findall(r'server_name ([a-z0-9.-]+);',text))
    if hosts!={'coin-desk.62.171.141.206.sslip.io'}: raise ValueError('Unexpected host')
    if len(re.findall(r'listen 443 ssl(?: http2)?;',text))!=1: raise ValueError('Unexpected TLS listener')
    return text.replace('listen 443 ssl;', 'listen 443 ssl http2;')


def apply():
    # Nginx 1.24 uses the listen parameter; http2 on requires 1.25.1+.
    import fcntl
    with open('/srv/platform/nginx-edit.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        target=pathlib.Path('/etc/nginx/sites-available/coin-desk.conf')
        if target.is_symlink(): raise ValueError('Unexpected config symlink')
        before=target.read_text();after=configure(before)
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        audit=pathlib.Path('/srv/services/coin-desk/audit/nginx');audit.mkdir(exist_ok=True)
        backup=audit/('before-http2-'+stamp+'.conf');backup.write_text(before);backup.chmod(0o600)
        try:
            target.write_text(after)
            subprocess.run(['nginx','-t'],check=True)
            subprocess.run(['systemctl','reload','nginx'],check=True)
            ctx=ssl.create_default_context();ctx.set_alpn_protocols(['h2','http/1.1'])
            with socket.create_connection(('127.0.0.1',443),timeout=15) as conn:
                with ctx.wrap_socket(conn,server_hostname='coin-desk.62.171.141.206.sslip.io') as tls:
                    negotiated=tls.selected_alpn_protocol()
            if negotiated!='h2': raise ValueError('HTTP/2 negotiation failed')
        except BaseException:
            target.write_text(before)
            subprocess.run(['nginx','-t'],check=True)
            subprocess.run(['systemctl','reload','nginx'],check=True)
            raise
        report={'changed':before!=after,'alpn':negotiated,'checkedAt':stamp,'upstreamsChanged':False,'collectorsRestarted':False}
        (audit/('http2-'+stamp+'.json')).write_text(json.dumps(report,indent=2))
        print(json.dumps(report))


if __name__=='__main__': apply()
