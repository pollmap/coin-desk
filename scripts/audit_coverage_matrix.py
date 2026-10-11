"""Read-only full registry history ledger; never labels an unverified gap as collection failure."""
import argparse, collections, datetime, json, math, pathlib, sqlite3, time
from history_coverage import candle_coverage


def gaps(times, step):
    stamps = sorted(set(times))
    ranges = []
    if step:
        for before, after in zip(stamps, stamps[1:]):
            if after - before > step:
                ranges.append({'from':before+step,'to':after,'slots':max(0,(after-before)//step-1),'cause':'unverified'})
    return {'first':stamps[0] if stamps else None, 'last':stamps[-1] if stamps else None,'observations':len(stamps),'missingSlots':sum(r['slots'] for r in ranges) if step else None,'gaps':ranges}


def audit(database, registry):
    now = int(time.time())
    db = sqlite3.connect(pathlib.Path(database).resolve(strict=True).as_uri()+'?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    db.execute('BEGIN')
    rows = []
    candles = candle_coverage(db,now)
    states = {r['key']:dict(r) for r in db.execute('SELECT key,last_success,data_as_of,next_attempt,error FROM ingestion')}
    checkpoints = {r['key']:json.loads(r['value']) for r in db.execute("SELECT key,value FROM state WHERE key LIKE 'history:%' OR key LIKE 'cursor:price-backfill:%' OR key LIKE 'cursor:derivatives:%'")}
    for a in registry['assets']:
        for market, symbol in a['markets'].items():
            if not symbol: continue
            for interval in ['1d','1h']:
                row = next((r for r in candles if (r['asset'],r['market'],r['interval'])==(a['id'],market,interval)),None)
                state = states.get(f"{a['id']}:{market}:{interval}",{})
                rows.append({'asset':a['id'],'kind':'candles','source':market,'symbol':symbol,'metric':interval,
                             'stored':row,'lastSuccess':state.get('last_success'),'collectionError':bool(state.get('error')),
                             'gapCause':'unverified' if row and row['missingSlots'] else 'none-observed',
                             'checkpoint':checkpoints.get(f"history:{a['id']}:{market}:{interval}"),
                             'retention':'last-90-days' if interval=='1h' else 'oldest-valid-provider-observation'})
        if a.get('network'):
            provider=a['network']['metrics']
            observations=collections.defaultdict(list)
            for month in db.execute('SELECT payload FROM network_months WHERE asset=? ORDER BY bucket',(a['id'],)):
                for day in json.loads(month['payload']):
                    if day['time']+86400>now:continue
                    for metric,value in day['values'].items():
                        if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value):observations[metric].append(day['time'])
            for metric,times in observations.items():
                row={'asset':a['id'],'kind':'network','source':'coinmetrics','providerAsset':a['network']['id'],'metric':metric,'cadence':'1d',**gaps(times,86400)}
                coverage=db.execute('SELECT first,last,observations FROM network_coverage WHERE asset=? AND metric=?',(a['id'],metric)).fetchone()
                row['coverageIndexMatches']=coverage is not None and (coverage['first'],coverage['last'],coverage['observations'])==(row['first'],row['last'],row['observations']) if metric!='price' else None
                row['internalReferencePrice']=metric=='price'
                rows.append(row)
            if 'PriceUSD' in provider:
                stamps=[r['time'] for r in db.execute('SELECT time FROM reference_prices WHERE asset=? AND time+86400<=? ORDER BY time',(a['id'],now))]
                rows.append({'asset':a['id'],'kind':'reference','source':'coinmetrics','metric':'PriceUSD','unit':'USD','providerDeclaredFirst':provider['PriceUSD']['first'],**gaps(stamps,86400)})
        if a.get('derivative'):
            for metric in ['funding','open_interest','long_account_ratio','open_interest_daily','long_account_ratio_daily']:
                stamps=[r['time'] for r in db.execute('SELECT time FROM derivative_series WHERE asset=? AND metric=? AND time<=? ORDER BY time',(a['id'],metric,now))]
                step=None if metric=='funding' else 86400 if metric.endswith('_daily') else 3600
                rows.append({'asset':a['id'],'kind':'derivatives','source':'bybit','metric':metric,'symbol':a['derivative'],'cadence':'settlement' if step is None else step,**gaps(stamps,step)})
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'registryVersion':registry['version'],'assets':len(registry['assets']),'rows':rows,
            'sourceCounts':dict(collections.Counter(r['kind'] for r in rows)), 'readOnlyChanges':db.total_changes,
            'coverageIndexMismatches':sum(r.get('coverageIndexMatches') is False for r in rows),
            'assetWithoutConfirmedDailyPrice':[a['id'] for a in registry['assets'] if not any(r['asset']==a['id'] and r['metric']=='1d' and r.get('stored') and r['stored']['observations'] for r in rows)],
            'gapPolicy':'Internal slots are not proof of missing collection. Provider non-observation, no trade, revision and collection gaps require independent provider evidence. Warmup is excluded from raw history gaps.',
            'launchDatesInferred':False,'archivesIncluded':True,'crossProviderStitching':False}
    db.close()
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--database',required=True);parser.add_argument('--registry',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    report=audit(args.database,json.loads(pathlib.Path(args.registry).read_text(encoding='utf-8')))
    pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['rows']}))
