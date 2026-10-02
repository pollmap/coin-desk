#!/usr/bin/env bash
# Code-only rollback. Data restoration is a separate verified procedure.
set -euo pipefail
root=/srv/services/coin-desk
previous=${1:?Pass the previously verified release ID}
[[ "$previous" =~ ^vps-[a-f0-9]{16}$ ]] || exit 2
test -f "$root/releases/$previous/release-manifest.json"
test -f "$root/shared/secrets/$previous.env"
current=$(readlink -f "$root/current")
test -f "$current/release-manifest.json"
current_release=$(basename "$current")
recover_current() {
 cd "$current"
 docker compose --env-file "$root/shared/secrets/$current_release.env" -f deploy/vps/compose.yaml --profile collectors up -d --wait --wait-timeout 360
}
trap recover_current ERR
cd "$root/releases/$previous"
docker compose --env-file "$root/shared/secrets/$previous.env" -f deploy/vps/compose.yaml --profile collectors up -d --wait --wait-timeout 360
port=$(python3 - "$root/shared/secrets/$previous.env" <<'PY'
import re,sys
text=open(sys.argv[1]).read();match=re.search(r'^COIN_DESK_PORT=(\d+)$',text,re.M)
assert match and 1024<=int(match[1])<=65535;print(match[1])
PY
)
python3 deploy/vps/route_port.py --port "$port"
# Do not restore/delete SQLite here. Existing schema must pass that release's migration checksum check.
temporary="$root/.current-rollback"
test ! -e "$temporary" && test ! -L "$temporary"
ln -s "$root/releases/$previous" "$temporary"
mv -Tf "$temporary" "$root/current"
trap - ERR
printf 'Code rollback and HTTPS route verified; database history preserved.\n'
