"""Freeze reviewed public identities; runtime never auto-enrolls changing rankings."""
import json
from build_asset_registry import ROOT, CACHE, fetch

# Search/display transliterations, not separate exchange or network identifiers.
KOREAN_ALIASES = dict(BNB='비앤비', HYPE='하이퍼리퀴드', ZEC='지캐시', LTC='라이트코인', QNT='퀀트', PAXG='팍스골드', ASTER='아스터', CAKE='팬케이크스왑', DASH='대시', FET='페치에이아이', NEXO='넥소', LDO='리도다오', GNO='노시스', DCR='디크레드', STRK='스타크넷', LUNC='루나클래식', AR='알위브', BONK='봉크', FLOKI='플로키', RUNE='토르체인', JASMY='재스미', TWT='트러스트월렛토큰', S='소닉', CVX='컨벡스파이낸스', SFP='세이프팔', ZEN='호라이즌', APE='에이프코인', DYDX='디와이디엑스', DEXE='덱스', GALA='갈라', RSR='리저브라이트', RLC='아이젝', ORDI='오디널스', GMX='지엠엑스', KSM='쿠사마', FTT='에프티엑스토큰', SNX='신세틱스', YFI='연파이낸스', EIGEN='아이겐레이어', MUBARAK='무바락', HUMA='휴마파이낸스', BOME='북오브밈', HOT='홀로', DGB='디지바이트', BANANAS31='바나나포스케일', ENJ='엔진코인', ROSE='오아시스')

def main():
    data=json.loads((CACHE/'candidate-registry.json').read_text(encoding='utf-8'))
    previous=json.loads((ROOT/'shared/asset-registry.json').read_text(encoding='utf-8'))
    previous={a['id']:a for a in previous['assets']}
    if len(data['assets']) != 150 or len({a['id'] for a in data['assets']}) != 150:
        raise ValueError('Expected 150 unique assets')
    ids=','.join(a['network']['id'] for a in data['assets'] if a['network'])
    names={a['asset']:a['full_name'] for a in fetch('https://community-api.coinmetrics.io/v4/reference-data/assets?assets='+ids+'&page_size=10000')['data']}
    for a in data['assets']:
        old=previous.get(a['id'])
        if old and old['logo']: a.update(name=old['name'],color=old['color'],logo=old['logo'])
        if a['id']=='SHIB':
            instrument=fetch('https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=SHIB1000USDT')['result']['list'][0]
            assert instrument['baseCoin']=='SHIB1000' and instrument['status']=='Trading'
            a['derivative']={'symbol':'SHIB1000USDT','quantityMultiplier':1000}
        if a['id']=='HYPE':
            a['review']['sources'].append('https://www.binance.com/en/support/announcement/detail/d49de208bb6d4a26b02677d7c3d89b5d')
            a['review']['pairVerified']=True
        if not a['review']['pairVerified']:raise ValueError('Unverified exchange identity '+a['id'])
        if a['network']:
            a['network']['scope']=names[a['network']['id']]
            a['review']['sources'].append('https://community-api.coinmetrics.io/v4/reference-data/assets?assets='+a['network']['id'])
            if a['id'] in ['DASH', 'DCR']:
                a['network']['metrics'].pop('FeeTotNtv', None)
                a['review']['inactiveMetrics'] = {'FeeTotNtv': 'Negative historical source values failed the fee-total validation; raw responses retained for review.'}
        if a['id']=='ICP':
            a['englishName']='Internet Computer'
            a['aliases'].append('Internet Computer')
        if a['id'] in KOREAN_ALIASES:
            a['name'] = KOREAN_ALIASES[a['id']]
            a['aliases'] = list(dict.fromkeys([*a['aliases'], a['name']]))
    # Contract addresses are never inferred from an exchange ticker. Provider
    # IDs and reviewed network scopes identify our existing source datasets.
    data['reviewStatus']='identity-and-recent-samples-verified'
    data['excludedAmbiguities']={
      'GTC':'CoinLore Game.com differs from Binance Gitcoin; excluded',
      'FRAX':'CoinLore stablecoin differs from Binance renamed FXS; excluded',
      'BFUSD':'Yield collateral product; excluded',
      'EURI':'Fiat stablecoin excluded from this initial analysis universe',
      'TON':'Binance USDT pair not TRADING at selection time',
    }
    (ROOT/'shared/asset-registry.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'shared/asset-ids.ts').write_text('export const ASSET_IDS = '+json.dumps([a['id'] for a in data['assets']])+' as const;\n',encoding='utf-8')
    print(json.dumps({'assets':len(data['assets']),'upbit':sum(bool(a['markets']['upbit']) for a in data['assets']),'binance':sum(bool(a['markets']['binance']) for a in data['assets']),'mvrv':sum(bool(a['network'] and 'CapMVRVCur' in a['network']['metrics']) for a in data['assets'])}))
if __name__=='__main__':main()
