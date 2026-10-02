#!/usr/bin/env bash
# Only after final imported snapshot + verified freeze of ALL legacy project writers.
set -euo pipefail
root=/srv/services/coin-desk
release_dir=$(pwd -P); release=$(basename "$release_dir")
host=${1:?Pass the verified HTTPS hostname}
[[ "$release" =~ ^vps-[a-f0-9]{16}$ && "$release_dir" == "$root/releases/$release" ]] || exit 2
[[ "$host" =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ && "$host" != *..* ]] || exit 2
python3 - "$root/audit/legacy-writers-frozen.json" <<'PY'
import json,sys,time
r=json.load(open(sys.argv[1]));assert r['allProjectWritersFrozen'] is True
assert r['includesOnDemandOverview'] is True and r['inflightDrained'] is True
assert r['finalExportSha256'] and r['productionSnapshotInstalled'] is True
assert 0<=time.time()-r['checkedAt']<3600
PY
envfile="$root/shared/secrets/$release.env"
test -f "$envfile"
docker compose --env-file "$envfile" -f deploy/vps/compose.yaml --profile collectors up -d --wait --wait-timeout 360
python3 deploy/vps/verify_runtime.py --base "https://$host" --database "$root/shared/data/coin-desk.sqlite" --observe-seconds 300 --output "$root/audit/$release/activated.json"
python3 deploy/vps/promote.py --release "$release" --hostname "$host"
