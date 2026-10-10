"""Build verified per-source history starts, never launch dates or mixed prices."""
import argparse
import json
from pathlib import Path


def build(registry, verification):
    assets = {}
    for asset in registry['assets']:
        sources = [market for market, symbol in asset['markets'].items() if symbol]
        if (asset.get('network') or {}).get('metrics', {}).get('PriceUSD'):
            sources.append('reference')
        dates = {}
        for source in sources:
            row = verification['sources'].get(asset['id'] + ':' + source, {})
            if row.get('sameStart') is not True or not isinstance(row.get('sourceFirst'), int):
                raise ValueError('Unverified source origin: ' + asset['id'] + ':' + source)
            dates[source] = row['sourceFirst']
        if not dates:
            raise ValueError('Missing price history: ' + asset['id'])
        assets[asset['id']] = dates
    return {'version': 'verified-history-start-v1',
            'verifiedAt': verification['completedAt'],
            'scope': 'Earliest actual daily observation of each supported provider; not launch dates or the first trade worldwide.',
            'assets': assets}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--registry', default='shared/asset-registry.json')
    p.add_argument('--verification', required=True)
    p.add_argument('--output', default='shared/price-history-origins.json')
    a = p.parse_args()
    result = build(json.loads(Path(a.registry).read_text(encoding='utf8')),
                   json.loads(Path(a.verification).read_text(encoding='utf8')))
    Path(a.output).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'assets':len(result['assets']), 'sources':sum(len(v) for v in result['assets'].values())}))
