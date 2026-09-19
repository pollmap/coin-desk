"""Read-only deployment smoke check and optional 48-hour observation log."""
import argparse, datetime as dt, json, pathlib, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
def get(base,path):
    started=time.perf_counter()
    request=urllib.request.Request(base.rstrip('/')+'/api/v1/'+path,headers={'User-Agent':'BTCDesk-Healthcheck/0.1','Accept':'application/json'})
    with urllib.request.urlopen(request,timeout=25) as response:data=json.load(response)
    return data,round((time.perf_counter()-started)*1000,1)
def check(base):
    now=int(time.time());latency={};issues=[]
    status,latency['status']=get(base,'status')
    overview,latency['overview']=get(base,'overview')
    candles,latency['candles']=get(base,'candles?limit=30&from='+str(now-31*86400))
    metrics,latency['metrics']=get(base,'metrics')
    assert len(metrics['data'])==8,'metric catalog incomplete'
    assert status['assets']==['BTC'] or 'BTC' in status['assets'],'BTC disabled'
    rows=candles['data'];assert rows,'no candles'
    assert all(a['time']<b['time'] for a,b in zip(rows,rows[1:])),'unordered candles'
    assert all(r['low']<=min(r['open'],r['close']) and r['high']>=max(r['open'],r['close']) and r['volume']>=0 for r in rows),'invalid OHLCV'
    if not overview['quote'] or overview['meta']['stale']:issues.append('quote unavailable or stale')
    krw,latency['overviewKRW']=get(base,'overview?market=upbit')
    if not krw['quote'] or krw['meta']['stale']:issues.append('KRW quote unavailable or stale')
    for market in ['binance','upbit']:
        hour,latency[market+'1h']=get(base,'candles?market='+market+'&interval=1h&limit=30&from='+str(now-30*3600))
        if not hour['data'] or hour['meta']['stale']:issues.append(market+' candles unavailable or stale')
    for state in status['sources']:
        if state['key']=='maintenance' or state.get('active') is False or state['key'].startswith('quote:'):continue
        if state['error']:issues.append(state['key']+' collection error')
        max_age=8*3600 if state['key']=='defillama' else 7200
        if not state['last_success'] or now-state['last_success']>max_age:issues.append(state['key']+' collector overdue')
    if not overview['metricsAsOf'] or now-overview['metricsAsOf']>3*86400:issues.append('onchain more than three days behind')
    values=overview['metrics']
    if values.get('market_cap') and values.get('realized_cap'):
        assert abs(values['mvrv']-values['market_cap']/values['realized_cap'])<1e-10,'MVRV identity'
        assert abs(values['nupl']-(1-1/values['mvrv']))<1e-10,'NUPL identity'
    for metric in metrics['data']:
        data,latency[metric['id']]=get(base,'series?metric='+metric['id']+'&limit=10&from='+str(now-10*86400))
        assert data['data'],metric['id']+' unavailable'
        assert data['meta']['source']=='Bitview / BRK' and data['meta']['priceBasis'],'missing provenance'
        if data['meta']['stale']:issues.append(metric['id']+' stale')
    for asset in status['assets']:
        if asset=='BTC':continue
        for market in ['binance','upbit']:
            current,latency[asset+':'+market]=get(base,'overview?asset='+asset+'&market='+market)
            if not current['quote'] or current['meta']['stale']:issues.append(asset+':'+market+' quote unavailable or stale')
    dominance,latency['dominance']=get(base,'dominance')
    if dominance['stale'] or dominance.get('warning') or len(dominance['coins'])!=11:issues.append('dominance unavailable, incomplete or stale')
    return {'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'base':base,'ok':not issues,'issues':issues,'latencyMs':latency,'sourceState':status['sources'],'quoteAsOf':overview['meta']['dataAsOf'],'onchainAsOf':overview['metricsAsOf'],'dominanceAsOf':dominance['asOf'],'dominanceSource':dominance['source']}
def main():
    p=argparse.ArgumentParser();p.add_argument('--base',required=True);p.add_argument('--hours',type=float,default=0);p.add_argument('--interval',type=int,default=300);a=p.parse_args()
    if not a.base.startswith(('http://','https://')) or a.interval<60 or not 0<=a.hours<=48:raise ValueError('Invalid monitor options')
    log=ROOT/'work/observation.jsonl';log.parent.mkdir(exist_ok=True)
    deadline=time.monotonic()+a.hours*3600;failed=False
    while True:
        try:row=check(a.base)
        except Exception as exc:row={'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'base':a.base,'ok':False,'error':str(exc)}
        failed|=not row['ok']
        with log.open('a',encoding='utf-8') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(json.dumps(row,ensure_ascii=False),flush=True)
        if not a.hours or time.monotonic()>=deadline:break
        time.sleep(min(a.interval,max(0,deadline-time.monotonic())))
    if failed:raise SystemExit(1)
if __name__=='__main__':main()
