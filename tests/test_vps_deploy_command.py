"""Reviewed bundle and CI gates; no network or deployment is performed."""
import importlib.util,json,pathlib,tempfile,unittest
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
        for operation in ['prepare','activate']:
            with self.subTest(operation=operation),patch.object(runner,'ssh',side_effect=compile_remote):
                self.assertEqual(subject.phase(runner,self.pins,'/srv/services/coin-desk/audit/release-036',operation),result)
                self.assertEqual(json.loads((self.folder/(operation+'-result.json')).read_text()),result)
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
