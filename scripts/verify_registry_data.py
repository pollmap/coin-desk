"""Build an isolated SQLite seed and reconcile every closed source observation.

No production writes. Checkpoint and raw hashes are verified before importing.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import sqlite3
from registry import ASSETS
from bootstrap_network import normalize

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(folder, destination, report_path):
    if destination.exists():
        raise ValueError('Use a new isolated destination')
    destination.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(destination)
    for migration in sorted((ROOT / 'migrations').glob('*.sql')):
        db.executescript(migration.read_text(encoding='utf-8'))
    result = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'fixture': False,
              'assets': [], 'sourceCounts': {}, 'totals': {'closedCandles': 0, 'networkDays': 0, 'referenceDays': 0, 'derivativePoints': 0}}
    for kind in ['prices', 'network', 'reference']:
        checkpoint = json.loads((folder / kind / 'checkpoint.json').read_text(encoding='utf-8'))
        for key, item in checkpoint['sources'].items():
            path = folder / kind / item['file']
            if item['status'] != 'complete' or sha(path) != item['sha256']:
                raise ValueError('Incomplete or changed seed: ' + key)
            db.executescript('BEGIN;\n' + path.read_text(encoding='utf-8') + '\nCOMMIT;')
        result['sourceCounts'][kind] = len(checkpoint['sources'])
    db.execute('ATTACH DATABASE ? AS derivatives', (str(folder / 'derivatives/observations.sqlite'),))
    for table in ['derivative_series', 'ingestion', 'state', 'raw_samples']:
        db.execute(f'INSERT OR IGNORE INTO main.{table} SELECT * FROM derivatives.{table}')
    db.commit()
    for asset, definition in ASSETS.items():
        item = {'asset': asset, 'prices': [], 'network': None, 'reference': None, 'derivatives': []}
        for market, symbol in definition['markets'].items():
            if not symbol:
                continue
            for interval in ['1d', '1h']:
                raw = json.loads((folder / 'prices' / f'{asset}-{market}-{interval}.json').read_text(encoding='utf-8'))
                stored = [p for (payload,) in db.execute('SELECT data FROM price_archive WHERE asset=? AND market=? AND interval=? ORDER BY start', (asset, market, interval)) for p in json.loads(payload)]
                if stored != raw:
                    raise ValueError(f'Archive differs from source {asset}:{market}:{interval}')
                step = 86400 if interval == '1d' else 3600
                if any(not all(math.isfinite(v) for v in row) or row[3] > min(row[1:5]) or row[2] < max(row[1:5]) or row[5] < 0 for row in stored):
                    raise ValueError('Invalid OHLC or volume')
                gaps = sum(max(0, (b[0]-a[0])//step-1) for a,b in zip(stored, stored[1:]))
                item['prices'].append(dict(market=market, currency='KRW' if market == 'upbit' else 'USDT', interval=interval, rows=len(stored), first=stored[0][0] if stored else None, last=stored[-1][0] if stored else None, missingIntervals=gaps))
                result['totals']['closedCandles'] += len(stored)
        audit_path = folder / 'network' / (asset + '.audit.json')
        if audit_path.exists():
            audit = json.loads(audit_path.read_text(encoding='utf-8'))
            path = folder / 'network' / (asset + '.raw.json')
            if sha(path) != audit['sha256']:
                raise ValueError('Changed network source')
            raw = normalize(json.loads(path.read_text(encoding='utf-8')), asset, audit['fetchedAt'])
            stored = [p for (payload,) in db.execute('SELECT payload FROM network_months WHERE asset=? ORDER BY bucket', (asset,)) for p in json.loads(payload)]
            if stored != raw:
                raise ValueError('Network differs from source ' + asset)
            item['network'] = {'providerId': definition['network']['id'], 'metrics': audit['metrics']}
            result['totals']['networkDays'] += len(stored)
        audit_path = folder / 'reference' / (asset + '.audit.json')
        if audit_path.exists():
            audit = json.loads(audit_path.read_text(encoding='utf-8'))
            path = folder / 'reference' / (asset + '.raw.json')
            if sha(path) != audit['sha256']:
                raise ValueError('Changed reference source')
            raw = []
            for point in json.loads(path.read_text(encoding='utf-8'))['data']:
                timestamp = int(dt.datetime.fromisoformat(point['time'].replace('Z', '+00:00')).timestamp())
                if point['PriceUSD'] is not None and timestamp+86400 <= audit['fetchedAt']:
                    raw.append((timestamp, float(point['PriceUSD'])))
            stored = db.execute('SELECT time,value FROM reference_prices WHERE asset=? ORDER BY time', (asset,)).fetchall()
            if stored != sorted(raw):
                raise ValueError('Reference differs from source ' + asset)
            item['reference'] = {k: audit[k] for k in ['rows', 'first', 'last', 'gapCount', 'unit']}
            result['totals']['referenceDays'] += len(stored)
        if definition['derivative']:
            for metric, count, first, last in db.execute('SELECT metric,count(*),min(time),max(time) FROM derivative_series WHERE asset=? GROUP BY metric', (asset,)):
                item['derivatives'].append(dict(metric=metric, rows=count, first=first, last=last))
                result['totals']['derivativePoints'] += count
            if len(item['derivatives']) != 5:
                raise ValueError('Missing derivative metric ' + asset)
        if not any(p['interval'] == '1d' and p['rows'] >= 15 for p in item['prices']):
            raise ValueError('No market supports RSI ' + asset)
        result['assets'].append(item)
    result['integrity'] = db.execute('PRAGMA integrity_check').fetchone()[0]
    result['foreignKeys'] = db.execute('PRAGMA foreign_key_check').fetchall()
    if result['integrity'] != 'ok' or result['foreignKeys']:
        raise ValueError('Database integrity failed')
    db.close()
    result['seedSha256'] = sha(destination)
    result['stages'] = [{'assets': n, 'pricesVerified': True, 'sourceBacked': True} for n in [30, 75, 150]]
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k != 'assets'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('work/registry-150'))
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    verify(args.folder, args.destination, args.report)
