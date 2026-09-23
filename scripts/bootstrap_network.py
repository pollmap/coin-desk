"""Collect complete free Coin Metrics network histories into small monthly SQL chunks.

No API key or remote mutation. Raw responses and hashes are retained under work/network.
Data: Coin Metrics Community, CC BY-NC 4.0. Derived values are explicitly identified.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from decimal import Decimal, localcontext
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics'
DAY = 86400
ASSETS = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK']
HISTORY = dict(zip(ASSETS, ['2009-01-03', '2013-12-08', '2015-07-30', '2013-01-01', '2017-09-16']))
FIELDS = {
    'price': 'PriceUSD', 'mvrv': 'CapMVRVCur', 'active_addresses': 'AdrActCnt',
    'balance_addresses': 'AdrBalCnt', 'transactions': 'TxCnt', 'transfers': 'TxTfrCnt',
    'supply': 'SplyCur', 'market_cap': 'CapMrktCurUSD', 'fees_native': 'FeeTotNtv', 'hashrate': 'HashRate',
    'blocks': 'BlkCnt', 'issuance': 'IssTotNtv',
    'exchange_inflow': 'FlowInExNtv', 'exchange_outflow': 'FlowOutExNtv',
    'exchange_balance': 'SplyExNtv',
}

def fields_for(asset):
    return {key: value for key, value in FIELDS.items()
            if (key != 'fees_native' or asset != 'LINK') and
            (key != 'hashrate' or asset in ['BTC', 'DOGE']) and
            (key not in ['blocks', 'issuance'] or asset in ['BTC', 'DOGE', 'ETH']) and
            (key not in ['exchange_inflow', 'exchange_outflow', 'exchange_balance'] or asset in ['BTC', 'ETH'])}

def stamp(value):
    return int(dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())

def normalize(body, asset, fetched_at):
    fields = fields_for(asset)
    if not isinstance(body, dict) or not isinstance(body.get('data'), list):
        raise ValueError('Invalid source body')
    rows, seen = [], set()
    for raw in body['data']:
        if raw.get('asset') != asset.lower():
            raise ValueError('Wrong source asset')
        instant = dt.datetime.fromisoformat(raw['time'].replace('Z', '+00:00')).timestamp()
        if not instant.is_integer() or instant < 0 or instant % DAY or instant in seen:
            raise ValueError('Invalid or duplicate UTC date')
        instant = int(instant)
        seen.add(instant)
        values, statuses = {}, {}
        for key, field in fields.items():
            if field not in raw:
                raise ValueError('Missing field ' + field)
            value = raw[field]
            if value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, (str, int, float)) or str(value).strip() == '':
                raise ValueError('Non-numeric source field ' + field)
            number = float(value)
            if not math.isfinite(number) or number < 0 or (key == 'price' and number == 0):
                raise ValueError('Invalid source value ' + field)
            values[key] = number
            if isinstance(raw.get(field + '-status'), str):
                statuses[key] = raw[field + '-status']
        if 'exchange_inflow' in values and 'exchange_outflow' in values:
            with localcontext() as context:
                context.prec = 50
                values['exchange_netflow'] = float(Decimal(str(raw['FlowInExNtv'])) - Decimal(str(raw['FlowOutExNtv'])))
        mvrv = values.get('mvrv', 0)
        if mvrv > 0:
            if 'market_cap' in values:
                values['realized_cap'] = values['market_cap'] / mvrv
            if 'price' in values:
                values['realized_price'] = values['price'] / mvrv
            values['nupl'] = 1 - 1 / mvrv
        if not all(math.isfinite(value) for value in values.values()):
            raise ValueError('Non-finite derived value')
        if instant + DAY <= fetched_at:
            row = {'time': instant, 'values': values}
            if statuses:
                row['statuses'] = statuses
            rows.append(row)
    rows.sort(key=lambda row: row['time'])
    if not rows or rows[0]['time'] != stamp(HISTORY[asset] + 'T00:00:00Z'):
        raise ValueError('Source did not return the documented complete network start')
    return rows

def fetch(url):
    for attempt in range(4):
        request = urllib.request.Request(url, headers={'User-Agent': 'CoinDesk/0.5 noncommercial dashboard', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in [429, 500, 502, 503, 504] or attempt == 3:
                raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == 3:
                raise
        time.sleep(2 ** attempt)
    raise RuntimeError('Source retries exhausted')

def sql_text(value):
    return "'" + value.replace("'", "''") + "'"

def collect(asset, folder, reuse=False):
    params = {'assets': asset.lower(), 'metrics': ','.join(fields_for(asset).values()), 'frequency': '1d',
              'start_time': HISTORY[asset], 'page_size': '10000', 'paging_from': 'start'}
    url = BASE + '?' + urllib.parse.urlencode(params)
    raw_path = folder / (asset + '.raw.json')
    previous_audit = folder / (asset + '.audit.json')
    if reuse and raw_path.exists() and previous_audit.exists():
        audit = json.loads(previous_audit.read_text(encoding='utf-8'))
        raw = raw_path.read_bytes()
        if audit['url'] != url or hashlib.sha256(raw).hexdigest() != audit['sha256']:
            raise ValueError('Cached source audit does not match source configuration')
        fetched_at = audit['fetchedAt']
    else:
        raw = fetch(url)
        fetched_at = int(time.time())
        raw_path.write_bytes(raw)
    body = json.loads(raw)
    if body.get('next_page_url') or body.get('next_page_token'):
        raise ValueError('History exceeds 10000 rows; extend bootstrap pagination before importing')
    rows = normalize(body, asset, fetched_at)
    months, coverage = {}, {}
    for row in rows:
        date = dt.datetime.fromtimestamp(row['time'], dt.timezone.utc)
        bucket = int(date.replace(day=1).timestamp())
        months.setdefault(bucket, []).append(row)
        for metric in row['values']:
            coverage.setdefault(metric, []).append(row['time'])
    sql = []
    for bucket, observations in months.items():
        payload = sql_text(json.dumps(observations, separators=(',', ':'), allow_nan=False))
        sql.append(f"INSERT INTO network_months(asset,bucket,payload,fetched_at) VALUES('{asset}',{bucket},{payload},{fetched_at}) ON CONFLICT(asset,bucket) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at WHERE network_months.payload<>excluded.payload;")
    for metric, dates in coverage.items():
        sql.append(f"INSERT INTO network_coverage(asset,metric,first,last,observations,fetched_at) VALUES('{asset}','{metric}',{dates[0]},{dates[-1]},{len(dates)},{fetched_at}) ON CONFLICT(asset,metric) DO UPDATE SET first=excluded.first,last=excluded.last,observations=excluded.observations,fetched_at=excluded.fetched_at;")
    last = rows[-1]['time']
    sql.append(f"INSERT INTO ingestion(key,last_attempt,last_success,data_as_of,failures,error,next_attempt) VALUES('network:{asset}',{fetched_at},{fetched_at},{last},0,NULL,0) ON CONFLICT(key) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,data_as_of=excluded.data_as_of,failures=0,error=NULL,next_attempt=0;")
    sql.append(f"DELETE FROM state WHERE key='network-cursor:{asset}';")
    (folder / (asset + '.sql')).write_text('\n'.join(sql) + '\n', encoding='utf-8')
    audit = {
        'asset': asset, 'url': url, 'source': 'Coin Metrics Community', 'license': 'CC BY-NC 4.0',
        'version': 'coinmetrics-network-monthly-v2', 'fetchedAt': fetched_at,
        'sha256': hashlib.sha256(raw).hexdigest(), 'dailyRows': len(rows), 'monthRows': len(months),
        'maximumInitialRowWrites': len(months) + len(coverage) + 2,
        'first': HISTORY[asset], 'last': dt.datetime.fromtimestamp(last, dt.timezone.utc).date().isoformat(),
        'metrics': {key: {'rows': len(dates), 'first': dt.datetime.fromtimestamp(dates[0], dt.timezone.utc).date().isoformat(),
                          'last': dt.datetime.fromtimestamp(dates[-1], dt.timezone.utc).date().isoformat(),
                          'missingDays': sum((second - first) // DAY - 1 for first, second in zip(dates, dates[1:])),
                          'derived': key in ['realized_cap', 'realized_price', 'nupl']}
                    for key, dates in coverage.items()},
    }
    previous_audit.write_text(json.dumps(audit, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in audit.items() if key != 'metrics'}), flush=True)
    return audit

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', default=','.join(ASSETS))
    parser.add_argument('--output-dir', default='work/network')
    parser.add_argument('--reuse', action='store_true', help='Reuse only raw files with matching audit hashes and source settings')
    args = parser.parse_args()
    folder = ROOT / args.output_dir
    folder.mkdir(parents=True, exist_ok=True)
    for asset in args.assets.split(','):
        if asset not in ASSETS:
            raise ValueError('Unsupported network asset')
        collect(asset, folder, args.reuse)
        time.sleep(1)
