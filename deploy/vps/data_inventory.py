"""Read-only, observation-level inventory. Never calls collection or overview APIs."""
import argparse, collections, datetime, json, math, pathlib, sqlite3, time, urllib.request

ASSETS = ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE']

def extent(times, step):
    times = sorted(set(times))
    return {'first': times[0] if times else None, 'last': times[-1] if times else None,
            'observations': len(times), 'expectedStepSeconds': step,
            'missingInternalSlots': sum(max(0, (b-a)//step-1) for a,b in zip(times,times[1:])) if step else None}

def inventory(database, base):
    db = sqlite3.connect(pathlib.Path(database).resolve().as_uri()+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    before = db.total_changes
    def query(sql, args=()): return [dict(r) for r in db.execute(sql,args)]
    def request(path):
        req=urllib.request.Request(base.rstrip('/')+path,headers={'User-Agent':'BoriChart-owned-data-audit/0.23'})
        with urllib.request.urlopen(req,timeout=30) as response: return json.load(response)
    groups=collections.defaultdict(list)
    # The active onchain generation is explicit; old revisions are retained, not merged.
    generation=db.execute("SELECT json_extract(value,'$') FROM state WHERE key='onchain_generation'").fetchone()
    if generation:
        for row in query('SELECT time,data FROM onchain WHERE generation=?',(generation[0],)):
            for metric,value in json.loads(row['data']).items():
                if isinstance(value,(int,float)) and math.isfinite(value): groups[('BTC','Bitview',metric,'USD' if metric in ['price','market_cap','realized_cap','realized_price','sth_realized_price'] else 'Z' if metric == 'mvrv_z' else 'ratio')].append(row['time'])
    rows=[]
    for (asset,source,metric,unit),times in groups.items():
        rows.append(dict(asset=asset,source=source,metric=metric,unit=unit,cadence='daily',**extent(times,86400)))
    for asset in ASSETS:
        catalog=request('/api/v1/network-catalog?asset='+asset)
        values=collections.defaultdict(list)
        for month in query('SELECT payload FROM network_months WHERE asset=?',(asset,)):
            for item in json.loads(month['payload']):
                for metric,value in item['values'].items():
                    if isinstance(value,(int,float)) and math.isfinite(value): values[metric].append(item['time'])
        for metric in catalog['data']:
            times=values[metric['id']]
            row=dict(asset=asset,source='Coin Metrics Community',metric=metric['id'],unit=metric['unit'],
                     cadence='daily',derived=bool(metric.get('derived')),formula=metric['formula'],**extent(times,86400))
            row['coverageIndexMatches']=row['observations']==metric['observations'] and row['first']==metric['firstObservation'] and row['last']==metric['lastObservation']
            rows.append(row)
        if not catalog['data']: rows.append(dict(asset=asset,source='Coin Metrics Community',metric='mvrv',support='unsupported',observations=0))
        ref=query('SELECT time FROM reference_prices WHERE asset=?',(asset,))
        rows.append(dict(asset=asset,source='Coin Metrics USD reference',metric='price',unit='USD',support='supported' if asset in ['BTC','DOGE','ETH','XRP','LINK'] else 'unsupported',cadence='daily',**extent([r['time'] for r in ref],86400)))
        for market,unit in [('binance','USDT'),('upbit','KRW')]:
            for interval,step in [('1h',3600),('1d',86400)]:
                times=[]
                for archive in query('SELECT data FROM price_archive WHERE asset=? AND market=? AND interval=?',(asset,market,interval)):
                    times.extend(r[0] for r in json.loads(archive['data']) if r[6] <= time.time())
                times.extend(r['time'] for r in query('SELECT time FROM candles WHERE asset=? AND market=? AND interval=? AND close_time<=?',(asset,market,interval,int(time.time()))))
                rows.append(dict(asset=asset,source=market,metric='OHLCV '+interval,unit=unit,cadence=interval,**extent(times,step)))
        for metric in ['funding','open_interest','long_account_ratio','open_interest_daily','long_account_ratio_daily']:
            times=[r['time'] for r in query('SELECT time FROM derivative_series WHERE asset=? AND metric=?',(asset,metric))]
            unit='%' if metric=='funding' else '%' if metric.startswith('long_account_ratio') else asset+' (PEPE normalized from 1000PEPE)' if asset=='PEPE' else asset
            rows.append(dict(asset=asset,source='Bybit USDT perpetual',metric=metric,unit=unit,
                             cadence='provider funding interval' if metric=='funding' else 'daily' if metric.endswith('_daily') else '1h',
                             **extent(times,None if metric=='funding' else 86400 if metric.endswith('_daily') else 3600)))
    ingestion=[]
    for r in query('SELECT key,last_attempt,last_success,data_as_of,failures,next_attempt,error FROM ingestion ORDER BY key'):
        # The error text can contain an upstream URL. Publish only absence/presence.
        r['hasError']=bool(r.pop('error')); ingestion.append(r)
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'writeChanges':db.total_changes-before,
            'scope':'Stored supported observations; internal gaps exclude leading/trailing unavailable history; no provider completeness claim',
            'rows':rows,'ingestion':ingestion,'budgetAndCursor':query("SELECT key,value FROM state WHERE key='budget:derivatives-backfill' OR key LIKE 'cursor:derivatives:%' OR key LIKE 'cursor:price-backfill:%' ORDER BY key")}
    db.close(); return report

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--database',required=True);parser.add_argument('--base',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();report=inventory(args.database,args.base)
    pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'rows':len(report['rows']),'writeChanges':report['writeChanges'],'coverageIndexMismatches':sum(r.get('coverageIndexMatches') is False for r in report['rows'])}))
