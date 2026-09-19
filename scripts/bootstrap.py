"""Free upstream data -> resumable raw snapshots -> validated D1 seed SQL.
No credentials needed. Never calls trading or account endpoints.
"""
import argparse, datetime as dt, gzip, json, math, pathlib, time, urllib.request, urllib.parse

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'; RAW=WORK/'raw'; RAW.mkdir(parents=True,exist_ok=True)
BASE=['date','price','market_cap','realized_cap','mvrv','sth_mvrv','lth_mvrv','realized_price','sth_realized_price','nupl','sopr_24h']
ASSETS=['BTC','ETH','DOGE','SOL','XRP','LINK','ONDO','PEPE']
NOW=int(time.time()); DAY=86400
FETCHED={}

def get_json(url):
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'BTC-Desk/0.1 research-dashboard'})
            with urllib.request.urlopen(req,timeout=45) as r:return json.load(r)
        except Exception as exc:
            if attempt==4:raise
            print('retry',attempt+1,type(exc).__name__,flush=True);time.sleep(min(30,2**attempt+1))

def snapshot(name,url,refresh=False):
    file=RAW/(name+'.json.gz')
    if file.exists() and not refresh:
        with gzip.open(file,'rt',encoding='utf-8') as f:cached=json.load(f)
        if int(time.time())-cached['fetched_at']<3600:return cached
    data=get_json(url)
    with gzip.open(file,'wt',encoding='utf-8') as f:json.dump({'url':url,'fetched_at':int(time.time()),'data':data},f,ensure_ascii=False)
    return {'url':url,'fetched_at':int(time.time()),'data':data}

def iso(t):return dt.datetime.fromtimestamp(t,dt.timezone.utc).isoformat().replace('+00:00','Z')
def stamp(s):return int(dt.datetime.fromisoformat(s.replace('Z','+00:00')).replace(tzinfo=dt.timezone.utc).timestamp())
def quote(v):
    if v is None:return 'NULL'
    if isinstance(v,(float,int)):
        if not math.isfinite(v):return 'NULL'
        return repr(v)
    return "'"+str(v).replace("'","''")+"'"
def statement(table,columns,values):return 'INSERT OR REPLACE INTO '+table+' ('+','.join(columns)+') VALUES ('+','.join(quote(v) for v in values)+');\n'
def validate(c):
    t,o,h,l,close,vol,end=c
    assert t>0 and all(math.isfinite(v) for v in c)
    assert min(o,l,close)>0 and h>=max(o,close) and l<=min(o,close) and vol>=0

def prices(asset,market,interval,refresh):
    step=DAY if interval=='1d' else 3600
    start=0 if interval=='1d' else (NOW//3600-90*24)*3600
    out={}; cursor=start if market=='binance' else NOW;page=0
    while True:
        if market=='binance':
            url='https://data-api.binance.vision/api/v3/klines?'+urllib.parse.urlencode({'symbol':asset+'USDT','interval':interval,'startTime':cursor*1000,'limit':1000})
        else:
            endpoint='days' if interval=='1d' else 'minutes/60'
            url='https://api.upbit.com/v1/candles/'+endpoint+'?'+urllib.parse.urlencode({'market':'KRW-'+asset,'count':200,'to':iso(cursor)})
        snap=snapshot(asset+'-'+market+'-'+interval+'-'+str(cursor),url,refresh); rows=snap['data']
        if not isinstance(rows,list):raise ValueError(str(rows)[:300])
        if not rows:break
        for row in rows:
            if market=='binance':
                t=int(row[0])//1000;c=[t,*map(float,row[1:6]),t+step]
            else:
                t=stamp(row['candle_date_time_utc']);c=[t,row['opening_price'],row['high_price'],row['low_price'],row['trade_price'],row['candle_acc_trade_volume'],t+step]
            validate(c)
            if t>=start:out[t]=c;FETCHED[(asset,market,interval,t)]=snap['fetched_at']
        next_cursor=(max(out)+step) if market=='binance' else min(stamp(r['candle_date_time_utc']) for r in rows)
        page+=1
        if market=='binance' and (len(rows)<1000 or next_cursor>=NOW):break
        if market=='upbit' and (len(rows)<200 or next_cursor<=start):break
        if next_cursor==cursor:raise RuntimeError('Pagination did not advance')
        cursor=next_cursor;time.sleep(.16)
    print(asset,market,interval,len(out),'candles',flush=True)
    return sorted(out.values())

def onchain(refresh):
    out=[];versions=None;n=0;mean=0.;m2=0.;max_identity_error=0.;day=0
    while True:
        url='https://bitview.space/api/series/bulk?'+urllib.parse.urlencode({'series':','.join(BASE),'index':'day1','start':day,'limit':512})
        snap=snapshot('bitview-'+str(day),url,refresh); bulk=snap['data']
        if not isinstance(bulk,list) or len(bulk)!=len(BASE):raise ValueError(str(bulk)[:300])
        lengths={len(s['data']) for s in bulk};starts={s['start'] for s in bulk}
        if len(lengths)!=1 or len(starts)!=1:raise ValueError('Bitview series are not aligned')
        current_versions={key:s['version'] for key,s in zip(BASE,bulk)}
        if versions is not None and versions!=current_versions:raise ValueError('Source changed during collection. Repeat with --refresh.')
        versions=current_versions
        if not bulk[0]['data']:break
        for index,date in enumerate(bulk[0]['data']):
            t=stamp(date)
            if t+DAY>NOW:continue
            values={key:bulk[j]['data'][index] for j,key in enumerate(BASE) if key!='date'}
            values={k:v if isinstance(v,(int,float)) and math.isfinite(v) else None for k,v in values.items()}
            mc,rc=values['market_cap'],values['realized_cap'];z=None
            if mc and rc and mc>0 and rc>0:
                n+=1;delta=mc-mean;mean+=delta/n;m2+=delta*(mc-mean)
                if n>=365 and m2>0:z=(mc-rc)/math.sqrt(m2/n)
                if values['mvrv'] and values['mvrv']>0:max_identity_error=max(max_identity_error,abs(mc/rc-values['mvrv'])/values['mvrv'])
            values['mvrv_source']=values['mvrv'];values['nupl_source']=values['nupl']
            values['mvrv']=mc/rc if mc and rc and mc>0 and rc>0 else None
            values['nupl']=(mc-rc)/mc if mc and rc and mc>0 and rc>0 else None
            values['mvrv_z']=z
            out.append((t,values,n,mean,m2))
            FETCHED[('bitview',t)]=snap['fetched_at']
        print('Bitview',len(out),'days',flush=True)
        if len(bulk[0]['data'])<512:break
        day=bulk[0]['end'];time.sleep(.2)
    return out,versions,max_identity_error

def main():
    p=argparse.ArgumentParser();p.add_argument('--assets',default='BTC');p.add_argument('--refresh',action='store_true');p.add_argument('--prices-only',action='store_true');a=p.parse_args()
    assets=a.assets.upper().split(',')
    if any(x not in ASSETS for x in assets):raise ValueError('Unknown asset')
    report={'checkedAt':iso(NOW),'assets':assets,'prices':{},'onchain':{}}
    sql=[];samples=[]
    for asset in assets:
        for market in ['binance','upbit']:
            for interval in ['1d','1h']:
                rows=prices(asset,market,interval,a.refresh)
                for c in rows:sql.append(statement('candles',['asset','market','interval','time','open','high','low','close','volume','close_time','fetched_at'],[asset,market,interval,*c,FETCHED[(asset,market,interval,c[0])]]))
                key=asset+':'+market+':'+interval
                report['prices'][key]={'rows':len(rows),'first':iso(rows[0][0]) if rows else None,'last':iso(rows[-1][0]) if rows else None}
                if rows:
                    fetched=FETCHED[(asset,market,interval,rows[-1][0])]
                    history={'asset':asset,'market':market,'interval':interval,'rows':len(rows),'first':rows[0][0],'last':rows[-1][0],'fetched':fetched}
                    sql.append(statement('state',['key','value'],['history:'+key,json.dumps(history)]))
                    sql.append(statement('ingestion',['key','last_attempt','last_success','data_as_of'],[key,fetched,fetched,rows[-1][0]]))
                    samples.append({'asset':asset,'market':market,'interval':interval,'rows':rows[-500:]})
    if not a.prices_only:
        rows,versions,error=onchain(a.refresh);gen='bootstrap-'+str(NOW)
        for t,values,n,mean,m2 in rows:sql.append(statement('onchain',['generation','time','data','n','mean','m2','fetched_at'],[gen,t,json.dumps(values,separators=(',',':')),n,mean,m2,FETCHED[('bitview',t)]]))
        calculation_start=next((t for t,v,n,*_ in rows if n==1),None)
        for key,value in {'onchain_generation':gen,'onchain_versions':versions,'onchain_history_start':rows[0][0],'onchain_calculation_start':calculation_start}.items():sql.append(statement('state',['key','value'],[key,json.dumps(value)]))
        fetched=FETCHED[('bitview',rows[-1][0])]
        sql.append(statement('ingestion',['key','last_attempt','last_success','data_as_of'],['bitview',fetched,fetched,rows[-1][0]]))
        report['onchain']={'rows':len(rows),'first':iso(rows[0][0]),'last':iso(rows[-1][0]),'calculationStart':iso(calculation_start) if calculation_start else None,'versions':versions,'maxRawMvrvRelativeDifference':error,'rawDifferenceReason':'Raw MVRV uses rounded realized prices. Display uses market cap / realized cap. Raw values preserved.','calculation':'expanding population standard deviation, minimum 365 valid samples'}
        (WORK/'onchain-validation.json').write_text(json.dumps([{'time':t,**v} for t,v,*_ in rows],separators=(',',':')),encoding='utf-8')
    (WORK/'seed.sql').write_text(''.join(sql),encoding='utf-8')
    (WORK/'bootstrap-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (WORK/'price-validation.json').write_text(json.dumps(samples,ensure_ascii=False),encoding='utf-8')
    print('Wrote',len(sql),'statements. Check D1 daily write quota before remote import.',flush=True)

if __name__=='__main__':main()
