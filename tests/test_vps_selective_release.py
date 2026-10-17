"""Mock-only checks for the repository-owned selective deployment wrapper."""
import copy
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tarfile
import tempfile
import types
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('two_service_035',Path(__file__).resolve().parents[1]/'deploy/vps/selective_release.py')
wrapper=importlib.util.module_from_spec(spec);spec.loader.exec_module(wrapper)
wrapper.CHANGED=['quote-hub','api']
wrapper.PROTECTED=[s for s in wrapper.SERVICES if s not in wrapper.CHANGED]


class FakeDiskDeployment:
    def request(self,path,port=18432,timeout=15):return {'path':path,'port':port,'timeout':timeout}
    def capacity(self,*args):self.capacityCalls.append(args)
    def rehearsal(self,report_name):self.after_rehearsal=True
    def containers(self):
        rows={name:{'Id':value} for name,value in self.initial.items()}
        if self.after_rehearsal and self.drift:rows['quotes']['Id']='d'*64
        return rows
    def initial_container_ids(self,names):return {name:self.initial[name] for name in names}
    def backup_and_restore(self):pass
    def verify_backup_checkpoint(self):
        self.backupCheckpointCalls+=1
        if not self.backupCheckpointValid:raise ValueError('Backup checkpoint differs')
    def activate(self):self.baseActivated=True
    def run(self,args,timeout=180,input_bytes=None):
        self.lastCommand=list(args)
        if list(args)[:3]==['docker','image','inspect']:
            return json.dumps([self.loadedImage]).encode()
        return b'{}'


class TwoServiceGuards(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.audit=self.root/'audit/ux-035';self.audit.mkdir(parents=True)
        self.old=self.root/'releases/old';self.old.mkdir(parents=True)
        self.patches=[mock.patch.object(wrapper,'ROOT',self.root),mock.patch.object(wrapper,'AUDIT',self.audit),mock.patch.object(wrapper,'OLD',self.old),
            mock.patch.object(wrapper.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32*wrapper.GIB))]
        for patch in self.patches:patch.start();self.addCleanup(patch.stop)
        self.base=types.SimpleNamespace(Deployment=FakeDiskDeployment,API_PORT=18450,HUB_PORT=18451,
            private_json=lambda p,d:p.write_text(json.dumps(d),encoding='utf-8'))
        self.source_body=b'console.log("candidate");\n'
        self.scope={'sourceSha256':'f'*64,'candidateFiles':{'server.mjs':hashlib.sha256(self.source_body).hexdigest()}}
        self.kind=wrapper.deployment_type(self.base,{},self.scope);self.job=self.kind()
        self.job.commit='a'*40;self.job.release='vps-'+'b'*16;self.job.image='coin-desk:'+self.job.release
        self.job.capacityCalls=[];self.job.after_rehearsal=False;self.job.drift=False
        self.job.baseActivated=False;self.job.backupCheckpointCalls=0;self.job.backupCheckpointValid=True
        self.job.initial={name:f'{i:064x}' for i,name in enumerate(wrapper.SERVICES,1)}
        config={'rootfs':{'diff_ids':['sha256:'+'d'*64]},'os':'linux','architecture':'amd64'}
        config_body=json.dumps(config).encode()
        config_id='sha256:'+hashlib.sha256(config_body).hexdigest()
        self.job.report={'imagePortability':{'verifiedIds':['sha256:'+'c'*64],'loadedId':'sha256:'+'c'*64,'ciConfigId':config_id}}
        self.job.loadedImage={'Id':'sha256:'+'c'*64,'RootFS':{'Layers':config['rootfs']['diff_ids']},'Os':'linux','Architecture':'amd64'}
        self.job.new=self.root/'candidate';self.job.new.mkdir();self.job.newenv=self.root/'candidate.env';self.job.newenv.write_text('CANDIDATE=1\n')
        self.job.oldenv=self.root/'previous.env'
        (self.audit/'canonical-dist.tar').write_bytes(b'canonical')
        (self.audit/'source-scope.json').write_text(json.dumps(self.scope))
        self.source_manifest=json.dumps({'files':self.scope['candidateFiles'],'sourceSha256':self.scope['sourceSha256']}).encode()
        (self.job.new/'release-manifest.json').write_bytes(self.source_manifest)
        (self.job.new/'server.mjs').write_bytes(self.source_body)
        self.tar_gz(self.audit/'source.tar.gz',{'release-manifest.json':self.source_manifest,'server.mjs':self.source_body})
        self.tar_gz(self.audit/'image.tar.gz',{'manifest.json':json.dumps([{'Config':'config.json'}]).encode(),'config.json':config_body})
        self.job.manifest={'sourceArchive':'source.tar.gz','sourceArchiveSha256':wrapper.sha(self.audit/'source.tar.gz'),
            'imageArchive':'image.tar.gz','imageArchiveSha256':wrapper.sha(self.audit/'image.tar.gz')}
        self.backup=self.audit/'backups/verified';self.backup.mkdir(parents=True)
        (self.backup/'snapshot.sqlite').write_bytes(b'snapshot')
        (self.backup/'manifest.json').write_text('{}')
        (self.audit/'rehearsal.sqlite').write_bytes(b'clone')
        self.job.report['backupFileSha256']=wrapper.sha(self.backup/'snapshot.sqlite')
        (self.audit/'backup-restore-reviewed.private.json').write_text(json.dumps({
            'sourceSnapshotSha256':wrapper.sha(self.backup/'snapshot.sqlite'),
            'restoredSnapshotSha256':wrapper.sha(self.audit/'rehearsal.sqlite'),
            'manifestSha256':wrapper.sha(self.backup/'manifest.json'),'userTableCount':21,'contentMatches':True}))

    @staticmethod
    def tar_gz(path,members):
        with tarfile.open(path,'w:gz') as archive:
            for name,body in members.items():
                info=tarfile.TarInfo(name);info.size=len(body)
                archive.addfile(info,io.BytesIO(body))

    def seal(self):
        self.job.rehearsal()

    def test_ports_preserve_explicit_hub_and_replace_captured_default(self):
        self.assertEqual(self.job.request('/sample')['port'],18450)
        self.assertEqual(self.job.request('/sample',18451,6),{'path':'/sample','port':18451,'timeout':6})

    def test_exact_two_changed_six_protected_and_environment_only_three_keys(self):
        self.assertEqual(wrapper.CHANGED,['quote-hub','api']);self.assertEqual(len(wrapper.PROTECTED),6)
        self.assertFalse(set(wrapper.CHANGED)&set(wrapper.PROTECTED))
        previous={'COIN_DESK_IMAGE':'base','COIN_DESK_QUOTES_IMAGE':'q','COIN_DESK_BACKGROUND_IMAGE':'bg','COIN_DESK_RELEASE':'old','COIN_DESK_API_IMAGE':'old-api','COIN_DESK_API_RELEASE':'old','COIN_DESK_HUB_IMAGE':'old-hub'}
        self.job.oldenv.write_text(''.join(k+'='+v+'\n' for k,v in previous.items()))
        self.job.newenv.unlink()
        self.job.write_environment()
        after=dict(line.split('=',1) for line in self.job.newenv.read_text().splitlines())
        self.assertEqual({k for k in previous if previous[k]!=after[k]},
                         {'COIN_DESK_API_IMAGE','COIN_DESK_API_RELEASE','COIN_DESK_HUB_IMAGE'})

    def test_capacity_retains_eight_gib_plus_pending_work(self):
        with mock.patch.object(wrapper.shutil,'disk_usage',return_value=types.SimpleNamespace(free=8*wrapper.GIB+511)):
            with self.assertRaisesRegex(ValueError,'History-space'):
                self.job.capacity('candidate',512)
        with mock.patch.object(wrapper.shutil,'disk_usage',return_value=types.SimpleNamespace(free=8*wrapper.GIB+512)):
            self.job.capacity('candidate',512)

    def test_api_only_scope_preserves_hub_and_collector_images(self):
        previous={'COIN_DESK_IMAGE':'base','COIN_DESK_RELEASE':'old',
            'COIN_DESK_API_IMAGE':'old-api','COIN_DESK_API_RELEASE':'old',
            'COIN_DESK_HUB_IMAGE':'old-hub','COIN_DESK_QUOTES_IMAGE':'old-quotes'}
        self.job.oldenv.write_text(''.join(k+'='+v+'\n' for k,v in previous.items()))
        self.job.newenv.unlink()
        with mock.patch.object(wrapper,'CHANGED',['api']):self.job.write_environment()
        after=dict(line.split('=',1) for line in self.job.newenv.read_text().splitlines())
        self.assertEqual({k for k in previous if previous[k]!=after[k]},
                         {'COIN_DESK_API_IMAGE','COIN_DESK_API_RELEASE'})

    def test_compose_up_never_builds_or_pulls(self):
        self.job.run(['docker','compose','up','-d','--no-deps','api'])
        self.assertEqual(self.job.lastCommand[:6],['docker','compose','up','--no-build','--pull','never'])

    def test_protected_drift_during_rehearsal_is_not_adopted_as_initial_identity(self):
        self.job.drift=True
        with self.assertRaisesRegex(ValueError,'original service changed during preparation'):self.job.rehearsal()
        self.assertFalse((self.audit/'activation-seal.private.json').exists())

    def test_unchanged_prepared_inputs_reach_only_the_base_activation(self):
        self.seal();self.job.activate()
        self.assertTrue(self.job.baseActivated)
        self.assertEqual(self.job.backupCheckpointCalls,1)
        seal=json.loads((self.audit/'activation-seal.private.json').read_text())
        self.assertEqual(seal['initialContainerIds'],self.job.initial)

    def test_sealed_image_proof_cannot_be_changed_before_activation(self):
        self.seal()
        self.job.report['imagePortability']['verifiedIds']=['sha256:'+'f'*64]
        with self.assertRaisesRegex(ValueError,'Prepared image or backup identity changed'):self.job.activate()
        self.assertFalse(self.job.baseActivated)

    def test_backup_checkpoint_must_be_reverified_before_any_service_activation(self):
        self.seal();self.job.backupCheckpointValid=False
        with self.assertRaisesRegex(ValueError,'Backup checkpoint differs'):self.job.activate()
        self.assertFalse(self.job.baseActivated)

    def test_backup_snapshot_clone_and_manifest_are_checked_again(self):
        self.seal()
        for path in [self.backup/'snapshot.sqlite',self.audit/'rehearsal.sqlite',self.backup/'manifest.json']:
            with self.subTest(member=path.name):
                original=path.read_bytes();path.write_bytes(original+b'changed')
                try:
                    with self.assertRaisesRegex(ValueError,'Reviewed independent backup changed'):self.job.activate()
                    self.assertFalse(self.job.baseActivated)
                finally:path.write_bytes(original)

    def test_extracted_source_is_checked_again_before_activation(self):
        self.seal();(self.job.new/'server.mjs').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'Activation extracted source changed'):self.job.activate()
        self.assertFalse(self.job.baseActivated)

    def test_source_and_image_archives_are_checked_again_before_activation(self):
        self.seal()
        for name in ['source.tar.gz','image.tar.gz']:
            with self.subTest(archive=name):
                path=self.audit/name;original=path.read_bytes();path.write_bytes(original+b'changed')
                try:
                    with self.assertRaisesRegex(ValueError,'Activation artifact hash mismatch'):self.job.activate()
                    self.assertFalse(self.job.baseActivated)
                finally:path.write_bytes(original)

    def test_loaded_image_identity_and_layer_chain_cannot_drift(self):
        self.seal()
        for image in [dict(self.job.loadedImage,Id='sha256:'+'e'*64),dict(self.job.loadedImage,RootFS={'Layers':['sha256:'+'e'*64]})]:
            with self.subTest(image=image):
                original=self.job.loadedImage;self.job.loadedImage=image
                try:
                    with self.assertRaisesRegex(ValueError,'Activation loaded image changed'):self.job.activate()
                    self.assertFalse(self.job.baseActivated)
                finally:self.job.loadedImage=original

    def test_twenty_table_restore_cannot_be_reported_as_verified_twenty_one(self):
        backup=self.backup
        (backup/'snapshot.sqlite').write_bytes(b'snapshot');(self.audit/'rehearsal.sqlite').write_bytes(b'clone')
        content={'schemaSha256':'c'*64,'tables':{f't{i}':{'rows':1,'sha256':'d'*64} for i in range(20)}}
        (backup/'manifest.json').write_text(json.dumps({'verified':True,'fileSha256':wrapper.sha(backup/'snapshot.sqlite'),'content':content}))
        fake_db=mock.MagicMock()
        fake_db.execute.side_effect=lambda sql:types.SimpleNamespace(fetchall=lambda:[('ok',)] if 'integrity_check' in sql else [])
        connection=mock.MagicMock();connection.__enter__.return_value=fake_db
        backup_module=types.SimpleNamespace(fingerprint=lambda db:content)
        with mock.patch.object(wrapper.sqlite3,'connect',return_value=connection),mock.patch.dict(sys.modules,{'backup_check':backup_module}):
            with self.assertRaisesRegex(ValueError,'All 21 user tables'):self.job.backup_and_restore()

    def test_twenty_one_table_count_does_not_replace_complete_tablemap_comparison(self):
        content={'schemaSha256':'c'*64,'tables':{f't{i}':{'rows':1,'sha256':'d'*64} for i in range(21)}}
        changed=copy.deepcopy(content);changed['tables']['t0']['sha256']='f'*64
        (self.backup/'manifest.json').write_text(json.dumps({'verified':True,'fileSha256':wrapper.sha(self.backup/'snapshot.sqlite'),'content':content}))
        fake_db=mock.MagicMock()
        fake_db.execute.side_effect=lambda sql:types.SimpleNamespace(fetchall=lambda:[('ok',)] if 'integrity_check' in sql else [])
        connection=mock.MagicMock();connection.__enter__.return_value=fake_db
        backup_module=types.SimpleNamespace(fingerprint=lambda db:changed)
        with mock.patch.object(wrapper.sqlite3,'connect',return_value=connection),mock.patch.dict(sys.modules,{'backup_check':backup_module}):
            with self.assertRaisesRegex(ValueError,'Independent restore content differs'):self.job.backup_and_restore()


if __name__=='__main__':unittest.main()
