"""Collect full Coin Metrics Community USD daily history without mixing exchanges.

Produces per-asset resumable SQL and source/audit files; does not mutate remote DB.
Community data attribution: Coin Metrics, CC BY-NC 4.0; noncommercial use only.
"""
import argparse, datetime as dt, hashlib, json, math, pathlib, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://community-api.coinmetrics.io/v4/timeseries/asset-metrics'
ASSETS=['BTC','DOGE','ETH','XRP','LINK']
def collect(asset,folder):
    url=BASE+'?assets='+asset.lower()+'&metrics=PriceUSD&frequency=1d&page_size=10000&start_time=2009-01-01&paging_from=start'
    request=urllib.request.Request(url,headers={'User-Agent':'CoinDesk/0.4 personal noncommercial dashboard'})
    with urllib.request.urlopen(request,timeout=40) as response:raw=response.read()
    data=json.loads(raw)
    if data.get('next_page_url'):raise ValueError('More than 10000 rows; pagination must be extended explicitly')
    now=int(time.time()); points=[]; seen=set(); nulls=0
    for row in data['data']:
        assert row['asset']==asset.lower()
        stamp=int(dt.datetime.fromisoformat(row['time'].replace('Z','+00:00')).timestamp())
        assert stamp%86400==0 and stamp not in seen
        seen.add(stamp)
        if row.get('PriceUSD') is None:nulls+=1;continue
        value=float(row['PriceUSD'])
        assert math.isfinite(value) and value>0
        if stamp+86400<=now:points.append((stamp,value))
    points.sort();assert points
    gaps=sum(b[0]-a[0]!=86400 for a,b in zip(points,points[1:]))
    (folder/(asset+'.raw.json')).write_bytes(raw)
    sql=[f"INSERT INTO reference_prices(asset,time,value,fetched_at) VALUES('{asset}',{t},{v!r},{now}) ON CONFLICT(asset,time) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at WHERE reference_prices.value!=excluded.value;" for t,v in points]
    sql.append(f"INSERT INTO ingestion(key,last_attempt,last_success,data_as_of,failures,error,next_attempt) VALUES('reference:{asset}',{now},{now},{points[-1][0]},0,NULL,0) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,data_as_of=excluded.data_as_of,failures=0,error=NULL,next_attempt=0;")
    (folder/(asset+'.sql')).write_text('\n'.join(sql)+'\n',encoding='utf-8')
    audit={'asset':asset,'source':BASE,'metric':'PriceUSD','unit':'USD','timeBasis':'UTC day closing price; timestamp labels that day','license':'CC BY-NC 4.0','rows':len(points),'first':dt.datetime.fromtimestamp(points[0][0],dt.timezone.utc).date().isoformat(),'last':dt.datetime.fromtimestamp(points[-1][0],dt.timezone.utc).date().isoformat(),'gapCount':gaps,'nullSourceValues':nulls,'fetchedAt':now,'sha256':hashlib.sha256(raw).hexdigest()}
    (folder/(asset+'.audit.json')).write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(audit,ensure_ascii=False),flush=True)
    return audit
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--assets',default=','.join(ASSETS));parser.add_argument('--output-dir',default='work/reference');args=parser.parse_args()
    folder=ROOT/args.output_dir;folder.mkdir(parents=True,exist_ok=True)
    for asset in args.assets.split(','):
        if asset not in ASSETS:raise ValueError('Unsupported reference asset')
        collect(asset,folder)
