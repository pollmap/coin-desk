#!/usr/bin/env bash
# Run from a NEW /srv/services/coin-desk/releases/<release> checkout.
# Stages only a read-only API + backups. Collectors are intentionally a separate cutover.
set -euo pipefail
root=/srv/services/coin-desk
release_dir=$(pwd -P)
release=$(basename "$release_dir")
port=${1:?Pass the candidate loopback port}
[[ "$release" =~ ^vps-[a-f0-9]{16}$ && "$release_dir" == "$root/releases/$release" ]] || exit 2
[[ "$port" =~ ^[0-9]+$ ]] || exit 2
[[ ! -L "$root" && ! -L "$root/shared" && ! -L "$root/shared/data" ]] || exit 2
test -f release-manifest.json
test -f "$root/shared/data/coin-desk.sqlite"
test -f "$root/shared/data/coin-desk.import.json"
mkdir -p "$root/shared/secrets" "$root/backups" "$root/audit/$release"
chmod 700 "$root/shared/secrets" "$root/backups" "$root/audit"
python3 - "$root/shared/data/coin-desk.import.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['verified'] and r['migrationsAcknowledged']==9
assert r['imported']['tables']['reference_prices']['rows']>0
assert r['imported']['tables']['network_months']['rows']>0
PY
python3 - <<'PY'
import hashlib,json,pathlib
m=json.load(open('release-manifest.json'))
for name,wanted in m['files'].items():
 p=pathlib.Path(name);assert not p.is_absolute() and '..' not in p.parts and not p.is_symlink()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==wanted
PY
python3 deploy/vps/preflight.py --port "$port" > "$root/audit/$release/before.json"
chown 10001:10001 "$root/shared/data" "$root/shared/data/coin-desk.sqlite" "$root/backups"
chmod 700 "$root/shared/data"
chmod 600 "$root/shared/data/coin-desk.sqlite"
envfile="$root/shared/secrets/$release.env"
test ! -e "$envfile"
umask 077
printf 'COIN_DESK_ROOT=%s\nCOIN_DESK_IMAGE=coin-desk:%s\nCOIN_DESK_RELEASE=%s\nCOIN_DESK_PORT=%s\n' "$root" "$release" "$release" "$port" > "$envfile"
docker compose --env-file "$envfile" -f deploy/vps/compose.yaml config --quiet
docker build --tag "coin-desk:$release" .
test ! -L "$root/shared/assets"
mkdir -p "$root/shared/assets"
chmod 755 "$root/shared/assets"
docker run --rm --network none --read-only --entrypoint tar "coin-desk:$release" -C /app/dist/assets -cf - . | python3 deploy/vps/retain_assets.py "$root/shared/assets"
docker compose --env-file "$envfile" -f deploy/vps/compose.yaml up -d --wait --wait-timeout 360 api backup quote-hub
docker compose --env-file "$envfile" -f deploy/vps/compose.yaml exec -T api node server/upstream-check.mjs > "$root/audit/$release/upstream-probe.json"
python3 deploy/vps/verify_runtime.py --shadow --base "http://127.0.0.1:$port" --database "$root/shared/data/coin-desk.sqlite" --output "$root/audit/$release/shadow.json"
printf 'Shadow API verified. Collectors are OFF. current is not promoted.\n'
