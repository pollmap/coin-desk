"""Inspect public API + SQLite scheduler progress without triggering collection."""
import argparse, json, pathlib, sqlite3, time, urllib.request, urllib.error

def request(base,path,shadow=False):
    try:
        response=urllib.request.urlopen(urllib.request.Request(base+path,headers={'User-Agent':'Coin-Desk-owned-runtime-verification/1.0'}),timeout=30)
    except urllib.error.HTTPError as error:
        # A stopped-collector shadow must retain its real source-delay status.
        # This exception never applies to active production verification.
        if not (shadow and path=='/api/v1/health' and error.code==503): raise
        response=error
    with response:
        data=json.load(response)
        if response.status==503 and (data.get('ok') is not False or not isinstance(data.get('reasons'),list)):
            raise ValueError('Shadow health failed without a source/automation diagnosis')
        data['_verificationHttpStatus']=response.status
        return data

def snapshot(path):
    db=sqlite3.connect(pathlib.Path(path).resolve().as_uri()+'?mode=ro',uri=True)
    try:
        return {'lanes':db.execute('SELECT lane,scheduled_at,completed_at,outcome FROM _coin_desk_runtime_runs ORDER BY lane,scheduled_at').fetchall(),
                'quotes':db.execute("SELECT key,last_success,data_as_of FROM ingestion WHERE key LIKE 'quote:%' ORDER BY key").fetchall(),
                'derivatives':db.execute("SELECT key,last_success,data_as_of FROM ingestion WHERE key LIKE 'derivatives:%' ORDER BY key").fetchall(),
                'budgetAndCursor':db.execute("SELECT key,value FROM state WHERE key='budget:derivatives-backfill' OR key LIKE 'cursor:derivatives:%' ORDER BY key").fetchall()}
    finally: db.close()

def verify(base,database,observe_seconds=0,shadow=False):
    if not (base.startswith('https://') or base.startswith('http://127.0.0.1:')): raise ValueError('Verify HTTPS or loopback only')
    if shadow and observe_seconds: raise ValueError('Shadow cannot claim active collection proof')
    report={'api':{},'collectedAt':int(time.time()),'observationSeconds':observe_seconds,'shadowOnly':shadow}
    for endpoint in ['/healthz','/api/v1/runtime','/api/v1/status','/api/v1/health','/api/v1/signals','/api/v1/briefings','/api/v1/market-derivatives','/api/v1/chain-context?asset=ETH&metric=tvl']:
        report['api'][endpoint]=request(base,endpoint,shadow)
    for asset in ['BTC','DOGE','ETH','SOL','XRP','LINK','ONDO','PEPE']:
        paths=['/api/v1/candles?asset='+asset+'&market=binance&limit=2','/api/v1/derivatives?asset='+asset+'&metric=funding&limit=2']
        if asset in ['BTC','DOGE','ETH','XRP','LINK']: paths.append('/api/v1/network?asset='+asset+'&metric=mvrv&limit=2')
        for endpoint in paths: report['api'][endpoint]=request(base,endpoint,shadow)
    if not report['api']['/healthz'].get('ok'): raise ValueError('Process/database health failed')
    for endpoint in ['/api/v1/network?asset=BTC&metric=mvrv&limit=2']:
        if not report['api'][endpoint].get('data'): raise ValueError('Imported BTC MVRV history is missing')
    report['before']=snapshot(database)
    if observe_seconds:
        if not 120<=observe_seconds<=600: raise ValueError('Use a 120–600 second natural collection sample')
        time.sleep(observe_seconds)
        report['after']=snapshot(database)
        before,after=report['before'],report['after']
        successful={lane:sum(1 for row in after['lanes'] if row[0]==lane and row[1]>report['collectedAt'] and row[3]=='ok') for lane in ['quotes','background','recent','analysis']}
        old={row[0]:row[1:] for row in before['quotes']};new={row[0]:row[1:] for row in after['quotes']}
        keys=['quote:'+asset+':'+market for asset in ['BTC','DOGE','ETH'] for market in ['binance','upbit']]
        quote_progress=all(key in old and key in new and new[key][0]>old[key][0] and new[key][1]>old[key][1] for key in keys)
        old_futures={row[0]:row[1:] for row in before['derivatives']};new_futures={row[0]:row[1:] for row in after['derivatives']}
        futures_progress=sum(1 for key,row in new_futures.items() if key in old_futures and row[0]>old_futures[key][0])
        report['progress']={'successfulLaneRuns':successful,'sixCoreQuotesAdvanced':quote_progress,'derivativeConfirmationsAdvanced':futures_progress,
                            'directCollectionOrOverviewCalled':False,'otherVisitorsAbsentGuaranteed':False}
        report['naturalProgressVerified']=min(successful.values())>=2 and quote_progress and futures_progress>=9
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base',required=True);parser.add_argument('--database',required=True)
    parser.add_argument('--observe-seconds',type=int,default=0);parser.add_argument('--output',required=True)
    parser.add_argument('--shadow',action='store_true')
    args=parser.parse_args()
    report=verify(args.base,args.database,args.observe_seconds,args.shadow)
    pathlib.Path(args.output).write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'readApis':len(report['api']),'observationSeconds':args.observe_seconds,'evidenceSaved':True}))
    if args.observe_seconds and not report['naturalProgressVerified']: raise SystemExit('Natural collection proof failed; evidence preserved and promotion refused')
