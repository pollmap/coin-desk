"""Independently compare every network API observation to retained raw Coin Metrics data.

Uses Decimal for the three derived formulas rather than the application's normalizer.
Read-only; accepts a local or public base URL. Exits nonzero on any missing/extra/value mismatch.
"""
import argparse
import datetime as dt
from decimal import Decimal, localcontext
import hashlib
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIELDS = {'mvrv': 'CapMVRVCur', 'active_addresses': 'AdrActCnt', 'balance_addresses': 'AdrBalCnt',
          'transactions': 'TxCnt', 'transfers': 'TxTfrCnt', 'supply': 'SplyCur', 'market_cap': 'CapMrktCurUSD',
          'fees_native': 'FeeTotNtv', 'hashrate': 'HashRate'}

def expected_value(row, metric):
    if metric in FIELDS:
        raw = row.get(FIELDS[metric])
        return None if raw is None else float(raw)
    mvrv = row.get('CapMVRVCur')
    if mvrv is None or Decimal(mvrv) <= 0:
        return None
    with localcontext() as context:
        context.prec = 40
        divisor = Decimal(mvrv)
        if metric == 'nupl':
            return float(Decimal(1) - Decimal(1) / divisor)
        source = row.get('CapMrktCurUSD' if metric == 'realized_cap' else 'PriceUSD')
        return None if source is None else float(Decimal(source) / divisor)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8787')
    parser.add_argument('--assets', default='BTC,DOGE,ETH,XRP,LINK')
    parser.add_argument('--metrics', default='', help='Comma-separated ids; default all collected supported metrics')
    parser.add_argument('--output', default='work/network-verification.json')
    args = parser.parse_args()
    reports = []
    for asset in args.assets.split(','):
        if asset not in ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK']:
            raise ValueError('Unsupported asset')
        folder = ROOT / 'work/network'
        raw_bytes = (folder / (asset + '.raw.json')).read_bytes()
        audit = json.loads((folder / (asset + '.audit.json')).read_text(encoding='utf-8'))
        if hashlib.sha256(raw_bytes).hexdigest() != audit['sha256']:
            raise ValueError('Retained source hash mismatch')
        raw = json.loads(raw_bytes)['data']
        metrics = args.metrics.split(',') if args.metrics else [key for key in audit['metrics'] if key != 'price']
        begin = time.monotonic()
        asset_report = {'asset': asset, 'metrics': {}, 'sourceSha256': audit['sha256']}
        for metric in metrics:
            if metric not in audit['metrics'] or metric == 'price':
                raise ValueError('Unsupported collected metric: ' + metric)
            expected, expected_price = {}, {}
            cutoff = audit['fetchedAt'] // 86400 * 86400
            for row in raw:
                stamp = int(dt.datetime.fromisoformat(row['time'].replace('Z', '+00:00')).timestamp())
                if stamp >= cutoff:
                    continue
                value = expected_value(row, metric)
                if value is not None:
                    expected[stamp] = value
                    if row.get('PriceUSD') is not None:
                        expected_price[stamp] = float(row['PriceUSD'])
            cursor, actual, actual_price, previous_meta = 0, [], [], None
            for page in range(30):
                params = urllib.parse.urlencode({'asset': asset, 'metric': metric, 'from': cursor, 'to': cutoff, 'limit': 1000})
                url = args.base.rstrip('/') + '/api/v1/network?' + params
                request = urllib.request.Request(url, headers={'User-Agent': 'CoinDesk-NetworkAudit/0.5', 'Accept': 'application/json'})
                with urllib.request.urlopen(request, timeout=40) as response:
                    body = json.load(response)
                actual += body['data']
                actual_price += body['price']
                meta = body['meta']
                assert 'Coin Metrics' in meta['source'] and '거래소 OHLCV 아님' in meta['priceBasis']
                assert meta['historyStart'] == min(expected), 'Wrong actual metric history start'
                if previous_meta:
                    assert meta['historyStart'] == previous_meta['historyStart']
                    assert meta['dataAsOf'] == previous_meta['dataAsOf']
                previous_meta = meta
                next_cursor = body['nextCursor']
                if next_cursor is None:
                    break
                assert next_cursor > cursor, 'Cursor did not advance'
                cursor = next_cursor
            else:
                raise ValueError('Network pagination did not end')
            times = [point['time'] for point in actual]
            assert times == sorted(set(times)), 'Duplicate/unsorted API dates'
            got = {point['time']: point['value'] for point in actual}
            got_price = {point['time']: point['value'] for point in actual_price}
            assert len(actual_price) == len(got_price), 'Duplicate price overlay dates'
            assert set(got) == set(expected), 'Missing or fabricated observations'
            assert set(got_price) == set(expected_price), 'Price overlay alignment mismatch'
            assert all(math.isclose(value, got[stamp], rel_tol=1e-12, abs_tol=1e-13) for stamp, value in expected.items()), 'Source/Decimal calculation mismatch'
            assert all(math.isclose(value, got_price[stamp], rel_tol=1e-12, abs_tol=1e-13) for stamp, value in expected_price.items()), 'Price source mismatch'
            asset_report['metrics'][metric] = {'matched': len(got), 'pages': page + 1, 'first': audit['metrics'][metric]['first'], 'last': audit['metrics'][metric]['last']}
        asset_report['seconds'] = round(time.monotonic() - begin, 3)
        reports.append(asset_report)
        print(json.dumps(asset_report), flush=True)
    (ROOT / args.output).write_text(json.dumps({'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'base': args.base, 'assets': reports}, ensure_ascii=False, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()
