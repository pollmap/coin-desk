"""Read-only UTC-day scheduler, briefing, backup and storage evidence. No waiting gate."""
import argparse, collections, datetime, json, pathlib, sqlite3, time

LANES=('quotes','background','recent','analysis')


def report(database, day, now=None, baseline=None, backup_status=None, backup_dir=None):
    now=int(time.time()) if now is None else int(now)
    date=datetime.date.fromisoformat(day)
    start=int(datetime.datetime.combine(date,datetime.time(),datetime.timezone.utc).timestamp())
    end=start+86400
    if start>now: raise ValueError('Cannot inspect a future UTC day')
    observed_end=min(end,max(start,(now-120)//60*60))
    db_path=pathlib.Path(database).resolve()
    db=sqlite3.connect(db_path.as_uri()+'?mode=ro',uri=True)
    try:
        result={'checkedAt':now,'utcDay':day,'windowStart':start,'windowEnd':end,
                'observedUntil':observed_end,'completeUtcDay':now>=end+120,
                'waiting48hRequired':False,'lanes':{},'readOnly':True}
        for lane in LANES:
            rows=db.execute('SELECT scheduled_at,started_at,completed_at,outcome FROM _coin_desk_runtime_runs WHERE lane=? AND scheduled_at>=? AND scheduled_at<? ORDER BY scheduled_at',(lane,start,observed_end)).fetchall()
            expected=(observed_end-start)//60
            schedule=[start-60]+[r[0] for r in rows]+[observed_end]
            starts=sorted(r[1] for r in rows if r[1] is not None)
            result['lanes'][lane]={'expected':expected,'recorded':len(rows),'missing':max(0,expected-len(rows)),
                'outcomes':dict(collections.Counter(r[3] for r in rows)),
                'recordingRate':len(rows)/expected if expected else None,
                'maxScheduledGapSeconds':max((b-a for a,b in zip(schedule,schedule[1:])),default=0),
                'maxObservedStartGapSeconds':max((b-a for a,b in zip(starts,starts[1:])),default=None),
                'nonSuccess':[{'scheduledAt':r[0],'outcome':r[3]} for r in rows if r[3]!='ok']}
        result['allDayScheduledRunsPresent']=result['completeUtcDay'] and all(r['recorded']==1440 for r in result['lanes'].values())
        result['briefings']=db.execute('SELECT id,created_at FROM daily_briefings WHERE created_at>=? AND created_at<? ORDER BY created_at',(start,min(now,end))).fetchall()
        result['sourceStates']=[dict(zip(('key','lastSuccess','dataAsOf','error','failures'),row)) for row in db.execute('SELECT key,last_success,data_as_of,error,failures FROM ingestion ORDER BY key')]
        result['budgetAndCursor']=db.execute("SELECT key,value FROM state WHERE key='budget:derivatives-backfill' OR key LIKE 'cursor:derivatives:%' ORDER BY key").fetchall()
    finally: db.close()
    result['storage']={'databaseBytes':sum(p.stat().st_size for p in [db_path,pathlib.Path(str(db_path)+'-wal'),pathlib.Path(str(db_path)+'-shm')] if p.exists()),
                       'backupBytes':sum(p.stat().st_size for p in pathlib.Path(backup_dir).rglob('*') if p.is_file()) if backup_dir else None}
    result['storageGrowth']=None
    if baseline:
        old=json.loads(pathlib.Path(baseline).read_text(encoding='utf-8'))
        if old['checkedAt']>=now: raise ValueError('Baseline must precede this observation')
        result['storageGrowth']={'since':old['checkedAt'],'seconds':now-old['checkedAt'],
            'deltas':{key:value-old['storage'][key] for key,value in result['storage'].items() if value is not None and old['storage'].get(key) is not None},
            'fullUtcDay':old['checkedAt']==start and now==end}
    result['backup']={'ok':False,'reason':'not_checked'}
    if backup_status:
        try:
            saved=json.loads(pathlib.Path(backup_status).read_text(encoding='utf-8'))
            result['backup']={k:saved.get(k) for k in ('ok','verified','completedAt','reason')}
            result['backup']['fresh']=0<=now-(saved.get('completedAt') or 0)<=90000
        except (OSError,ValueError): result['backup']={'ok':False,'reason':'unreadable_status'}
    result['limits']=['Source states and storage are point-in-time, not day-long history.',
                      'Observed start gaps exclude unobserved boundaries; scheduled missing counts retain boundaries.',
                      'Same-host verified backups do not prove offsite disaster recovery.']
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True);parser.add_argument('--day',required=True)
    parser.add_argument('--baseline');parser.add_argument('--backup-status');parser.add_argument('--backup-dir')
    parser.add_argument('--output',required=True)
    args=vars(parser.parse_args());output=pathlib.Path(args.pop('output'))
    data=report(**{k.replace('-','_'):v for k,v in args.items()})
    output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:data[k] for k in ('utcDay','completeUtcDay','allDayScheduledRunsPresent','waiting48hRequired')}))
