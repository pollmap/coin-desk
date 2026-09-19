"""Compare every published reference observation with the retained Coin Metrics raw source."""
import argparse, datetime as dt, json, math, pathlib, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:8787');args=parser.parse_args()
reports=[]
for asset in ['BTC','DOGE','ETH','XRP','LINK']:
    raw=json.loads((ROOT/f'work/reference/{asset}.raw.json').read_text(encoding='utf-8'))
    audit=json.loads((ROOT/f'work/reference/{asset}.audit.json').read_text(encoding='utf-8'))
    expected={int(dt.datetime.fromisoformat(p['time'].replace('Z','+00:00')).timestamp()):float(p['PriceUSD']) for p in raw['data'] if p.get('PriceUSD') is not None and dt.datetime.fromisoformat(p['time'].replace('Z','+00:00')).timestamp()+86400<=audit['fetchedAt']}
    start=0; actual=[]; begin=time.monotonic(); meta=None
    for page in range(20):
        url=f'{args.base}/api/v1/reference?asset={asset}&limit=1000&from={start}'
        request=urllib.request.Request(url,headers={'User-Agent':'BTCDesk-Healthcheck/0.5','Accept':'application/json'})
        with urllib.request.urlopen(request,timeout=30) as response:body=json.load(response)
        assert body['price']==[], 'No synthetic exchange or estimated overlay'
        assert body['meta']['unit']=='USD' and 'Coin Metrics' in body['meta']['source']
        actual+=body['data'];meta=body['meta']
        next_cursor=body['nextCursor']
        if next_cursor is None:break
        assert next_cursor>start;start=next_cursor
    else:raise ValueError('History pagination did not terminate')
    times=[p['time'] for p in actual];assert times==sorted(set(times))
    got={p['time']:p['value'] for p in actual}
    assert set(expected).issubset(got), 'Missing retained source dates'
    assert all(math.isclose(v,got[t],rel_tol=1e-12,abs_tol=1e-14) for t,v in expected.items()), 'Source mismatch'
    result={'asset':asset,'verifiedSourceRows':len(expected),'publishedRows':len(actual),'first':audit['first'],'lastSourceDate':audit['last'],'strictTimeOrder':True,'allRetainedValuesMatch':True,'sourceSha256':audit['sha256'],'seconds':round(time.monotonic()-begin,3),'meta':meta}
    reports.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
report={'verifiedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'base':args.base,'assets':reports}
(ROOT/'work/reference-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
