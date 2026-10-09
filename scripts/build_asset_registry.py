"""Build a frozen, source-backed universe. Public responses are cached outside Git."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import pathlib
import time
import urllib.request
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / 'work' / 'asset-registry'
CACHE.mkdir(parents=True, exist_ok=True)

def fetch(url, refresh=False):
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding='utf-8'))
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'BoriChart/0.25 (+https://coin-desk.pages.dev)'})
            with urllib.request.urlopen(req, timeout=35) as response:
                data = json.load(response)
            path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)

def main():
    upbit = {x['market'][4:]: x for x in fetch('https://api.upbit.com/v1/market/all?isDetails=true') if x['market'].startswith('KRW-')}
    binance = {x['baseAsset']: x for x in fetch('https://api.binance.com/api/v3/exchangeInfo')['symbols'] if x['quoteAsset'] == 'USDT' and x['status'] == 'TRADING' and x.get('isSpotTradingAllowed')}
    lore = []
    for start in range(0, 1500, 100):
        lore.extend(fetch(f'https://api.coinlore.net/api/tickers/?start={start}&limit=100')['data'])
        time.sleep(1)
    catalog = fetch('https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?page_size=10000')['data']
    bybit = []
    cursor = ''
    while True:
        page = fetch('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000' + ('&cursor=' + urllib.parse.quote(cursor) if cursor else ''))
        if page.get('retCode') != 0:
            raise ValueError('Bybit instrument response failed')
        bybit.extend(page['result']['list'])
        cursor = page['result'].get('nextPageCursor')
        if not cursor:
            break
    normalized = lambda s: ''.join(c for c in s.lower() if c.isalnum())
    excluded = {'WBTC','WETH','STETH','WSTETH','RETH','WEETH','CBETH','BTCB','BETH','JITOSOL','MSOL','BNSOL','WBETH','USDE','USDT','USDC','DAI','FDUSD','TUSD','USDD','USDP','USD1','USDS','RLUSD','BUSD','SUSD','PYUSD','USDD','EURC','USUALUSD','USDF','USDG','USDD'}
    excluded.update({'BFUSD', 'EURI', 'FRAX', 'GTC'})
    candidates = {}
    for x in lore:
        symbol = x['symbol'].upper()
        if symbol in excluded or symbol in candidates or symbol not in upbit and symbol not in binance:
            continue
        if not symbol.replace('_','').isalnum() or len(symbol) > 15 or float(x.get('market_cap_usd') or 0) <= 0:
            continue
        if any(w in x['name'].lower() for w in ['wrapped ', 'bridged ', 'staked ', '3x ', 'leveraged']):
            continue
        if symbol in upbit and normalized(upbit[symbol]['english_name']) != normalized(x['name']):
            # Explicit existing naming differences, never choose an arbitrary same-ticker token.
            if symbol not in {'ADA','XLM','HBAR','ICP','INJ','CRV','XRP','ONDO','POL','KAIA','NEAR','S','RENDER','APT','STX','WAXP','IOTA','A','G','VIRTUAL','ZRO','CRO','W','BTT','BEAM','ZK','IP','ME','BERA','OM','CORE'}:
                continue
        candidates[symbol] = x
    required = ['BTC','DOGE','ETH','SOL','XRP','LINK','ONDO','PEPE','PENGU']
    if any(x not in candidates for x in required):
        raise ValueError('Required asset missing: ' + str(set(required)-candidates.keys()))
    selected = list(required)
    for symbol in candidates:
        if len(selected) >= 100: break
        if symbol in upbit and symbol not in selected: selected.append(symbol)
    for symbol in candidates:
        if len(selected) >= 150: break
        if symbol in binance and symbol not in selected: selected.append(symbol)
    if len(selected) != 150: raise ValueError(f'Only {len(selected)} eligible assets')
    wanted = ['PriceUSD','CapMVRVCur','AdrActCnt','AdrBalCnt','TxCnt','TxTfrCnt','SplyCur','CapMrktCurUSD','FeeTotNtv','HashRate','BlkCnt','IssTotNtv','FlowInExNtv','FlowOutExNtv','SplyExNtv']
    cm_aliases = {'SHIB':'shib_eth','POL':'pol_eth','AVAX':'avaxc'}
    known = {'BTC':'btc','DOGE':'doge','ETH':'eth','XRP':'xrp','LINK':'link'}
    records = []
    evidence = []
    for i, symbol in enumerate(selected):
        x = candidates[symbol]
        # CoinLore markets bind provider ID to the exchange pair, not just a ticker.
        markets = fetch(f'https://api.coinlore.net/api/coin/markets/?id={x["id"]}')
        if isinstance(markets, dict): markets = markets.get('data', markets.get('markets', []))
        pair_verified = any('binance' in str(m.get('name', '')).lower() and str(m.get('base','')).upper() == symbol and str(m.get('quote','')).upper() == 'USDT' for m in markets)
        if symbol not in upbit and not pair_verified:
            evidence.append({'asset':symbol,'issue':'CoinLore Binance pair not in top markets','markets':markets[:2]})
        cm = next((a for a in catalog if a['asset'] == cm_aliases.get(symbol, symbol.lower())), None)
        mapping = None
        if cm:
            support = {}
            for metric in cm['metrics']:
                if metric['metric'] not in wanted: continue
                f = next((f for f in metric['frequencies'] if f['frequency']=='1d' and f.get('community') and f.get('max_time','') >= '2026-10-06'), None)
                if f: support[metric['metric']] = {'first':f['min_time'][:10], 'last':f['max_time'][:10]}
            if 'PriceUSD' in support:
                try:
                    raw = fetch('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets='+cm['asset']+'&metrics='+','.join(support)+'&frequency=1d&start_time=2026-10-05&end_time=2026-10-08&page_size=10')
                    actual = {m:s for m,s in support.items() if any(r.get(m) is not None for r in raw.get('data',[]))}
                    if 'PriceUSD' in actual:
                        mapping = {'id':cm['asset'],'metrics':actual}
                except Exception as e:
                    evidence.append({'asset':symbol,'issue':'network probe failed','type':type(e).__name__})
        derivative = next((d for d in bybit if d['status']=='Trading' and d['quoteCoin']=='USDT' and d['contractType']=='LinearPerpetual' and d['baseCoin']==symbol), None)
        if not derivative:
            derivative = next((d for d in bybit if d['status']=='Trading' and d['quoteCoin']=='USDT' and d['contractType']=='LinearPerpetual' and d['baseCoin']=='1000'+symbol), None)
        if symbol == 'SHIB' and not derivative:
            derivative = next((d for d in bybit if d['symbol']=='SHIB1000USDT' and d['status']=='Trading' and d['baseCoin']=='SHIB1000'), None)
        aliases = [x['name'], x['nameid']]
        if symbol=='PENGU': aliases += ['펭귄','펏지펭귄','퍼지펭귄','pudgy penguins']
        records.append({'id':symbol, 'name':upbit.get(symbol,{}).get('korean_name',x['name']), 'englishName':x['name'], 'aliases':aliases, 'color':'#0F666B', 'logo':'', 'coinloreId':x['id'], 'rank':int(x['rank']), 'markets':{'upbit':'KRW-'+symbol if symbol in upbit else None, 'binance':binance[symbol]['symbol'] if symbol in binance else None}, 'network':mapping, 'derivative':{'symbol':derivative['symbol'],'quantityMultiplier':1000 if derivative['baseCoin'] in ['1000'+symbol, 'SHIB1000'] else 1} if derivative else None, 'review':{'pairVerified':symbol in upbit or pair_verified,'sources':['https://api.upbit.com/v1/market/all','https://api.binance.com/api/v3/exchangeInfo',f'https://api.coinlore.net/api/coin/markets/?id={x["id"]}']}})
        print(f'{i+1}/150 {symbol} network={bool(mapping)}',flush=True)
        (CACHE/'progress.json').write_text(json.dumps(records,ensure_ascii=False),encoding='utf-8')
        time.sleep(1)
    (CACHE/'candidate-registry.json').write_text(json.dumps({'version':1,'reviewedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'selection':'100 Upbit KRW, 50 additional Binance USDT; market cap rank; existing eight and PENGU retained','assets':records},ensure_ascii=False,indent=2),encoding='utf-8')
    (CACHE/'issues.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Candidate saved; review issues before publishing.',flush=True)

if __name__ == '__main__': main()
