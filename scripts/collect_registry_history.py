"""Checkpointed, read-only source collection for a frozen asset registry.

Produces validated seed files in ignored work/. Never writes to a production DB.
Each completed source has content hashes; failures remain separate and resumable.
"""
import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path
import bootstrap as price_source
import bootstrap_network as network_source
import bootstrap_reference as reference_source
from registry import ASSETS

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mapping_hash(asset):
    definition = ASSETS[asset]
    # Display translations must not invalidate already-verified price/source data.
    mapping = {key: definition[key] for key in ['id', 'markets', 'network', 'derivative']}
    return hashlib.sha256(json.dumps(mapping, sort_keys=True).encode()).hexdigest()


def collect_prices(asset, market, interval, folder):
    rows = price_source.prices(asset, market, interval, False)
    if not rows:
        raise ValueError('No source candles')
    now = int(time.time())
    closed = [row for row in rows if row[-1] <= now]
    key = ':'.join([asset, market, interval])
    fetched = price_source.FETCHED[(asset, market, interval, rows[-1][0])]
    statement = price_source.statement
    sql = []
    for offset in range(0, len(closed), 256):
        chunk = closed[offset:offset + 256]
        sql.append(statement('price_archive', ['asset', 'market', 'interval', 'start', 'end', 'data', 'fetched_at'],
                             [asset, market, interval, chunk[0][0], chunk[-1][-1], json.dumps(chunk, separators=(',', ':')), fetched]))
    for candle in rows[-(501 if interval == '1d' else 32):]:
        sql.append(statement('candles', ['asset', 'market', 'interval', 'time', 'open', 'high', 'low', 'close', 'volume', 'close_time', 'fetched_at'],
                             [asset, market, interval, *candle, fetched]))
    history = dict(asset=asset, market=market, interval=interval, rows=len(rows), confirmedRows=len(closed),
                   first=rows[0][0], last=rows[-1][0], fetched=fetched, archived=True)
    sql.append(statement('state', ['key', 'value'], ['history:' + key, json.dumps(history)]))
    sql.append(statement('ingestion', ['key', 'last_attempt', 'last_success', 'data_as_of'], [key, fetched, fetched, closed[-1][0] if closed else None]))
    target = folder / (key.replace(':', '-') + '.sql')
    target.write_text(''.join(sql), encoding='utf-8')
    (target.with_suffix('.json')).write_text(json.dumps(closed, separators=(',', ':')), encoding='utf-8')
    return history, target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['prices', 'network', 'reference'])
    parser.add_argument('--assets', default=','.join(ASSETS))
    parser.add_argument('--output', default='work/registry-150')
    args = parser.parse_args()
    folder = ROOT / args.output / args.kind
    folder.mkdir(parents=True, exist_ok=True)
    progress = folder / 'checkpoint.json'
    report = json.loads(progress.read_text(encoding='utf-8')) if progress.exists() else {'sources': {}}
    tasks = []
    for asset in args.assets.split(','):
        definition = ASSETS[asset]
        if args.kind == 'prices':
            tasks.extend((asset, market, interval) for market, symbol in definition['markets'].items() if symbol for interval in ['1d', '1h'])
        elif asset in (network_source.ASSETS if args.kind == 'network' else reference_source.ASSETS):
            tasks.append((asset,))
    for task in tasks:
        key = ':'.join(task)
        config = mapping_hash(task[0])
        previous = report['sources'].get(key, {})
        output = folder / previous.get('file', '__missing__')
        if previous.get('status') == 'complete' and previous.get('mappingHash') == config and output.is_file() and digest(output) == previous.get('sha256'):
            continue
        if shutil.disk_usage(folder).free < 2 * 1024 ** 3:
            raise RuntimeError('History paused: less than 2 GiB free; existing data preserved')
        started = int(time.time())
        try:
            if args.kind == 'prices':
                evidence, output = collect_prices(*task, folder)
            else:
                collector = network_source if args.kind == 'network' else reference_source
                evidence = collector.collect(task[0], folder)
                output = folder / (task[0] + '.sql')
            report['sources'][key] = dict(status='complete', mappingHash=config, file=output.name, sha256=digest(output), evidence=evidence, checkedAt=int(time.time()))
        except Exception as error:
            report['sources'][key] = dict(status='error', mappingHash=config, error=type(error).__name__ + ': ' + str(error)[:240], checkedAt=int(time.time()))
        report.update(total=max(len(tasks), len(report['sources']), report.get('total', 0)), checkedAt=int(time.time()))
        temporary = progress.with_suffix('.tmp')
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(progress)
        print(key, report['sources'][key]['status'], 'seconds', int(time.time()) - started, flush=True)
        time.sleep(1)


if __name__ == '__main__':
    main()
