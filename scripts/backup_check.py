"""Verifies SQLite backup/restore into new scratch files; preserves the running DB."""
import datetime, hashlib, json, pathlib, sqlite3
root=pathlib.Path(__file__).resolve().parents[1];work=root/'work';folder=work/'recovery';folder.mkdir(exist_ok=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
source=sqlite3.connect('file:'+str(work/'local.sqlite').replace('\\','/')+'?mode=ro',uri=True)
backup=sqlite3.connect(folder/(stamp+'-backup.sqlite'));source.backup(backup)
restored=sqlite3.connect(folder/(stamp+'-restored.sqlite'));backup.backup(restored)
def fingerprints(db):
    result={}
    for table in ['candles','price_archive','onchain','state','ingestion','snapshots','raw_samples','dominance_history','cron_state','cron_runs','reference_prices','network_months','network_coverage','derivative_series']:
        rows=sorted(db.execute('SELECT * FROM '+table).fetchall(),key=lambda row:json.dumps(row,separators=(',',':')))
        result[table]={'rows':len(rows),'sha256':hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest()}
    return result
expected=fingerprints(backup);actual=fingerprints(restored)
assert expected==actual
assert restored.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
for db in [source,backup,restored]:db.close()
report={'verifiedAt':stamp,'backupRestoreIdentical':True,'tables':expected,'liveDatabaseOverwritten':False}
(work/'recovery-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
