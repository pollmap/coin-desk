"""Read-only source/coverage audit. Never calls overview, refresh or collection endpoints."""
import argparse, collections, datetime, json, pathlib, sqlite3, urllib.request
from history_coverage import candle_coverage

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--base', required=True)
    p.add_argument('--database')
    p.add_argument('--registry', default='shared/asset-registry.json')
    p.add_argument('--output', required=True)
    p.add_argument('--provider-mvrv')
    a = p.parse_args()
    request = urllib.request.Request(a.base.rstrip('/') + '/api/v1/status', headers={'User-Agent': 'BoriChart-owned-read-only-audit/1.0'})
    with urllib.request.urlopen(request, timeout=30) as r: status = json.load(r)
    rows = status['sources']
    report = {'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'sourceCheckedAt': status['health']['checkedAt'], 'healthOk': status['health']['ok'],
      'active': sum(s['active'] for s in rows),
      'states': dict(collections.Counter(s['status'] for s in rows if s['active'])),
      'attention': [{k: s.get(k) for k in ['key','status','errorCode','diagnosis','last_attempt','last_success','data_as_of','next_attempt','collectorAgeSeconds','dataAgeSeconds','expectedCadenceSeconds','dataFreshnessLimitSeconds']} for s in rows if s['active'] and s['status'] != 'ok']}
    if a.database:
        database = pathlib.Path(a.database).resolve(strict=True)
        db = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        before = db.total_changes
        report['candles'] = candle_coverage(db)
        report['networkCoverage'] = [dict(r) for r in db.execute('SELECT * FROM network_coverage ORDER BY asset,metric')]
        registry = json.loads(pathlib.Path(a.registry).read_text(encoding='utf-8'))['assets']
        coverage = {(r['asset'], r['metric']): r for r in report['networkCoverage']}
        candles = {(r['asset'], r['market'], r['interval']): r for r in report['candles']}
        report['assetMatrix'] = [{
          'asset': item['id'], 'markets': [{
              'source': source, 'symbol': symbol, 'unit': 'KRW' if source == 'upbit' else 'USDT',
              'cadenceSeconds': 60,
              'intervals': {interval: candles.get((item['id'], source, interval)) for interval in ['1d','1h']}
            } for source, symbol in item['markets'].items() if symbol],
          'networkProviderId': (item.get('network') or {}).get('id'),
          'declaredProviderMetrics': (item.get('network') or {}).get('metrics', {}),
          'actualNetworkCoverage': [r for r in report['networkCoverage'] if r['asset'] == item['id']],
          'networkObservationCadenceSeconds': 86400,
          'derivativeContract': item.get('derivative'),
        } for item in registry]
        if a.provider_mvrv:
            provider = json.loads(pathlib.Path(a.provider_mvrv).read_text(encoding='utf-8'))
            compared = []
            for item in provider['latest']:
                at = int(datetime.datetime.fromisoformat(item['time'].replace('.000000000Z','+00:00')).timestamp())
                bucket = int(datetime.datetime.fromtimestamp(at,datetime.timezone.utc).replace(day=1,hour=0,minute=0,second=0).timestamp())
                row = db.execute('SELECT payload FROM network_months WHERE asset=? AND bucket=?', (item['asset'],bucket)).fetchone()
                observation = next((r for r in json.loads(row['payload']) if r['time']==at), None) if row else None
                value = observation['values'].get('mvrv') if observation else None
                expected = float(item['value'])
                compared.append({**item, 'unit': 'ratio', 'storedValue': value,
                    'sameDateValue': value is not None and abs(value-expected) <= max(1e-12,abs(expected)*1e-12)})
            report['providerMvrvComparison'] = {'providerObservedAt':provider['observedAt'],'rows':compared,'matching':sum(r['sameDateValue'] for r in compared)}
        report['referenceCoverage'] = [dict(r) for r in db.execute('SELECT asset,MIN(time) first,MAX(time) last,COUNT(*) observations FROM reference_prices GROUP BY asset')]
        report['reservedHistoryState'] = [dict(r) for r in db.execute("SELECT key,value FROM state WHERE key='budget:derivatives-backfill' OR key LIKE 'cursor:derivatives:%'")]
        report['readOnlyChanges'] = db.total_changes - before
        report['integrity'] = db.execute('PRAGMA quick_check(1)').fetchone()[0]
        db.close()
    pathlib.Path(a.output).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(a.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k in ['observedAt','healthOk','active','states','readOnlyChanges','integrity']}))

if __name__ == '__main__': main()
