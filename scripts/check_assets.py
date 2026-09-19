"""Compare deployed, paginated histories to independently collected exchange OHLCV.
Run bootstrap_assets.py first. This script performs bounded read-only requests.
"""
import argparse,json,pathlib,time,urllib.request,urllib.parse,concurrent.futures,math,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
def get(base,path):
 request=urllib.request.Request(base.rstrip('/')+'/api/v1/'+path,headers={'User-Agent':'CoinDesk-Validation/0.2','Accept':'application/json'})
 with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)
def verify(base,key,meta):
 asset,market,interval=key.split(':');raw=json.loads((ROOT/'work/assets'/(key.replace(':','-')+'.json')).read_text())
 start=0;out={};requests=0
 while True:
  result=get(base,'candles?'+urllib.parse.urlencode({'asset':asset,'market':market,'interval':interval,'limit':1000,'from':start}))
  requests+=1
  rows=result['data'];assert all(a['time']<b['time'] for a,b in zip(rows,rows[1:])),key+' ordering'
  for r in rows:out[r['time']]=[r[k] for k in ['time','open','high','low','close','volume','closeTime']]
  cursor=result['nextCursor']
  if cursor is None:break
  assert cursor>start and requests<15,key+' cursor';start=cursor
 assert out,key+' empty'
 expected=[r for r in raw if r[-1]<=meta['fetched'] and r[0]>=min(out)]
 max_error=0
 for row in expected:
  assert row[0] in out,key+' missing '+str(row[0])
  for actual,reference in zip(out[row[0]],row):
   error=abs(actual-reference);max_error=max(max_error,error)
   assert math.isclose(actual,reference,rel_tol=1e-11,abs_tol=1e-12),(key,row[0],actual,reference)
 return {'series':key,'matchedClosedCandles':len(expected),'maxAbsoluteDifference':max_error,'requests':requests,'historyStart':min(out)}
def main():
 p=argparse.ArgumentParser();p.add_argument('--base',required=True);a=p.parse_args()
 meta=json.loads((ROOT/'work/assets/report.json').read_text())['prices'];results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  jobs={pool.submit(verify,a.base,key,value):key for key,value in meta.items()}
  for job in concurrent.futures.as_completed(jobs):
   result=job.result();results.append(result);print(result['series'],result['matchedClosedCandles'],'matched',flush=True)
 summary={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base':a.base,'ok':True,'series':sorted(results,key=lambda r:r['series'])}
 (ROOT/'work/assets/public-verification.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
 print('All',len(results),'histories match source candles; total',sum(r['matchedClosedCandles'] for r in results),flush=True)
if __name__=='__main__':main()
