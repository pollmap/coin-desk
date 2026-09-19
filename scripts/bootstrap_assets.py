"""Archive complete exchange histories with a small mutable tail to save D1 writes.
Keeps bootstrap.py BTC/onchain evidence intact. No mock or interpolated candles.
"""
import argparse, json, time
from bootstrap import ASSETS, WORK, FETCHED, prices, statement, iso

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--assets',default='DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE')
    p.add_argument('--refresh',action='store_true')
    a=p.parse_args(); assets=a.assets.upper().split(',')
    if any(x not in ASSETS for x in assets): raise ValueError('Unknown asset')
    out=WORK/'assets'; out.mkdir(exist_ok=True)
    report={'checkedAt':iso(int(time.time())), 'prices':{}, 'archiveChunkSize':256}
    for asset in assets:
        sql=[]
        for market in ['binance','upbit']:
            for interval in ['1d','1h']:
                rows=prices(asset,market,interval,a.refresh)
                if not rows: raise ValueError('Empty source '+asset+market+interval)
                fetched=FETCHED[(asset,market,interval,rows[-1][0])]
                for i in range(0,len(rows),256):
                    chunk=rows[i:i+256]
                    sql.append(statement('price_archive',['asset','market','interval','start','end','data','fetched_at'],[asset,market,interval,chunk[0][0],chunk[-1][-1],json.dumps(chunk,separators=(',',':')),fetched]))
                # Enough closed daily bars for dashboard RSI and 200-day average;
                # hourly history remains fully available from the archive.
                for c in rows[-(501 if interval=='1d' else 32):]:
                    sql.append(statement('candles',['asset','market','interval','time','open','high','low','close','volume','close_time','fetched_at'],[asset,market,interval,*c,FETCHED[(asset,market,interval,c[0])]]))
                key=asset+':'+market+':'+interval
                history={'asset':asset,'market':market,'interval':interval,'rows':len(rows),'first':rows[0][0],'last':rows[-1][0],'fetched':fetched,'archived':True}
                sql.append(statement('state',['key','value'],['history:'+key,json.dumps(history)]))
                sql.append(statement('ingestion',['key','last_attempt','last_success','data_as_of'],[key,fetched,fetched,rows[-1][0]]))
                report['prices'][key]=history
                (out/(key.replace(':','-')+'.json')).write_text(json.dumps(rows,separators=(',',':')),encoding='utf-8')
        (out/(asset+'.sql')).write_text(''.join(sql),encoding='utf-8')
        print(asset, 'ready:',len(sql),'SQL statements;',len(sql)*2,'conservative indexed writes',flush=True)
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__': main()
