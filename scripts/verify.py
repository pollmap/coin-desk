"""Independent standard-library calculations and real-data audit; no paid APIs."""
import json, math, pathlib, statistics, sqlite3, datetime

ROOT=pathlib.Path(__file__).resolve().parents[1]
def technical(values):
    # Reference uses direct windows / statistics, not the JS sliding sums.
    result={'sma128':[],'sma200':[],'sma365':[],'bb':[],'rsi':[]}
    for n in (128,200,365):
        result['sma'+str(n)]=[statistics.mean(values[i-n+1:i+1]) for i in range(n-1,len(values))]
    result['bb']=[{'middle':statistics.mean(values[i-19:i+1]),'upper':statistics.mean(values[i-19:i+1])+2*statistics.pstdev(values[i-19:i+1]),'lower':statistics.mean(values[i-19:i+1])-2*statistics.pstdev(values[i-19:i+1])} for i in range(19,len(values))]
    deltas=[b-a for a,b in zip(values,values[1:])]
    if len(deltas)>=14:
        gain=statistics.mean(max(x,0) for x in deltas[:14]);loss=statistics.mean(max(-x,0) for x in deltas[:14])
        for i in range(14,len(deltas)+1):
            if i>14:gain=(gain*13+max(deltas[i-1],0))/14;loss=(loss*13+max(-deltas[i-1],0))/14
            result['rsi'].append(100 if loss==0 and gain>0 else 50 if gain==loss==0 else 100-100/(1+gain/loss))
    return result

def main():
    cases=[]
    samples=json.loads((ROOT/'work/price-validation.json').read_text(encoding='utf-8'))
    for name,values in [('rise',list(range(1,421))),('fall',list(range(420,0,-1))),('flat',[100.]*420),('wave',[100+i*.17+8*math.sin(i/9) for i in range(420)])]+[(s['asset']+'-'+s['market']+'-'+s['interval'],[row[4] for row in s['rows']]) for s in samples]:
        cases.append({'name':name,'values':values,'expected':technical(values)})
    directory=ROOT/'tests/fixtures';directory.mkdir(parents=True,exist_ok=True)
    (directory/'python-reference.json').write_text(json.dumps(cases,separators=(',',':')),encoding='utf-8')
    chain=json.loads((ROOT/'work/onchain-validation.json').read_text(encoding='utf-8'))
    caps=[];zerrors=[];mvrverrors=[];rawerrors=[];rawpost2015=[];zfixtures=[]
    for row in chain:
        mc,rc=row['market_cap'],row['realized_cap']
        if not mc or not rc or min(mc,rc)<=0:
            assert row['mvrv'] is None and row['mvrv_z'] is None
            continue
        caps.append(mc)
        mvrverrors.append(abs(row['mvrv']-mc/rc))
        assert abs(row['nupl']-(mc-rc)/mc)<1e-12
        if row.get('mvrv_source'):
            err=abs(row['mvrv_source']-mc/rc)/row['mvrv_source'];rawerrors.append(err)
            if row['time']>=1420070400:rawpost2015.append(err)
        if len(caps)>=365:
            sd=statistics.pstdev(caps)
            expected=(mc-rc)/sd if sd else None
            assert expected is None or math.isclose(row['mvrv_z'],expected,rel_tol=1e-11,abs_tol=1e-11)
            if expected is not None:zerrors.append(abs(row['mvrv_z']-expected))
            if len(caps)%500==0 or row is chain[-1]:zfixtures.append({'index':chain.index(row),'expected':expected})
    (directory/'z-reference.json').write_text(json.dumps({'rows':[[r['market_cap'],r['realized_cap']] for r in chain],'checkpoints':zfixtures},separators=(',',':')),encoding='utf-8')
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'technicalCases':len(cases),'onchainRows':len(chain),'validCapitalDays':len(caps),'zComparedDays':len(zerrors),'maxZAbsoluteError':max(zerrors,default=0),'maxComputedMvrvAbsoluteError':max(mvrverrors,default=0),'maxRawMvrvRelativeDifference':max(rawerrors,default=0),'maxRawMvrvRelativeDifferenceSince2015':max(rawpost2015,default=0),'rawDifferenceExplanation':'Source MVRV uses rounded realized-price ratios. Display MVRV/NUPL recomputed from the source capitalization series; raw fields preserved.'}
    if (ROOT/'work/local.sqlite').exists():
        db=sqlite3.connect(ROOT/'work/local.sqlite')
        report['localDatabaseBytes']=(ROOT/'work/local.sqlite').stat().st_size
        report['sqliteIntegrity']=db.execute('PRAGMA integrity_check').fetchone()[0]
        report['priceRows']=db.execute('SELECT COUNT(*) FROM candles').fetchone()[0]
        report['invalidOHLC']=db.execute('SELECT COUNT(*) FROM candles WHERE high<MAX(open,close) OR low>MIN(open,close) OR volume<0 OR low<=0').fetchone()[0]
        assert report['sqliteIntegrity']=='ok' and report['invalidOHLC']==0
        db.close()
    (ROOT/'work/independent-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
