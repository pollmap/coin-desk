"""Reviewed bundle and CI gates; no network or deployment is performed."""
import ast,importlib.util,json,pathlib,shutil,sqlite3,subprocess,sys,tempfile,unittest
from types import SimpleNamespace
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('deploy_command',pathlib.Path(__file__).resolve().parents[1]/'scripts/deploy_vps.py')
subject=importlib.util.module_from_spec(spec);spec.loader.exec_module(subject)

class DeploymentCommand(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.folder=pathlib.Path(self.temp.name)
        self.artifact={'commit':'a'*40,'release':'vps-'+'b'*16,'containsPrivateData':False,
            'sourceArchive':'source.tar.gz','imageArchive':'image.tar.gz'}
        for field in ['sourceArchive','imageArchive']:
            p=self.folder/self.artifact[field];p.write_bytes(field.encode())
            self.artifact[field+'Sha256']=subject.sha(p)
        for name in subject.INPUTS:(self.folder/name).write_text('{}')
        (self.folder/'deployment.json').write_text(json.dumps(self.artifact))
        self.pins={'commit':'a'*40,'release':'vps-'+'b'*16,'previousRelease':'vps-'+'c'*16,
            'auditName':'release-036','changedServices':['api'],'executeAllowed':True,
            'mainCiAllFivePassed':True,'mainCiHead':'a'*40,'mainCiRunId':123,'files':{n:subject.sha(self.folder/n) for n in subject.INPUTS}}
        self.save()
    def save(self):(self.folder/'reviewed-pins.json').write_text(json.dumps(self.pins))
    def test_valid_api_only_bundle(self):
        pins,_=subject.validate_bundle(self.folder);self.assertEqual(pins['changedServices'],['api'])
    def test_no_collector_or_migration_scope(self):
        for services in [['api','background'],['migrate'],[],['api','api']]:
            self.pins['changedServices']=services;self.save()
            with self.assertRaisesRegex(ValueError,'scope'):subject.validate_bundle(self.folder)
    def test_no_path_escape_or_unknown_helper(self):
        for name in ['../sibling','/tmp/elsewhere','a/b','']:
            self.pins['auditName']=name;self.save()
            with self.assertRaisesRegex(ValueError,'audit name'):subject.validate_bundle(self.folder)
    def test_modified_helper_is_rejected(self):
        (self.folder/'selective_release.py').write_text('changed')
        with self.assertRaisesRegex(ValueError,'file changed'):subject.validate_bundle(self.folder)
    def test_modified_image_is_rejected(self):
        (self.folder/'image.tar.gz').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'archive differs'):subject.validate_bundle(self.folder)
    def research_bundle(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        sys.path.insert(0,str(root/'deploy/vps'));import research_schema
        for name in ['research_schema.py','research_release.py']:shutil.copyfile(root/'deploy/vps'/name,self.folder/name)
        db=sqlite3.connect(':memory:')
        try:
            for name in research_schema.LEGACY_TABLES:db.execute('CREATE TABLE "'+name+'"(value TEXT)')
            self.pins['schemaPlan']=research_schema.make_plan(db,root/research_schema.MIGRATION)
        finally:db.close()
        self.pins.update(deploymentKind='research-additive-v1',changedServices=['api','research-worker'],files={n:subject.sha(self.folder/n) for n in subject.RESEARCH_INPUTS});self.save()
    def test_research_scope_requires_explicit_contract_and_additional_pinned_helpers(self):
        self.research_bundle();pins,_=subject.validate_bundle(self.folder)
        self.assertEqual(pins['schemaPlan']['afterTables'].__len__(),27)
        self.pins.pop('deploymentKind');self.save()
        with self.assertRaisesRegex(ValueError,'scope'):subject.validate_bundle(self.folder)
    def test_research_bundle_rejects_changed_schema_and_helper(self):
        self.research_bundle();self.pins['schemaPlan']['busyTimeoutMs']=60000;self.save()
        with self.assertRaisesRegex(ValueError,'Bounded migration'):subject.validate_bundle(self.folder)
        self.research_bundle();(self.folder/'research_schema.py').write_text('changed')
        with self.assertRaisesRegex(ValueError,'Reviewed file changed'):subject.validate_bundle(self.folder)
    def test_research_metadata_backup_scope_is_explicit_and_excludes_collectors(self):
        self.research_bundle();self.pins['changedServices']=['api','research-worker','backup'];self.save()
        self.assertEqual(subject.validate_bundle(self.folder)[0]['changedServices'],['api','research-worker','backup'])
        for services in [['api','backup'],['api','research-worker','backup','quotes'],['api','research-worker','backup','background'],['backup','api','research-worker']]:
            self.pins['changedServices']=services;self.save()
            with self.assertRaisesRegex(ValueError,'scope'):subject.validate_bundle(self.folder)
    def test_stage_generated_remote_python_compiles_without_execution(self):
        runner=subject.Runner(self.folder)
        scripts=[]
        def compile_remote(code,*args):
            compile(code,'<stage-remote>','exec');scripts.append(code)
            return {}
        with patch.object(runner,'ssh',side_effect=compile_remote),patch.object(runner,'run'):
            subject.stage(runner,self.pins,self.artifact,'/srv/services/coin-desk/audit/release-036')
        self.assertEqual(len(scripts),2)
    def test_phase_generated_remote_python_compiles_without_execution(self):
        runner=subject.Runner(self.folder)
        result={'prepared':True,'backupVerified':True}
        def compile_remote(code,*args):
            compile(code,'<phase-remote>','exec')
            return result
        for operation in ['prepare','activate','enable']:
            with self.subTest(operation=operation),patch.object(runner,'ssh',side_effect=compile_remote):
                self.assertEqual(subject.phase(runner,self.pins,'/srv/services/coin-desk/audit/release-036',operation),result)
                self.assertEqual(json.loads((self.folder/(operation+'-result.json')).read_text()),result)
    def test_phase_watchdogs_reach_remote_child_and_ssh_has_cleanup_grace(self):
        runner=subject.Runner(self.folder)
        for operation,seconds in [('prepare',3600),('activate',2400),('enable',1200)]:
            captured=[]
            def inspect_remote(code,timeout):
                tree=ast.parse(code)
                assignments={node.targets[0].id:ast.literal_eval(node.value) for node in tree.body
                    if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name)
                    and isinstance(node.value,ast.Constant)}
                child=next(node for node in ast.walk(tree) if isinstance(node,ast.Call)
                    and isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name)
                    and node.func.value.id=='subprocess' and node.func.attr=='run')
                child_timeout=next(value.value for value in child.keywords if value.arg=='timeout')
                self.assertIsInstance(child_timeout,ast.Name)
                self.assertEqual(assignments[child_timeout.id],seconds)
                self.assertEqual(timeout,seconds+30)
                captured.append(code)
                return {'prepared':True}
            with self.subTest(operation=operation),patch.object(runner,'ssh',side_effect=inspect_remote):
                subject.phase(runner,self.pins,str(self.folder),operation)
            self.assertEqual(len(captured),1)
        with patch.object(runner,'ssh') as remote,self.assertRaisesRegex(ValueError,'Unsupported deployment phase'):
            subject.phase(runner,self.pins,str(self.folder),'../activate')
        remote.assert_not_called()
    def phase_wait_budgets(self):
        """Guarded waits on the serial research path, not a bound on SQLite/I/O.

        Read current guard values from the runner source so increasing an inner
        wait invalidates this budget rather than silently keeping a stale sum.
        Routine inspect/config calls and unbounded DB/hash work are not treated
        as having zero cost: at least 120 seconds must remain beyond these waits.
        """
        root=pathlib.Path(__file__).resolve().parents[1]/'deploy/vps'
        def method(file,name):
            return next(n for n in ast.walk(ast.parse((root/file).read_text()))
                if isinstance(n,ast.FunctionDef) and n.name==name)
        def default(node,name):
            return ast.literal_eval(dict(zip([arg.arg for arg in node.args.args][-len(node.args.defaults):],node.args.defaults))[name])
        def timeouts(node):
            calls=sorted((call for call in ast.walk(node) if isinstance(call,ast.Call)),key=lambda call:(call.lineno,call.col_offset))
            return [ast.literal_eval(keyword.value) for call in calls
                for keyword in call.keywords if keyword.arg=='timeout']
        def sleeps(node):
            return [ast.literal_eval(call.args[0]) for call in ast.walk(node) if isinstance(call,ast.Call)
                and isinstance(call.func,ast.Attribute) and isinstance(call.func.value,ast.Name)
                and call.func.value.id=='time' and call.func.attr=='sleep']
        activation=method('research_release.py','activate');enabling=method('research_release.py','enable')
        activation_timeouts=timeouts(activation);enable_timeouts=timeouts(enabling)
        self.assertEqual(activation_timeouts,[210,15,210,210])
        self.assertEqual(enable_timeouts,[210,15,210])
        self.assertEqual(sleeps(activation),[60]);self.assertEqual(sleeps(enabling),[60])
        stop=default(method('rollout_engine.py','run'),'timeout')
        self.assertEqual(stop,180)
        backup=method('selective_release.py','verify_active_backup')
        backup_wait=next(ast.literal_eval(n.value.right) for n in backup.body if isinstance(n,ast.Assign)
            and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='deadline')
        self.assertEqual(backup_wait,180)
        # Backup status polling can cross the deadline by one two-second sleep.
        backup_wait+=sum(sleeps(backup))
        request=default(method('rollout_engine.py','request'),'timeout')
        health=method('rollout_engine.py','wait_process');attempts=default(health,'attempts')
        health_wait=attempts*request+(attempts-1)*sum(sleeps(health))
        # Both shadow services can succeed only on their final health attempt.
        hub=method('rollout_engine.py','hub_proof')
        hub_wait=default(hub,'seconds')+request+sum(sleeps(hub))
        preparation=(sum(timeouts(method('rollout_engine.py','source_and_image')))
            +sum(timeouts(method('rollout_engine.py','retain_assets')))+2*health_wait+hub_wait
            +sum(timeouts(method('rollout_engine.py','rehearsal')))+2*request
            +sum(sleeps(method('rollout_engine.py','rehearsal')))
            +sum(timeouts(method('research_release.py','rehearsal'))))
        # Failure after all three replacements, metadata proof and natural wait;
        # rollback backup, stop the new worker, then rollback API.
        activate=3*activation_timeouts[0]+activation_timeouts[1]+backup_wait+sum(sleeps(activation))+sum(activation_timeouts[2:])+stop
        # Enabling fails after natural observation; disabled restart also fails,
        # so the final fallback stop must still fit, not just the first rollback.
        enable=sum(enable_timeouts)+sum(sleeps(enabling))+stop
        return {'prepare':preparation,'activate':activate,'enable':enable}
    def test_phase_watchdogs_include_serial_waits_rollback_and_margin(self):
        for operation,guarded_wait in self.phase_wait_budgets().items():
            with self.subTest(operation=operation):
                self.assertGreaterEqual(subject.PHASE_TIMEOUTS[operation]-guarded_wait,120)
        # Both formerly used limits could expire during the activation recovery.
        self.assertGreater(self.phase_wait_budgets()['activate'],880)
    def test_failed_child_can_finish_recovery_and_write_its_wrapper_log(self):
        runner=subject.Runner(self.folder)
        # This executes only the generated wrapper locally against temporary
        # files. The subprocess and SSH transports are replaced, with no sleep.
        (self.folder/'reviewed-pins.json').write_text(json.dumps({'files':{},'deploymentKind':'research-additive-v1'}))
        elapsed=self.phase_wait_budgets()['activate']+120
        def recovered_child(args,**kwargs):
            if elapsed>=kwargs['timeout']:raise subprocess.TimeoutExpired(args,kwargs['timeout'])
            return SimpleNamespace(returncode=1,stdout='rollback complete',stderr='activation failed')
        def local_wrapper(code,timeout):
            self.assertGreater(timeout,elapsed)
            with patch.object(subprocess,'run',side_effect=recovered_child):exec(compile(code,'<offline-phase>','exec'),{})
        with patch.object(runner,'ssh',side_effect=local_wrapper),self.assertRaisesRegex(AssertionError,'Remote phase failed; preserve checkpoint'):
            subject.phase(runner,self.pins,str(self.folder),'activate')
        self.assertEqual((self.folder/'activate-wrapper.private.log').read_text(),'rollback complete\nactivation failed')
        self.assertFalse((self.folder/'activate-result.json').exists())
    def test_ci_requires_all_jobs_and_exact_main(self):
        runner=subject.Runner(self.folder)
        run={'head_sha':'a'*40,'head_branch':'main','event':'push','conclusion':'success'}
        jobs={'jobs':[{'name':n,'status':'completed','conclusion':'success'} for n in subject.EXPECTED_JOBS]}
        def answer(*args,**kwargs):return json.dumps(next(responses)).encode()
        responses=iter([run,jobs,{'sha':'a'*40}])
        with patch.object(runner,'run',side_effect=answer):runner.verify_ci(self.pins)
        for changed in [{'sha':'d'*40}]:
            responses=iter([run,jobs,changed])
            with patch.object(runner,'run',side_effect=answer),self.assertRaisesRegex(ValueError,'identity moved'):
                runner.verify_ci(self.pins)
        jobs['jobs'][0]['conclusion']='failure';responses=iter([run,jobs,{'sha':'a'*40}])
        with patch.object(runner,'run',side_effect=answer),self.assertRaisesRegex(ValueError,'Five successful'):
            runner.verify_ci(self.pins)

if __name__=='__main__':unittest.main()
