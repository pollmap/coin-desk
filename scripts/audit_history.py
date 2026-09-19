"""Read every public history page and report source dates without modifying any DB.

The report distinguishes collection coverage from the first 1,000-row response;
missing source days are reported, never filled or treated as proof of truncation.
"""
import argparse
import datetime as dt
import json
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


def get(base, endpoint, params=None):
    url = base.rstrip('/') + '/api/v1/' + endpoint
    if params:
        url += '?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={
        'Accept': 'application/json', 'User-Agent': 'CoinDesk-history-audit/1.0',
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def date(stamp):
    return dt.datetime.fromtimestamp(stamp, dt.timezone.utc).isoformat() if stamp is not None else None


def inspect(base, endpoint, params, get_page=get):
    query = {**params, 'limit': 1000, 'from': 0}
    first_meta = None
    observations = []
    pages = 0
    cursors = []
    while pages < 50:
        body = get_page(base, endpoint, query)
        if first_meta is None:
            first_meta = body['meta']
        rows = body['data']
        if any(a['time'] >= b['time'] for a, b in zip(rows, rows[1:])):
            raise ValueError('Unordered or duplicated page')
        if observations and rows and observations[-1]['time'] >= rows[0]['time']:
            raise ValueError('Page overlaps or reverses an earlier observation')
        observations.extend(rows)
        pages += 1
        cursor = body.get('nextCursor')
        if cursor is None:
            break
        if not isinstance(cursor, int) or cursor <= query['from']:
            raise ValueError('Pagination failed to advance')
        cursors.append(cursor)
        query['from'] = cursor
        if get_page is get:
            time.sleep(0.1)
    else:
        raise ValueError('History exceeds the bounded 50-page audit')
    if not observations:
        raise ValueError('No valid observations')
    last = observations[-1]['time']
    expected = first_meta.get('dataAsOf')
    step = 3600 if params.get('interval') == '1h' else 86400
    # A source may advance during the audit; a final date earlier than the
    # initially declared date exposes a missing terminal page or absent data.
    truncated = expected is not None and last < expected
    return {
        'endpoint': endpoint, 'selection': params, 'pages': pages,
        'rows': len(observations), 'first': date(observations[0]['time']),
        'last': date(last), 'declaredLatest': date(expected), 'truncated': truncated,
        'gapCount': sum(b['time'] - a['time'] > step for a, b in zip(observations, observations[1:])),
        'firstPageNextCursor': date(cursors[0]) if cursors else None,
        'source': first_meta.get('source'), 'unit': first_meta.get('unit'),
        'sourceHistoryStart': date(first_meta.get('historyStart')),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='https://coin-desk.pages.dev')
    parser.add_argument('--output', default='work/history-audit.json')
    parser.add_argument('--hourly', action='store_true')
    parser.add_argument('--network', action='store_true')
    args = parser.parse_args()
    if not args.base.startswith(('https://', 'http://')):
        raise ValueError('Invalid base URL')
    status = get(args.base, 'status')
    selections = []
    for asset in status['assets']:
        for market in ['binance', 'upbit']:
            for interval in (['1d', '1h'] if args.hourly else ['1d']):
                selections.append(('candles', {'asset': asset, 'market': market, 'interval': interval}))
    for metric in get(args.base, 'metrics')['data']:
        selections.append(('series', {'asset': 'BTC', 'metric': metric['id']}))
    for source in status['sources']:
        if source.get('active') and source['key'].startswith('reference:'):
            selections.append(('reference', {'asset': source['key'].split(':')[1]}))
        if args.network and source.get('active') and source['key'].startswith('network:'):
            asset = source['key'].split(':')[1]
            for metric in get(args.base, 'network-catalog', {'asset': asset})['data']:
                selections.append(('network', {'asset': asset, 'metric': metric['id']}))
    report = {'checkedAt': date(int(time.time())), 'base': args.base, 'histories': [], 'errors': []}
    for endpoint, params in selections:
        try:
            result = inspect(args.base, endpoint, params)
            report['histories'].append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except Exception as error:
            report['errors'].append({'endpoint': endpoint, 'selection': params, 'error': str(error)})
    report['ok'] = not report['errors'] and not any(row['truncated'] for row in report['histories'])
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not report['ok']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
