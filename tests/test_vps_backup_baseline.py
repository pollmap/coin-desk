"""Historical backup identity is restored without relaxing rollout containment."""
import copy
import hashlib
import json
import pathlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'deploy/vps'))
import research_release as subject


class BackupBaseline(unittest.TestCase):
    def setUp(self):
        self.baseline={'containerId':'a'*64,'imageTag':'coin-desk:vps-'+'b'*16,
            'imageId':'sha256:'+'c'*64,'release':'vps-'+'b'*16,
            'enabledAssets':'BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE'}
        self.config={'image':self.baseline['imageTag'],'command':['node','server/backup-runner.mjs'],
            'user':'10001:10001','read_only':True,'cap_drop':['ALL'],
            'security_opt':['no-new-privileges:true'],'cpus':0.25,'mem_limit':'536870912',
            'environment':{'COIN_DESK_RELEASE':self.baseline['release'],'ENABLED_ASSETS':self.baseline['enabledAssets'],
                'COIN_DESK_DB':'/app/data/coin-desk.sqlite','BACKUP_RETENTION_DAYS':'14','BACKUP_BUDGET_BYTES':'2147483648'},
            'volumes':[{'type':'bind','source':'/srv/services/coin-desk/shared/data','target':'/app/data'},
                {'type':'bind','source':'/srv/services/coin-desk/backups','target':'/app/backups'}]}
        self.image={'Id':self.baseline['imageId'],'Config':{'Env':['PATH=/usr/local/bin:/usr/bin','NODE_VERSION=22']}}
        self.live={'Id':self.baseline['containerId'],'Image':self.baseline['imageId'],
            'Config':{'Image':self.baseline['imageTag'],'Env':self.image['Config']['Env']+[key+'='+value for key,value in self.config['environment'].items()],
                'Cmd':self.config['command'],'User':self.config['user']},
            'HostConfig':{'ReadonlyRootfs':True,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges:true'],
                'NanoCpus':250000000,'Memory':536870912,'PortBindings':{}},
            'Mounts':[{'Type':item['type'],'Source':item['source'],'Destination':item['target'],'RW':True} for item in self.config['volumes']]}

    def test_canonical_documents_contain_only_three_previous_and_one_candidate_fields(self):
        docs=subject.backup_override_documents(self.baseline)
        self.assertEqual(set(docs),{'previous','candidate'})
        self.assertEqual(json.loads(docs['previous']),{'services':{'backup':{'image':self.baseline['imageTag'],
            'environment':{'COIN_DESK_RELEASE':self.baseline['release'],'ENABLED_ASSETS':self.baseline['enabledAssets']}}}})
        self.assertEqual(json.loads(docs['candidate']),{'services':{'backup':{'environment':{'ENABLED_ASSETS':self.baseline['enabledAssets']}}}})
        for body in docs.values():self.assertEqual(body,json.dumps(json.loads(body),sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n')

    def test_missing_extra_ambiguous_and_malformed_baseline_fields_are_rejected(self):
        damaged=copy.deepcopy(self.baseline);damaged['unreviewed']='x'
        values=[damaged,{key:value for key,value in self.baseline.items() if key!='imageId'}]
        for key,value in [('imageTag','coin-desk:latest'),('imageId','sha256:bad'),('containerId','a'*63),
                ('release','vps-'+'d'*16),('enabledAssets','BTC,BTC'),('enabledAssets','BTC\nSECRET=x'),
                ('enabledAssets','all'),('enabledAssets',''),('enabledAssets',None)]:
            values.append({**self.baseline,key:value})
        for baseline in values:
            with self.subTest(baseline=baseline),self.assertRaises(ValueError):subject.backup_override_documents(baseline)

    def test_live_identity_and_tag_resolution_must_both_match_reviewed_pin(self):
        subject.require_backup_baseline(self.baseline,self.live,self.image)
        for field,value in [('Id','d'*64),('Image','sha256:'+'d'*64)]:
            altered=copy.deepcopy(self.live);altered[field]=value
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'identity'):subject.require_backup_baseline(self.baseline,altered,self.image)
        altered=copy.deepcopy(self.live);altered['Config']['Image']='coin-desk:other'
        with self.assertRaisesRegex(ValueError,'identity'):subject.require_backup_baseline(self.baseline,altered,self.image)
        with self.assertRaisesRegex(ValueError,'tag changed'):subject.require_backup_baseline(self.baseline,self.live,{**self.image,'Id':'sha256:'+'d'*64})
        for key in ['COIN_DESK_RELEASE','ENABLED_ASSETS']:
            altered=copy.deepcopy(self.live);altered['Config']['Env']=[item if not item.startswith(key+'=') else key+'=changed' for item in altered['Config']['Env']]
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'environment'):subject.require_backup_baseline(self.baseline,altered,self.image)

    def configs(self):
        old={'services':{'backup':copy.deepcopy(self.config),'api':{'image':'api-old'},'quotes':{'image':'quotes-old'}},'networks':{'default':{'name':'private'}}}
        old['services']['backup']['image']='coin-desk:vps-'+'e'*16
        old['services']['backup']['environment'].update(COIN_DESK_RELEASE='vps-'+'e'*16,ENABLED_ASSETS='all')
        new=copy.deepcopy(old);new['services']['backup']['image']='candidate';new['services']['backup']['environment']['COIN_DESK_RELEASE']='candidate'
        resolved_old=copy.deepcopy(old);resolved_old['services']['backup']=copy.deepcopy(self.config)
        resolved_new=copy.deepcopy(new);resolved_new['services']['backup']['environment']['ENABLED_ASSETS']=self.baseline['enabledAssets']
        return old,new,resolved_old,resolved_new

    def test_historical_image_release_and_assets_drift_is_corrected_only_in_approved_fields(self):
        subject.require_backup_override_scope(*self.configs(),self.baseline)
        for side in [2,3]:
            for field in ['image','volumes','command','cpus','environment']:
                values=list(self.configs())
                if field=='environment':values[side]['services']['backup'][field]['BACKUP_RETENTION_DAYS']='1'
                else:values[side]['services']['backup'][field]='changed'
                with self.subTest(side=side,field=field),self.assertRaisesRegex(ValueError,'unrelated'):subject.require_backup_override_scope(*values,self.baseline)
            values=list(self.configs());values[side]['services']['quotes']['image']='changed'
            with self.assertRaisesRegex(ValueError,'unrelated'):subject.require_backup_override_scope(*values,self.baseline)

    def test_rollback_contract_matches_live_environment_resources_process_and_mounts(self):
        subject.require_backup_live_config(self.config,self.live,self.image)
        alterations=[('Config','Cmd',['node','other.mjs']),('Config','User','0:0'),
            ('Config','Entrypoint',['sh','-c']),('Config','WorkingDir','/other'),
            ('HostConfig','ReadonlyRootfs',False),('HostConfig','CapDrop',[]),('HostConfig','SecurityOpt',[]),
            ('HostConfig','Memory',1073741824),('HostConfig','NanoCpus',1000000000),('HostConfig','PortBindings',{'8080/tcp':[]})]
        for group,key,value in alterations:
            changed=copy.deepcopy(self.live);changed[group][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):subject.require_backup_live_config(self.config,changed,self.image)
        changed=copy.deepcopy(self.live);changed['Config']['Env'].append('UNREVIEWED_FLAG=1')
        with self.assertRaisesRegex(ValueError,'environment'):subject.require_backup_live_config(self.config,changed,self.image)
        changed=copy.deepcopy(self.live);changed['Mounts'][0]['RW']=False
        with self.assertRaisesRegex(ValueError,'mounts'):subject.require_backup_live_config(self.config,changed,self.image)

    def test_compose_null_entrypoint_inherits_image_but_empty_override_is_not_inherited(self):
        self.image['Config'].update(Entrypoint=['docker-entrypoint.sh'],WorkingDir='/app')
        self.live['Config'].update(Entrypoint=['docker-entrypoint.sh'],WorkingDir='/app')
        self.config.update(entrypoint=None,working_dir=None)
        subject.require_backup_live_config(self.config,self.live,self.image)
        self.config['entrypoint']=[]
        with self.assertRaisesRegex(ValueError,'executable context'):subject.require_backup_live_config(self.config,self.live,self.image)

    def job(self,folder):
        documents=subject.backup_override_documents(self.baseline)
        pins={'backupBaseline':self.baseline,'backupOverrideSha256':{key:hashlib.sha256(body.encode('utf-8')).hexdigest() for key,body in documents.items()}}
        class Base:
            def config(self,root,env):return ['docker','compose','--env-file',str(env),'-f',str(root/'compose.yaml')]
        cls=subject.deployment_type(SimpleNamespace(Deployment=Base),pins,{})
        job=cls();job.new=folder/'candidate';job.newenv=folder/'new.env';job.oldenv=folder/'old.env'
        job.run=mock.Mock(return_value=json.dumps([self.image]).encode())
        return job,pins

    def test_candidate_and_rollback_scopes_are_separate_and_files_are_tamper_checked(self):
        with tempfile.TemporaryDirectory() as path:
            folder=pathlib.Path(path)
            with mock.patch.object(subject.selective,'AUDIT',folder),mock.patch.object(subject.selective,'OLD',folder/'old'):
                job,pins=self.job(folder)
                normal_old=job.config(subject.selective.OLD,job.oldenv)
                self.assertNotIn(str(folder/'previous-backup.override.json'),normal_old)
                rollback=job.previous_backup_config();candidate=job.config(job.new,job.newenv)
                self.assertIn(str(folder/'previous-backup.override.json'),rollback)
                self.assertNotIn(str(folder/'candidate-backup.override.json'),rollback)
                self.assertIn(str(folder/'candidate-backup.override.json'),candidate)
                self.assertNotIn(str(folder/'previous-backup.override.json'),candidate)
                job.run.return_value=json.dumps([{**self.image,'Id':'sha256:'+'d'*64}]).encode()
                with self.assertRaisesRegex(ValueError,'image tag changed'):job.previous_backup_config()
                job.run.return_value=json.dumps([self.image]).encode()
                (folder/'previous-backup.override.json').write_text('{}')
                with self.assertRaisesRegex(ValueError,'changed after review'):job.previous_backup_config()
                pins['backupOverrideSha256']['candidate']='f'*64
                with self.assertRaisesRegex(ValueError,'hashes differ'):job.config(job.new,job.newenv)

    def test_prepared_baseline_and_both_overrides_are_part_of_activation_seal(self):
        with tempfile.TemporaryDirectory() as path:
            folder=pathlib.Path(path)
            with mock.patch.object(subject.selective,'AUDIT',folder):
                job,pins=self.job(folder);seal=job.backup_seal()
                job.verify_backup_seal(seal)
                altered=copy.deepcopy(seal);altered['backupBaseline']['containerId']='d'*64
                with self.assertRaisesRegex(ValueError,'Prepared backup'):job.verify_backup_seal(altered)
                altered=copy.deepcopy(seal);altered['backupOverrideSha256']['candidate']='d'*64
                with self.assertRaisesRegex(ValueError,'Prepared backup'):job.verify_backup_seal(altered)
                pins.pop('backupBaseline')
                with self.assertRaisesRegex(ValueError,'Prepared backup'):job.verify_backup_seal(seal)


if __name__=='__main__':unittest.main()
