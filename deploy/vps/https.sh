#!/usr/bin/env bash
set -euo pipefail
root=/srv/services/coin-desk
acme_root=/var/www/coin-desk-acme
host=${1:?Pass a DNS-verified hostname}; port=${2:?Pass the verified port}
[[ "$host" =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ && "$host" != *..* && ${#host} -lt 254 ]] || exit 2
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1024 && "$port" -le 65535 ]] || exit 2
test -d "$root/shared/secrets"
command -v certbot >/dev/null
nginx -t
python3 - "$host" <<'PY'
import socket,sys
assert '62.171.141.206' in {x[4][0] for x in socket.getaddrinfo(sys.argv[1],80)}, 'DNS is not the authorized VPS'
PY
target=/etc/nginx/sites-available/coin-desk.conf
link=/etc/nginx/sites-enabled/coin-desk.conf
test ! -e "$target" && test ! -e "$link"
# Reject an existing host owner without dumping unrelated Nginx configurations.
HOSTNAME_TO_CHECK="$host" python3 - <<'PY'
import os,pathlib,re
host=os.environ['HOSTNAME_TO_CHECK']
for path in pathlib.Path('/etc/nginx/sites-enabled').iterdir():
 if path.is_file():
  for names in re.findall(r'server_name\s+([^;]+);',path.read_text()):
   assert host not in names.split(), 'Hostname already belongs to another service'
PY
# /srv/services may intentionally be root-only on a shared VPS. Give Nginx
# a dedicated public challenge directory without widening that parent access.
test ! -L "$acme_root"
install -d -m 755 "$acme_root"
mkdir -p "$root/audit/nginx"
backup="$root/audit/nginx/pre-coin-desk-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -czf "$backup" -C /etc/nginx sites-available sites-enabled
chmod 600 "$backup"
cat > "$target" <<EOF
# Managed by Coin Desk: project-only HTTPS provisioning
server {
 listen 80;
 server_name $host;
 location /.well-known/acme-challenge/ { root $acme_root; }
 location / { return 503; }
}
EOF
ln -s "$target" "$link"
rollback() { rm -f -- "$link" "$target"; nginx -t && systemctl reload nginx; }
trap rollback ERR
nginx -t; systemctl reload nginx
certbot certonly --webroot -w "$acme_root" -d "$host" --cert-name coin-desk --non-interactive --agree-tos --register-unsafely-without-email
cat > "$target" <<EOF
# Managed by Coin Desk: project-only route
server {
 listen 80;
 server_name $host;
 location /.well-known/acme-challenge/ { root $acme_root; }
 location / { return 301 https://\$host\$request_uri; }
}
server {
 listen 443 ssl http2;
 server_name $host;
 ssl_certificate /etc/letsencrypt/live/coin-desk/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/coin-desk/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 client_max_body_size 1m;
 gzip on; gzip_types application/json text/css text/javascript application/javascript;
 location = /api/v1/quotes/stream {
  proxy_pass http://127.0.0.1:$port;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off; proxy_cache off; gzip off;
  proxy_read_timeout 60s;
 }
 location / {
  proxy_pass http://127.0.0.1:$port;
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_connect_timeout 5s; proxy_read_timeout 30s;
 }
}
EOF
nginx -t; systemctl reload nginx
python3 - "$host" <<'PY'
import json,urllib.request,sys
with urllib.request.urlopen('https://'+sys.argv[1]+'/healthz',timeout=20) as r: assert json.load(r)['ok']
PY
trap - ERR
printf 'HTTPS certificate and route verified. current is not promoted.\n'
