"""Real temporary SQLite migrations and deployment containment, no VPS writes."""
import copy, importlib.util, json, pathlib, shutil, sqlite3, sys, tempfile, time, unittest
from unittest import mock
from contextlib import contextmanager

@contextmanager
def database(*args,**kwargs):
    connection=sqlite3.connect(*args,**kwargs)
    try:
        with connection: yield connection
    finally: connection.close()

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'deploy/vps'))
import research_schema as subject
import research_release as rollout
sys.path.insert(0,str(ROOT/'scripts'))
from backup_check import fingerprint

class AdditiveSchema(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.folder=pathlib.Path(self.temp.name)
        self.path=self.folder/'existing.sqlite';self.sql=self.folder/'0010_research_reports.sql'
        shutil.copyfile(ROOT/subject.MIGRATION,self.sql)
        with database(self.path) as db:
            for name in subject.LEGACY_TABLES:
                if name=='_coin_desk_migrations':db.execute('CREATE TABLE _coin_desk_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at INTEGER NOT NULL)')
                else:
                    db.execute('CREATE TABLE "'+name+'"(id INTEGER PRIMARY KEY,value TEXT)')
                    db.execute('INSERT INTO "'+name+'" VALUES(1,?)',('preserve-'+name,))
            db.execute('INSERT INTO _coin_desk_migrations VALUES(?,?,?)',('0009.sql','a'*64,1000))
            self.plan=subject.make_plan(db,self.sql);self.before=fingerprint(db)
    def check_unchanged(self):
        with database(self.path) as db:self.assertEqual(fingerprint(db),self.before)
    def test_migration_preserves_twenty_one_tables_and_adds_exact_schema(self):
        proof=subject.apply(self.path,self.sql,self.plan)
        with database(self.path) as db:
            after=fingerprint(db);subject.compare_legacy_content(self.before,after)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(),('ok',))
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
            self.assertEqual(db.execute('SELECT name,sha256 FROM _coin_desk_migrations ORDER BY name').fetchall(),[('0009.sql','a'*64),('0010_research_reports.sql',self.plan['ledgerSha256'])])
            db.execute("INSERT INTO onchain_reports VALUES('r','daily',1,'daily','global',1,2,3,'partial','{}','h',NULL)")
            with self.assertRaisesRegex(sqlite3.IntegrityError,'immutable'):db.execute("UPDATE onchain_reports SET body='{}' WHERE id='r'")
        self.assertEqual(proof['oldTableWrites'],0);self.assertEqual(proof['ledgerRowsAdded'],1);self.assertLess(proof['transactionMilliseconds'],5000)
    def test_independent_backup_restore_contains_all_new_tables_and_same_content(self):
        subject.apply(self.path,self.sql,self.plan)
        with database(self.path) as source,database(self.folder/'backup.sqlite') as backup,database(self.folder/'restored.sqlite') as restored:
            source.backup(backup);backup.backup(restored)
            self.assertEqual(fingerprint(source),fingerprint(restored));self.assertEqual(len(fingerprint(restored)['tables']),27)
    def test_existing_schema_drift_stops_before_ddl(self):
        with database(self.path) as db:db.execute('CREATE INDEX candles_extra ON candles(value)')
        with self.assertRaisesRegex(ValueError,'Live schema differs'):subject.apply(self.path,self.sql,self.plan)
        with database(self.path) as db:self.assertNotIn('onchain_reports',[r[1] for r in subject.schema(db)])
    def test_file_hash_and_ledger_hash_are_independently_required(self):
        self.sql.write_text(self.sql.read_text()+'\n-- changed\n')
        with self.assertRaisesRegex(ValueError,'file differs'):subject.apply(self.path,self.sql,self.plan)
        self.check_unchanged()
    def test_applied_0010_cannot_be_replayed_as_a_fresh_migration(self):
        subject.apply(self.path,self.sql,self.plan)
        with self.assertRaisesRegex(ValueError,'schema differs'):subject.apply(self.path,self.sql,self.plan)
    def test_destructive_dml_drop_and_transaction_escape_are_denied(self):
        for sql in ['DELETE FROM candles;','DROP TABLE candles;','COMMIT;','ALTER TABLE candles ADD COLUMN x TEXT;',"CREATE TABLE onchain_intruder AS SELECT * FROM snapshots;"]:
            with self.subTest(sql=sql):
                self.sql.write_text(sql);p=copy.deepcopy(self.plan);p['fileSha256']=subject.checksum(self.sql);p['ledgerSha256']=subject.ledger_hash(sql)
                with self.assertRaises(ValueError):subject.apply(self.path,self.sql,p)
                self.check_unchanged()
    def test_trigger_cannot_write_existing_market_data(self):
        text=self.sql.read_text().replace("BEGIN SELECT RAISE(ABORT,'Published report content is immutable'); END;","BEGIN DELETE FROM candles; END;")
        self.sql.write_text(text);p=copy.deepcopy(self.plan);p['fileSha256']=subject.checksum(self.sql);p['ledgerSha256']=subject.ledger_hash(text)
        with self.assertRaisesRegex(ValueError,'abort triggers'):subject.apply(self.path,self.sql,p)
        self.check_unchanged()
    def test_extra_or_missing_schema_objects_roll_back_every_create(self):
        text=self.sql.read_text().replace('CREATE INDEX IF NOT EXISTS onchain_reports_feed ON onchain_reports(scope,type,published_at DESC,id);','')
        self.sql.write_text(text);p=copy.deepcopy(self.plan);p['fileSha256']=subject.checksum(self.sql);p['ledgerSha256']=subject.ledger_hash(text)
        with self.assertRaisesRegex(ValueError,'schema additions differ'):subject.apply(self.path,self.sql,p)
        self.check_unchanged()
    def test_existing_writer_is_not_blocked_indefinitely(self):
        db=sqlite3.connect(self.path);self.addCleanup(db.close);db.execute('BEGIN IMMEDIATE');start=time.monotonic()
        with self.assertRaises(sqlite3.OperationalError):subject.apply(self.path,self.sql,self.plan)
        self.assertLess(time.monotonic()-start,2);db.rollback();self.check_unchanged()
    def test_historical_sql_or_extra_migration_cannot_be_silently_changed(self):
        prior={'files':{'migrations/0009.sql':'a'*64,'server/file':'d'*64}}
        source={'files':{**prior['files'],subject.MIGRATION:self.plan['fileSha256']}}
        subject.validate_migration_set(self.plan,source,prior)
        for key in ['migrations/0009.sql','migrations/0011.sql']:
            changed=copy.deepcopy(source);changed['files'][key]='b'*64
            with self.assertRaisesRegex(ValueError,'Historical migrations changed'):subject.validate_migration_set(self.plan,changed,prior)
    def test_expected_sets_and_lock_limits_cannot_be_relaxed(self):
        for key,value in [('beforeTables',subject.LEGACY_TABLES[:-1]),('afterTables',subject.LEGACY_TABLES),('newObjects',[]),('busyTimeoutMs',30000),('transactionDeadlineMs',600000)]:
            p=copy.deepcopy(self.plan);p[key]=value
            with self.assertRaises(ValueError):subject.validate_plan(p)
    def test_content_checker_rejects_old_row_mutation_not_only_row_count(self):
        subject.apply(self.path,self.sql,self.plan)
        with database(self.path) as db:
            db.execute("UPDATE candles SET value='changed' WHERE id=1");after=fingerprint(db)
        with self.assertRaisesRegex(ValueError,'content changed: candles'):subject.compare_legacy_content(self.before,after)

class ResearchContainment(unittest.TestCase):
    def setUp(self):
        self.image='coin-desk:vps-'+'b'*16;self.release='vps-'+'b'*16
        self.old={'name':'coin-desk','services':{n:{'image':'old','environment':{'COIN_DESK_RELEASE':'old'},'cpus':.25} for n in ['api','quote-hub','quotes','background','recent','analysis','backup','migrate']},'networks':{'default':{'name':'coin-desk-private'}}}
        self.new=copy.deepcopy(self.old);self.new['services']['api']['image']=self.image;self.new['services']['api']['environment']['COIN_DESK_RELEASE']=self.release
        self.new['services']['research-worker']={'image':self.image,'profiles':['research'],'depends_on':{},'command':['node','server/research-worker.mjs'],'environment':{'COIN_DESK_DB':'/app/data/coin-desk.sqlite','COIN_DESK_RELEASE':self.release,'COIN_DESK_RESEARCH_ENABLED':'0','COIN_DESK_RESEARCH_MAX_JOB_SECONDS':'600','COIN_DESK_RESEARCH_MAX_MARKETS':'10','COIN_DESK_INJECTIVE_NETWORK':'mainnet'},'cpus':.5,'mem_limit':536870912,'read_only':True,'user':'10001:10001','cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'volumes':[{'source':str(rollout.selective.ROOT/'shared/data'),'target':'/app/data'}],'healthcheck':{'test':['CMD','node','server/research-worker.mjs','--health']}}
        self.before={'api':{'Config':{'Image':'old'}}}
    def validate(self):rollout.validate_configs(self.old,self.new,self.image,self.release,self.before)
    def test_new_disabled_worker_keeps_all_collectors_and_data_mounts(self):self.validate()
    def test_worker_cannot_enable_as_part_of_initial_activation(self):
        self.new['services']['research-worker']['environment']['COIN_DESK_RESEARCH_ENABLED']='1'
        with self.assertRaisesRegex(ValueError,'start disabled'):self.validate()
    def test_four_collector_health_thresholds_cannot_change(self):
        for lane in ['quotes','background','recent','analysis']:
            old=copy.deepcopy(self.new);self.new['services'][lane]['healthcheck']={'interval':'10m'}
            with self.assertRaisesRegex(ValueError,'Protected service'):self.validate()
            self.new=old
    def test_worker_cannot_automatically_start_migration(self):
        self.new['services']['research-worker']['depends_on']={'migrate':{'condition':'service_completed_successfully'}}
        with self.assertRaisesRegex(ValueError,'automatically migrate'):self.validate()
    def test_worker_extra_volume_or_credentials_are_denied(self):
        self.new['services']['research-worker']['environment']['PRIVATE_TOKEN']='do-not-log'
        with self.assertRaisesRegex(ValueError,'credentials'):self.validate()
    def test_worker_budget_containment_is_not_just_a_name(self):
        self.new['services']['research-worker']['mem_limit']=2*1024**3
        with self.assertRaisesRegex(ValueError,'resource limits'):self.validate()
    def test_unreviewed_environment_and_job_bounds_are_denied(self):
        for key,value in [('FUTURE_INTEGRATION','0'),('COIN_DESK_RESEARCH_MAX_JOB_SECONDS','3600'),('COIN_DESK_RESEARCH_MAX_MARKETS','150')]:
            original=copy.deepcopy(self.new);self.new['services']['research-worker']['environment'][key]=value
            with self.assertRaises(ValueError):self.validate()
            self.new=original
    def test_enable_changes_only_one_setting_and_rejects_ambiguous_or_replayed_flags(self):
        self.assertEqual(rollout.enabled_environment('COIN_DESK_API_IMAGE=old\nCOIN_DESK_RESEARCH_ENABLED=0\n'),'COIN_DESK_API_IMAGE=old\nCOIN_DESK_RESEARCH_ENABLED=1\n')
        for text in ['', 'COIN_DESK_RESEARCH_ENABLED=1\n','COIN_DESK_RESEARCH_ENABLED=0\nCOIN_DESK_RESEARCH_ENABLED=0\n']:
            with self.assertRaises(ValueError):rollout.enabled_environment(text)
    def test_enable_cannot_change_api_collectors_or_research_image(self):
        enabled=copy.deepcopy(self.new);enabled['services']['research-worker']['environment']['COIN_DESK_RESEARCH_ENABLED']='1'
        rollout.validate_enable_configs(self.new,enabled)
        for name in ['api','research-worker','quotes','background','recent','analysis','backup']:
            damaged=copy.deepcopy(enabled);damaged['services'][name]['image']='unreviewed'
            with self.assertRaisesRegex(ValueError,'only its enabled flag'):rollout.validate_enable_configs(self.new,damaged)
    def test_old_collectors_must_advance_and_keep_three_minute_freshness(self):
        first={'lanes':[[n,800,850] for n in ['quotes','background','recent','analysis']]}
        last={'lanes':[[n,900,950] for n in ['quotes','background','recent','analysis']]}
        rollout.require_collector_progress(first,last,1000)
        for value in [850,819,None,1061]:
            damaged=copy.deepcopy(last);damaged['lanes'][2][2]=value
            with self.assertRaisesRegex(ValueError,'recent'):rollout.require_collector_progress(first,damaged,1000)

class ActivationFailure(unittest.TestCase):
    """Fault injection checks code-only rollback after additive DDL has committed."""
    def setUp(self):
        from types import SimpleNamespace
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
        self.audit=self.root/'audit/research';self.audit.mkdir(parents=True)
        self.old=self.root/'releases/old';self.old.mkdir(parents=True);self.new=self.root/'releases/new';self.new.mkdir()
        (self.root/'shared/data').mkdir(parents=True);(self.root/'shared/data/coin-desk.sqlite').write_bytes(b'live')
        for name in ['research-schema-rehearsal.private.json','research-rehearsal.sqlite']:(self.audit/name).write_bytes(b'sealed')
        (self.audit/'activation-seal.private.json').write_text(json.dumps({'researchSchemaProofSha256':rollout.selective.sha(self.audit/'research-schema-rehearsal.private.json'),'researchMigratedCloneSha256':rollout.selective.sha(self.audit/'research-rehearsal.sqlite'),'schemaPlanSha256':'plan'}))
        self.protected=['quotes','background','recent','analysis','backup','quote-hub','migrate']
        self.before={n:{'Id':n,'Image':'sha256:old','Config':{'Image':'old-image'}} for n in ['api',*self.protected]}
        class FakeBase:pass
        def private(path,data):path.write_text(json.dumps(data))
        self.base=SimpleNamespace(Deployment=FakeBase,private_json=private,require_restored_image=mock.Mock())
        for key,value in [('ROOT',self.root),('AUDIT',self.audit),('OLD',self.old),('PROTECTED',self.protected)]:
            patcher=mock.patch.object(rollout.selective,key,value);patcher.start();self.addCleanup(patcher.stop)
        cls=rollout.deployment_type(self.base,{'schemaPlan':{}},{})
        self.job=cls();self.job.new=self.new;self.job.newenv=self.root/'new.env';self.job.oldenv=self.root/'old.env'
        self.job.commit='a'*40;self.job.release='new';self.job.image='new-image'
        self.job.report={'researchDisabledSmokeVerified':True,'researchReadonlyDryRunVerified':True,'schemaPlanSha256':'plan','imagePortability':{'verifiedIds':['sha256:new']}}
        self.job.assert_current=mock.Mock();self.job.verify_activation_inputs=mock.Mock(return_value=self.before);self.job.validate_configs=mock.Mock();self.job.capacity=mock.Mock()
        self.job.config=lambda folder,env:['docker','compose',str(folder)]
        self.job.containers=mock.Mock(return_value=self.before)
        self.job.inspect_worker=mock.Mock(return_value={'Image':'sha256:new','Config':{'Image':'new-image'}})
        self.actions=[]
        def run(args,**kwargs):
            self.actions.append(args)
            if args[-1]=='api' and str(self.new) in args:
                self.job.containers.return_value={**self.before,'api':{'Id':'new-api','Image':'sha256:new','Config':{'Image':'new-image'}}}
            if args[-1]=='research-worker':raise RuntimeError('worker start failed')
            if args[-1]=='api' and str(self.old) in args:self.job.containers.return_value=self.before
            return b''
        self.job.run=run
        def backup(source,folder,status,**kwargs):
            path=folder/'snapshot';path.mkdir(parents=True);(path/'snapshot.sqlite').write_bytes(b'snapshot');(path/'manifest.json').write_text('{}')
            return {'verified':True,'completedAt':int(time.time())}
        self.restore=mock.Mock()
        self.backup_module=SimpleNamespace(backup=backup,restore=self.restore)
        patcher=mock.patch.dict(sys.modules,{'vps_backup':self.backup_module});patcher.start();self.addCleanup(patcher.stop)
        patcher=mock.patch.object(rollout.subprocess,'run',return_value=SimpleNamespace(returncode=1));patcher.start();self.addCleanup(patcher.stop)
    def test_worker_failure_restores_api_and_stops_only_new_worker_without_db_restore(self):
        with mock.patch.object(rollout.schema,'apply',return_value={'applied':True}),self.assertRaisesRegex(RuntimeError,'worker start failed'):self.job.activate()
        result=json.loads((self.audit/'activation.json').read_text())
        self.assertEqual(result['rollbackServices'],['research-worker','api']);self.assertTrue(result['additiveTablesRetained']);self.assertFalse(result['liveDatabaseRestored'])
        self.assertEqual(result['attemptedServices'],['api','research-worker']);self.assertEqual((self.root/'shared/data/coin-desk.sqlite').read_bytes(),b'live')
        self.assertEqual(self.restore.call_count,1);self.assertNotEqual(self.restore.call_args.args[1],self.root/'shared/data/coin-desk.sqlite')
    def test_migration_failure_never_replaces_existing_services(self):
        with mock.patch.object(rollout.schema,'apply',side_effect=ValueError('schema mismatch')),self.assertRaisesRegex(ValueError,'schema mismatch'):self.job.activate()
        self.assertEqual(self.actions,[]);self.restore.assert_not_called()
        result=json.loads((self.audit/'activation.json').read_text());self.assertFalse(result['schemaChanged']);self.assertFalse(result['liveDatabaseRestored'])
    def test_post_schema_restore_failure_retains_schema_and_does_not_touch_api(self):
        self.restore.side_effect=ValueError('restore mismatch')
        with mock.patch.object(rollout.schema,'apply',return_value={'applied':True}),self.assertRaisesRegex(ValueError,'restore mismatch'):self.job.activate()
        self.assertEqual(self.actions,[])
        result=json.loads((self.audit/'activation.json').read_text());self.assertTrue(result['additiveTablesRetained']);self.assertEqual(result['attemptedServices'],[])

if __name__=='__main__':unittest.main()
