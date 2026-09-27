"""Read official account-wide D1 daily totals, never sum a limited insights list.
Uses existing Wrangler OAuth or CLOUDFLARE_API_TOKEN without printing credentials.
"""
import argparse, datetime as dt, json, os, pathlib, tomllib, urllib.request

def collect(account, day, deployed_at):
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:
        base = pathlib.Path(os.environ['APPDATA']) / 'xdg.config' if os.name == 'nt' else pathlib.Path.home() / '.config'
        token = tomllib.loads((base / '.wrangler/config/default.toml').read_text())['oauth_token']
    query = '''query($account: string!, $day: Date!) { viewer { accounts(filter:{accountTag:$account}) {
      d1AnalyticsAdaptiveGroups(limit:10,filter:{date:$day}) { dimensions {date} sum {rowsRead rowsWritten} }
    } } }'''
    request = urllib.request.Request('https://api.cloudflare.com/client/v4/graphql',
        data=json.dumps({'query':query,'variables':{'account':account,'day':day}}).encode(),
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    response = json.load(urllib.request.urlopen(request, timeout=30))
    if response.get('errors'): raise RuntimeError('Official D1 daily metrics unavailable: ' + json.dumps(response['errors']))
    rows = response['data']['viewer']['accounts'][0]['d1AnalyticsAdaptiveGroups']
    if len(rows) != 1: raise RuntimeError('Expected one complete account/date aggregation, got ' + str(len(rows)))
    total = rows[0]['sum']
    if any(total.get(k) is None for k in ['rowsRead', 'rowsWritten']): raise RuntimeError('Daily totals absent')
    start = dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc)
    end = start + dt.timedelta(days=1)
    now = dt.datetime.now(dt.timezone.utc)
    deployed = dt.datetime.fromisoformat(deployed_at.replace('Z','+00:00'))
    return {'checkedAt':now.isoformat(),'dayUTC':day,'scope':'entire Cloudflare account',
        'source':'https://developers.cloudflare.com/d1/observability/metrics-analytics/',
        'rowsRead':total['rowsRead'],'rowsWritten':total['rowsWritten'],
        'limits':{'rowsRead':5000000,'rowsWritten':100000},
        'withinLimits':total['rowsRead'] < 5000000 and total['rowsWritten'] < 100000,
        'fullDayAfterDeployment':deployed <= start and now >= end + dt.timedelta(hours=1),
        'deployedAt':deployed_at,'operationalSignoff':False,
        'note':'Usage alone does not prove successful collection. Verify source freshness, cron completion and the next briefing separately.'}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', required=True)
    parser.add_argument('--day', required=True)
    parser.add_argument('--deployed-at', required=True)
    parser.add_argument('--output', type=pathlib.Path)
    args=parser.parse_args()
    report=collect(args.account,args.day,args.deployed_at)
    text=json.dumps(report,indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(text,encoding='utf-8')
    print(text)
