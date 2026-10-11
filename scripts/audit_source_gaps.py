"""Read-only provider checks for internal gaps. Empty responses are not proof of no trading."""
import concurrent.futures, datetime, json, math, pathlib, sqlite3, time, urllib.parse, urllib.request

def utc(stamp):
    return datetime.datetime.fromtimestamp(stamp, datetime.timezone.utc).isoformat().replace('+00:00','Z')

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BoriChart-owned-gap-audit/0.30','Accept':'application/json'}),timeout=25) as response:
        return json.load(response)

def audit(database, registry, matrix, output):
    registry={a['id']:a for a in registry}
    db=sqlite3.connect(pathlib.Path(database).resolve().as_uri()+'?mode=ro',uri=True)
    jobs=[];now=int(time.time())
    try:
        db.execute('BEGIN')
        for row in matrix['rows']:
            if row['kind']!='candles' or not row['stored']['missingSlots']:continue
            asset,market,interval=row['asset'],row['source'],row['metric'];step=86400 if interval=='1d' else 3600
            points={}
            for payload, in db.execute('SELECT data FROM price_archive WHERE asset=? AND market=? AND interval=? ORDER BY start',(asset,market,interval)):
                for c in json.loads(payload):
                    if c[6]<=now:points[c[0]]=c[4]
            for stamp,close,end in db.execute('SELECT time,close,close_time FROM candles WHERE asset=? AND market=? AND interval=?',(asset,market,interval)):
                if end<=now:points[stamp]=close
                else:points.pop(stamp,None)
            stamps=sorted(points)
            for a,b in zip(stamps,stamps[1:]):
                if b-a<=step:continue
                for stamp in range(a+step,b,step):
                    previous=jobs[-1] if jobs else None
                    if previous and previous.get('asset')==asset and previous.get('source')==market and previous.get('metric')==interval and stamp-previous['from']<199*step:
                        previous['to']=stamp+step;previous['missingTimes'].append(stamp)
                    else:jobs.append({'kind':'candles','asset':asset,'source':market,'metric':interval,'from':stamp,'to':stamp+step,'step':step,'symbol':row['symbol'],'missingTimes':[stamp]})
        grouped={}
        for row in matrix['rows']:
            if row['kind']=='network' and row['gaps']:
                for gap in row['gaps']:
                    k=(row['asset'],gap['from'],gap['to'])
                    grouped.setdefault(k,[]).append(row['metric'])
        for (asset,start,end),metrics in grouped.items():jobs.append({'kind':'network','asset':asset,'source':'coinmetrics','metrics':metrics,'from':start,'to':end,'step':86400})
    finally:db.close()
    if len(jobs)>2000:raise ValueError('Bounded audit job limit exceeded')
    def probe(job):
        result={**job,'checkedAt':int(time.time())}
        try:
            if job['kind']=='network':
                fields=list(registry[job['asset']]['network']['metrics'])
                params={'assets':registry[job['asset']]['network']['id'],'metrics':','.join(fields),'frequency':'1d','start_time':utc(job['from']),'end_time':utc(job['to']-1),'page_size':10000}
                url='https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?'+urllib.parse.urlencode(params)
                data=get(url);rows=data.get('data');assert isinstance(rows,list)
                assert not data.get('next_page_url'), 'Unexpected paginated gap response'
                for r in rows:assert r['asset']==params['assets']
                result.update({'outcome':'provider_checked','raw':data,'requestedFields':fields})
            else:
                if job['source']=='upbit':
                    path='days' if job['metric']=='1d' else 'minutes/60'
                    params={'market':job['symbol'],'to':utc(job['to']),'count':min(200,(job['to']-job['from'])//job['step']+1)}
                    url='https://api.upbit.com/v1/candles/'+path+'?'+urllib.parse.urlencode(params)
                    data=get(url);assert isinstance(data,list)
                    stamps=[]
                    for r in data:
                        assert r['market']==job['symbol']
                        assert all(math.isfinite(float(r[k])) and float(r[k])>0 for k in ['opening_price','high_price','low_price','trade_price'])
                        stamps.append(int(datetime.datetime.fromisoformat(r['candle_date_time_utc']).replace(tzinfo=datetime.timezone.utc).timestamp()))
                else:
                    params={'symbol':job['symbol'],'interval':job['metric'],'startTime':job['from']*1000,'endTime':job['to']*1000-1,'limit':1000}
                    url='https://api.binance.com/api/v3/klines?'+urllib.parse.urlencode(params)
                    data=get(url);assert isinstance(data,list)
                    stamps=[]
                    for r in data:
                        assert len(r)>=7 and all(math.isfinite(float(r[i])) and float(r[i])>0 for i in [1,2,3,4])
                        stamps.append(int(r[0])//1000)
                observed=sorted(set(stamps).intersection(job['missingTimes']))
                assert all(s%job['step']==0 for s in observed)
                result.update({'outcome':'source_present_missing' if observed else 'provider_no_observation_at_check','sourceSlots':len(observed),'missingSlots':len(job['missingTimes']),'sourceTimes':observed,'raw':data})
            result['requestUrl']=url
        except Exception as error:result.update({'outcome':'unverified_request_or_validation','errorType':type(error).__name__})
        time.sleep(.25)
        return result
    report={'startedAt':now,'readOnly':True,'readOnlyChanges':0,'noSyntheticFills':True,'jobs':len(jobs),'rows':[]}
    output=pathlib.Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(probe,jobs):
            report['rows'].append(result)
            output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    report['completedAt']=int(time.time());output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'jobs':len(jobs),'completed':len(report['rows']),'sourcePresentRanges':sum(r['outcome']=='source_present_missing' for r in report['rows']),'unverified':sum(r['outcome'].startswith('unverified') for r in report['rows'])}))

if __name__=='__main__':
    import sys
    database,registry,matrix,output=sys.argv[1:]
    audit(database,json.loads(pathlib.Path(registry).read_text(encoding='utf-8')),json.loads(pathlib.Path(matrix).read_text(encoding='utf-8')),output)
