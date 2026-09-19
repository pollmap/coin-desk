"""Read-only deployment smoke check and optional 48-hour observation log."""
import argparse, datetime as dt, json, math, pathlib, time, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
def get(base,path,allow_unhealthy=False):
    started=time.perf_counter()
    request=urllib.request.Request(base.rstrip('/')+'/api/v1/'+path,headers={'User-Agent':'BTCDesk-Healthcheck/0.1','Accept':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=25) as response:data=json.load(response)
    except urllib.error.HTTPError as error:
        if not allow_unhealthy or error.code!=503:raise
        data=json.load(error)
    return data,round((time.perf_counter()-started)*1000,1)
def quote_issues(payload, asset, market, now):
    """Validate source timestamps as well as the collector's freshness flag."""
    issues=[];prefix=asset+':'+market
    q=payload.get('quote');meta=payload.get('meta',{})
    if not q:return [prefix+' quote unavailable']
    if meta.get('stale'):issues.append(prefix+' quote stale')
    if q.get('asset')!=asset or meta.get('market')!=market:issues.append(prefix+' selection mismatch')
    for key in ['price','volume24h','high24h','low24h','time']:
        value=q.get(key)
        if not isinstance(value,(int,float)) or not math.isfinite(value):issues.append(prefix+' invalid '+key)
    change=q.get('change24h')
    if change is None:
        if market!='upbit' or not isinstance(q.get('changeUnavailableReason'),str) or not q['changeUnavailableReason'].strip():issues.append(prefix+' unexplained missing 24h change')
    elif not isinstance(change,(int,float)) or not math.isfinite(change) or change<=-100:issues.append(prefix+' invalid change24h')
    if not issues:
        if not 0<q['low24h']<=q['price']<=q['high24h'] or q['volume24h']<0:issues.append(prefix+' invalid range or volume')
        if not -60<=now-q['time']<=300:issues.append(prefix+' trade timestamp unavailable or stale')
    if meta.get('unit')!=('KRW' if market=='upbit' else 'USDT') or not meta.get('source'):issues.append(prefix+' missing provenance')
    return issues
def check(base):
    now=int(time.time());latency={};issues=[];warnings=[]
    def inspect_quote(payload,asset,market):
        issues.extend(quote_issues(payload,asset,market,int(time.time())))
        quote=payload.get('quote') or {}
        if quote.get('change24h') is None and quote.get('changeUnavailableReason'):
            warnings.append({'asset':asset,'market':market,'field':'change24h','reason':quote['changeUnavailableReason'],'referenceAt':quote.get('referenceAt')})
    status,latency['status']=get(base,'status')
    overview,latency['overview']=get(base,'overview')
    candles,latency['candles']=get(base,'candles?limit=30&from='+str(now-31*86400))
    metrics,latency['metrics']=get(base,'metrics')
    assert len(metrics['data'])==8,'metric catalog incomplete'
    assert status['assets']==['BTC'] or 'BTC' in status['assets'],'BTC disabled'
    rows=candles['data'];assert rows,'no candles'
    assert all(a['time']<b['time'] for a,b in zip(rows,rows[1:])),'unordered candles'
    assert all(r['low']<=min(r['open'],r['close']) and r['high']>=max(r['open'],r['close']) and r['volume']>=0 for r in rows),'invalid OHLCV'
    inspect_quote(overview,'BTC','binance')
    krw,latency['overviewKRW']=get(base,'overview?market=upbit')
    inspect_quote(krw,'BTC','upbit')
    for market in ['binance','upbit']:
        hour,latency[market+'1h']=get(base,'candles?market='+market+'&interval=1h&limit=30&from='+str(now-30*3600))
        if not hour['data'] or hour['meta']['stale']:issues.append(market+' candles unavailable or stale')
    for state in status['sources']:
        if state['key']=='maintenance' or state.get('active') is False or state['key'].startswith('quote:'):continue
        if state['error']:issues.append(state['key']+' collection error')
        max_age=max(7200,(state.get('expectedCadenceSeconds') or 3600)+3600)
        if not state['last_success'] or now-state['last_success']>max_age:issues.append(state['key']+' collector overdue')
        source_lag=state.get('dataFreshnessLimitSeconds') or (3*86400 if state['key'] in ['bitview','defillama'] or state['key'].startswith('reference:') else 2*86400 if state['key'].endswith(':1d') else 7200)
        if not state.get('data_as_of') or now-state['data_as_of']>source_lag:issues.append(state['key']+' source data overdue')
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
            inspect_quote(current,asset,market)
    dominance,latency['dominance']=get(base,'dominance')
    if dominance['stale'] or dominance.get('warning') or len(dominance['coins'])!=11:issues.append('dominance unavailable, incomplete or stale')
    for coin in dominance['coins']:
        value=coin.get('value');cap=coin.get('marketCap');total=dominance.get('totalMarketCap')
        if not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<=value<=100:issues.append(coin['id']+' invalid dominance')
        elif not cap or not total or abs(value-100*cap/total)>1e-8:issues.append(coin['id']+' dominance identity mismatch')
    health,latency['health']=get(base,'health',allow_unhealthy=True)
    if not health.get('ok'):
        issues.extend(reason['code']+':'+reason['key'] for reason in health.get('reasons',[]))
        if not health.get('reasons'):issues.append('server automation health unavailable')
    return {'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'base':base,'ok':not issues,'issues':issues,'warnings':warnings,'latencyMs':latency,'sourceState':health.get('sources',status['sources']),'automation':health.get('automation'),'coverage':health.get('coverage'),'quoteAsOf':overview['meta']['dataAsOf'],'onchainAsOf':overview['metricsAsOf'],'dominanceAsOf':dominance['asOf'],'dominanceSource':dominance['source']}
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
