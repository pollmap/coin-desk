"""Explicit additive 0010 contract. No import-time I/O and no down migration.

Full old-table content comparison belongs to an isolated restored snapshot. Live DDL
uses a bounded transaction and an authorizer, rather than holding a writer lock for
a full historical scan. Only the one reviewed migration ledger row may change in
an existing table.
"""
import hashlib, json, pathlib, re, sqlite3, time

LEGACY_TABLES = sorted(['_coin_desk_migrations','_coin_desk_runtime_runs','candles',
    'chain_history','cron_runs','cron_state','d1_migrations','daily_briefings',
    'derivative_series','dominance_history','ingestion','network_coverage',
    'network_months','observation_signals','onchain','price_archive','raw_samples',
    'reference_prices','signal_revisions','snapshots','state'])
NEW_TABLES = sorted(['onchain_markets','onchain_observations','onchain_provider_state',
    'onchain_report_runs','onchain_reports','onchain_report_evidence'])
OBJECTS = sorted([
    *[('table', n, n) for n in NEW_TABLES],
    ('index','onchain_markets_kind','onchain_markets'),
    ('index','onchain_observations_lookup','onchain_observations'),
    ('index','onchain_reports_feed','onchain_reports'),
    ('trigger','onchain_reports_immutable','onchain_reports'),
    ('trigger','onchain_evidence_immutable','onchain_report_evidence'),
])
MIGRATION = 'migrations/0010_research_reports.sql'

def require(value, message):
    if not value: raise ValueError(message)

def schema(db):
    return db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()

def schema_hash(rows):
    return hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def checksum(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

def ledger_hash(text):
    return hashlib.sha256(text.replace('\r\n','\n').encode()).hexdigest()

def make_plan(db, path):
    rows=schema(db);tables=sorted(r[1] for r in rows if r[0]=='table')
    require(tables==LEGACY_TABLES, 'Expected exact legacy 21-table set')
    body=pathlib.Path(path).read_text(encoding='utf-8')
    return {'kind':'research-additive-v1','file':MIGRATION,'fileSha256':checksum(path),
        'ledgerSha256':ledger_hash(body),'beforeTables':tables,'beforeSchemaSha256':schema_hash(rows),
        'afterTables':sorted(LEGACY_TABLES+NEW_TABLES),'newObjects':[list(x) for x in OBJECTS],
        'busyTimeoutMs':1000,'transactionDeadlineMs':5000}

def validate_plan(plan):
    require(isinstance(plan,dict) and plan.get('kind')=='research-additive-v1', 'Explicit additive schema contract required')
    require(plan.get('file')==MIGRATION, 'Only reviewed 0010 research migration is supported')
    require(plan.get('beforeTables')==LEGACY_TABLES and plan.get('afterTables')==sorted(LEGACY_TABLES+NEW_TABLES), 'Expected before/after table sets differ')
    require(plan.get('newObjects')==[list(x) for x in OBJECTS], 'Expected new schema object set differs')
    for k in ['fileSha256','ledgerSha256','beforeSchemaSha256']:
        require(isinstance(plan.get(k),str) and re.fullmatch('[a-f0-9]{64}',plan[k]), 'Invalid schema/checksum pin: '+k)
    require(plan.get('busyTimeoutMs')==1000 and plan.get('transactionDeadlineMs')==5000, 'Bounded migration lock/deadline required')

def validate_migration_set(plan, source, prior):
    validate_plan(plan)
    old={k:v for k,v in prior['files'].items() if k.startswith('migrations/')}
    new={k:v for k,v in source['files'].items() if k.startswith('migrations/')}
    require(MIGRATION not in old and new=={**old,MIGRATION:plan['fileSha256']}, 'Historical migrations changed or an undeclared migration was added')

def statements(body):
    clean=re.sub(r'--[^\n]*','',body)
    require(len(clean.encode())<=128*1024 and not re.search(r'\bAS\s+SELECT\b',clean,re.I), 'Unbounded or data-copy migration denied')
    pending='';out=[]
    for ch in clean:
        pending+=ch
        if ch==';' and sqlite3.complete_statement(pending):
            text=pending.strip();pending=''
            if text:out.append(text)
    require(not pending.strip(), 'Incomplete migration SQL')
    for sql in out:
        require(re.match(r'^CREATE\s+(TABLE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?onchain_[a-z_]+\b',sql,re.I), 'Only declared research CREATE statements are allowed')
        if re.match(r'^CREATE\s+TRIGGER',sql,re.I):
            require(re.search(r"BEGIN\s+SELECT\s+RAISE\(ABORT,\s*'[^']*'\)\s*;\s*END\s*;\s*$",sql,re.I), 'Only immutable abort triggers are allowed')
    return out

def apply(db_path, migration_path, plan):
    validate_plan(plan);migration_path=pathlib.Path(migration_path)
    require(not migration_path.is_symlink() and checksum(migration_path)==plan['fileSha256'], 'Migration file differs from reviewed artifact')
    body=migration_path.read_text(encoding='utf-8');require(ledger_hash(body)==plan['ledgerSha256'], 'Migration ledger hash differs')
    sqls=statements(body)
    db=sqlite3.connect(pathlib.Path(db_path).as_uri()+'?mode=rw',uri=True,timeout=1,isolation_level=None)
    try:
        db.execute('PRAGMA busy_timeout=1000');db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE');start=time.monotonic()
        db.set_progress_handler(lambda: int(time.monotonic()-start>5),1000)
        before=schema(db)
        require(schema_hash(before)==plan['beforeSchemaSha256'] and sorted(r[1] for r in before if r[0]=='table')==LEGACY_TABLES, 'Live schema differs from reviewed pre-migration schema')
        old_ledger=db.execute('SELECT name,sha256,applied_at FROM _coin_desk_migrations ORDER BY name').fetchall()
        require(not any(r[0]==pathlib.Path(MIGRATION).name for r in old_ledger), '0010 is already applied; inspect its checkpoint instead of rerunning')
        declared={(kind,name,table) for kind,name,table in OBJECTS}
        def authorize(action,a,b,database,trigger):
            create={sqlite3.SQLITE_CREATE_TABLE:'table',sqlite3.SQLITE_CREATE_INDEX:'index',sqlite3.SQLITE_CREATE_TRIGGER:'trigger'}
            if action in create:
                if action==sqlite3.SQLITE_CREATE_INDEX and b in NEW_TABLES and a.startswith('sqlite_autoindex_'+b+'_'):return sqlite3.SQLITE_OK
                return sqlite3.SQLITE_OK if (create[action],a,a if create[action]=='table' else b) in declared else sqlite3.SQLITE_DENY
            if action in [sqlite3.SQLITE_INSERT,sqlite3.SQLITE_UPDATE]:
                return sqlite3.SQLITE_OK if a in ['sqlite_master','sqlite_schema'] else sqlite3.SQLITE_DENY
            if action==sqlite3.SQLITE_READ:
                return sqlite3.SQLITE_OK if a in NEW_TABLES+['sqlite_master','sqlite_schema'] else sqlite3.SQLITE_DENY
            if action in [sqlite3.SQLITE_SELECT,sqlite3.SQLITE_FUNCTION,sqlite3.SQLITE_REINDEX]: return sqlite3.SQLITE_OK
            return sqlite3.SQLITE_DENY
        db.set_authorizer(authorize)
        try:
            for sql in sqls: db.execute(sql)
        finally: db.set_authorizer(None)
        after=schema(db);old_names={r[1] for r in before}
        require([r for r in after if r[1] in old_names]==before, 'An existing schema object changed')
        additions=[r for r in after if r[1] not in old_names]
        require(sorted((r[0],r[1],r[2]) for r in additions)==OBJECTS, 'Actual schema additions differ from declared objects')
        require(all(db.execute('SELECT COUNT(*) FROM "'+t+'"').fetchone()[0]==0 for t in NEW_TABLES), 'New research tables must begin empty')
        db.execute('INSERT INTO _coin_desk_migrations VALUES(?,?,?)',(pathlib.Path(MIGRATION).name,plan['ledgerSha256'],int(time.time())))
        require(db.execute('SELECT name,sha256,applied_at FROM _coin_desk_migrations WHERE name<>? ORDER BY name',(pathlib.Path(MIGRATION).name,)).fetchall()==old_ledger, 'Existing migration ledger changed')
        require(db.total_changes==1 and time.monotonic()-start<5, 'Unexpected old-table writes or migration deadline exceeded')
        db.execute('COMMIT')
        return {'applied':True,'migration':MIGRATION,'ledgerSha256':plan['ledgerSha256'],'beforeSchemaSha256':schema_hash(before),'afterSchemaSha256':schema_hash(after),'beforeTables':LEGACY_TABLES,'afterTables':sorted(LEGACY_TABLES+NEW_TABLES),'oldTableWrites':0,'ledgerRowsAdded':1,'transactionMilliseconds':round((time.monotonic()-start)*1000,2)}
    except BaseException:
        db.set_authorizer(None);db.set_progress_handler(None,0)
        if db.in_transaction:db.execute('ROLLBACK')
        raise
    finally:db.close()

def compare_legacy_content(before, after):
    require(set(before['tables'])==set(LEGACY_TABLES) and set(after['tables'])==set(LEGACY_TABLES+NEW_TABLES), 'Isolated table set differs')
    for name in LEGACY_TABLES:
        if name!='_coin_desk_migrations':require(before['tables'][name]==after['tables'][name], 'Existing table content changed: '+name)
    require(after['tables']['_coin_desk_migrations']['rows']==before['tables']['_coin_desk_migrations']['rows']+1, 'Exactly one migration ledger entry required')
    require(all(after['tables'][name]['rows']==0 for name in NEW_TABLES), 'New research tables unexpectedly contain data')
