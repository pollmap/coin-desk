"""Keep only non-personal Worker CPU/outcome fields from wrangler tail JSON."""
import json, pathlib, sys, urllib.parse
log = pathlib.Path(__file__).resolve().parents[1] / 'work/runtime-metrics.jsonl'
log.parent.mkdir(exist_ok=True)
buf = ''
for line in sys.stdin:
    if not buf and not line.lstrip().startswith('{'):
        continue
    buf += line
    try:
        event = json.loads(buf)
    except json.JSONDecodeError:
        continue
    buf = ''
    row = {k: event.get(k) for k in ['eventTimestamp', 'cpuTime', 'wallTime', 'outcome']}
    detail = event.get('event', {}) or {}
    row['path'] = urllib.parse.urlparse(detail.get('request', {}).get('url', '')).path if 'request' in detail else 'cron'
    row['version'] = event.get('scriptVersion', {}).get('id')
    row['status'] = detail.get('response', {}).get('status')
    with log.open('a', encoding='utf-8') as f:
        f.write(json.dumps(row) + '\n')
    print(json.dumps(row), flush=True)
