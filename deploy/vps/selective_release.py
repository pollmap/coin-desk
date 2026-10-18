"""Selective rollout using repository-owned, SHA-pinned deployment engine.

No migration, collector replacement, pruning, live restore or budget reset.
Import performs no deployment. Final main CI and artifact/scope pins are mandatory.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time

ROOT=pathlib.Path('/srv/services/coin-desk')
AUDIT=ROOT/'audit/unconfigured'
OLD=ROOT/'releases/unconfigured'
CHANGED=[]
SERVICES=['api','quotes','background','recent','analysis','backup','quote-hub','migrate']
PROTECTED=[name for name in SERVICES if name not in CHANGED]
GIB=1024**3

def require(value,message):
    if not value: raise ValueError(message)

def sha(path):
    with pathlib.Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def require_backup_metadata_status(state, started_at):
    require(isinstance(state,dict),'Invalid backup status')
    require(state.get('ok') is True and state.get('verified') is True and
            type(state.get('completedAt')) is int and started_at <= state['completedAt'] <= time.time()+60 and
            state.get('backupContract')=='sqlite-original-v1', 'New backup contract has not completed')
    metadata=state.get('referenceMetadata',{})
    require(isinstance(metadata,dict),'Original metadata backup proof is missing')
    require(metadata.get('schemaVersion')==1 and metadata.get('state') in ['absent','verified','unindexed_snapshots','bundled_reference_only'] and
            type(metadata.get('snapshotCount')) is int and 0 <= metadata['snapshotCount'] <= 1024,
            'Original metadata backup proof is missing')

def reviewed_module(commit, research_contract=None):
    """Only declared API/hub/backup changes; collector identities remain untouched."""
    global OLD, CHANGED, PROTECTED
    require(re.fullmatch('[a-f0-9]{40}', commit), 'Exact final main commit required')
    require(AUDIT.resolve() == AUDIT and AUDIT.parent == ROOT/'audit', 'Owned nonsymlink audit required')
    pins = json.loads((AUDIT/'reviewed-pins.json').read_text())
    scope = json.loads((AUDIT/'source-scope.json').read_text())
    artifact = json.loads((AUDIT/'deployment.json').read_text())
    require(pins.get('executeAllowed') is True and pins.get('commit') == commit == scope.get('commit') == artifact.get('commit'), 'Reviewed exact commit mismatch')
    require(re.fullmatch('vps-[a-f0-9]{16}', pins.get('previousRelease','')), 'Invalid previous release')
    OLD = ROOT/'releases'/pins['previousRelease']
    CHANGED = pins.get('changedServices')
    if research_contract is None:
        require(CHANGED in [['api'], ['quote-hub','api']], 'Only reviewed API or API/hub rollout supported')
    else:
        require(pins.get('deploymentKind')=='research-additive-v1' and CHANGED in [['api','research-worker'], ['api','research-worker','backup']], 'Explicit research-only extension contract required')
        research_contract.validate_plan(pins.get('schemaPlan'))
    PROTECTED = [name for name in SERVICES if name not in CHANGED]
    require(pins.get('mainCiAllFivePassed') is True and pins.get('mainCiHead') == commit, 'Final main CI required')
    inputs=['deployment.json','source-scope.json','selective_release.py','rollout_engine.py']
    if research_contract is not None: inputs+=['research_release.py','research_schema.py']
    require(set(pins.get('files',{}))==set(inputs),'Unexpected reviewed input set')
    for name in inputs:
        require(sha(AUDIT/name) == pins['files'][name], 'Reviewed input differs: '+name)
    require(artifact.get('containsPrivateData') is False and scope.get('containsPrivateData') is False, 'Private-free source required')
    require(pins.get('release') == artifact.get('release') == scope.get('release'), 'Artifact/source/runtime release differs')
    spec=importlib.util.spec_from_file_location('reviewed_rollout_engine', AUDIT/'rollout_engine.py')
    base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
    base.ROOT,base.AUDIT,base.OLD,base.CHANGED,base.PROTECTED=ROOT,AUDIT,OLD,CHANGED,PROTECTED
    base.SHADOW_API,base.SHADOW_HUB,base.SHADOW_NETWORK = [f'coin-desk-{AUDIT.name}-{kind}-check' for kind in ['api','hub','network']]
    ports=pins.get('shadowPorts',[])
    require(len(ports)==2 and len(set(ports))==2 and all(type(p) is int and 18430<=p<=18999 for p in ports), 'Two distinct reviewed loopback shadow ports required')
    base.API_PORT,base.HUB_PORT=ports
    return base,pins,scope

def deployment_type(base,pins,scope):
    class Deployment(base.Deployment):
        def request(self,path,port=None,timeout=15):
            return super().request(path,base.API_PORT if port is None else port,timeout)

        def capacity(self,label,remaining=0,memory_required=1536*1024**2):
            super().capacity(label,remaining,memory_required)
            require(shutil.disk_usage(ROOT).free>=8*GIB+remaining,'History-space protection would be crossed by staging')

        def write_environment(self):
            overrides={'COIN_DESK_API_IMAGE':self.image,'COIN_DESK_API_RELEASE':self.release}
            if 'quote-hub' in CHANGED: overrides['COIN_DESK_HUB_IMAGE']=self.image
            if 'backup' in CHANGED: overrides.update(COIN_DESK_BACKUP_IMAGE=self.image, COIN_DESK_BACKUP_RELEASE=self.release)
            content='\n'.join([line for line in self.oldenv.read_text().splitlines() if line.split('=',1)[0] not in overrides]+[key+'='+value for key,value in overrides.items()])+'\n'
            if self.newenv.exists():
                require(not self.newenv.is_symlink() and self.newenv.read_text()==content,'Candidate environment differs')
            else:
                descriptor=os.open(self.newenv,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(descriptor,'w') as stream:stream.write(content)

        def source_and_image(self):
            source_name=self.manifest['sourceArchive']
            require(pathlib.Path(source_name).name==source_name,'Unsafe source archive name')
            source_path=AUDIT/source_name
            require(not source_path.is_symlink() and sha(source_path)==self.manifest['sourceArchiveSha256'],'Source archive SHA differs before preparation')
            with tarfile.open(source_path) as archive:
                planned=json.load(archive.extractfile('release-manifest.json'))
            require(planned.get('sourceSha256')==scope.get('sourceSha256') and planned.get('files')==scope.get('candidateFiles'),'Reviewed full source scope differs before image work')
            previous=json.loads((OLD/'release-manifest.json').read_text())['files']
            next_files=planned['files']
            declared=sorted(name for name in set(previous)|set(next_files) if previous.get(name)!=next_files.get(name))
            require(declared==scope.get('changedSourceFiles'),'Unreviewed source difference before preparation')
            super().source_and_image()
            manifest=json.loads((self.new/'release-manifest.json').read_text())
            require(manifest.get('sourceSha256')==scope.get('sourceSha256'),'Candidate source identity differs')
            require(manifest.get('files')==scope.get('candidateFiles'),'Complete candidate source mapping differs')
            old=json.loads((OLD/'release-manifest.json').read_text())['files']
            new=manifest['files']
            changed=sorted(name for name in set(old)|set(new) if old.get(name)!=new.get(name))
            require(changed==scope.get('changedSourceFiles'),'Unreviewed source difference')
            for name,wanted in new.items():
                path=self.new/name
                require(path.is_file() and not path.is_symlink() and sha(path)==wanted,'Extracted source mismatch: '+name)
            self.report['sourceScopeVerified']=True
            self.persist()

        def rehearsal(self,report_name='candidate-runtime.json'):
            self.capacity('before two-service shadow rehearsal',memory_required=3*GIB)
            super().rehearsal(report_name)
            snapshot=self.containers()
            initial=self.initial_container_ids(SERVICES)
            require(all(snapshot[name]['Id']==initial[name] for name in SERVICES),'An original service changed during preparation')
            seal={'commit':self.commit,'release':self.release,'canonicalSha256':sha(AUDIT/'canonical-dist.tar'),'environmentSha256':sha(self.newenv),'initialContainerIds':initial,'imagePortability':self.report['imagePortability'],'backupFileSha256':self.report['backupFileSha256'],'sourceScopeSha256':sha(AUDIT/'source-scope.json')}
            base.private_json(AUDIT/'activation-seal.private.json',seal)

        def backup_and_restore(self):
            super().backup_and_restore()
            snapshots=list((AUDIT/'backups').glob('*/snapshot.sqlite'))
            require(len(snapshots)==1,'Exactly one fresh owned backup required')
            snapshot=snapshots[0]
            manifest=snapshot.parent/'manifest.json'
            clone=AUDIT/'rehearsal.sqlite'
            expected=json.loads(manifest.read_text())
            require(len(expected['content']['tables'])==21,'All 21 user tables must be included in the backup')
            sys.path.insert(0,str(self.new/'scripts'))
            from backup_check import fingerprint
            with sqlite3.connect(clone.as_uri()+'?mode=ro',uri=True) as db:
                require(db.execute('PRAGMA integrity_check').fetchall()==[('ok',)],'Independent restore integrity failed')
                require(not db.execute('PRAGMA foreign_key_check').fetchall(),'Independent restore foreign keys differ')
                require(fingerprint(db)==expected['content'],'Independent restore content differs')
            proof={'verified':True,'independentRestoreVerified':True,'liveDatabaseOverwritten':False,'sourceSnapshotSha256':sha(snapshot),'restoredSnapshotSha256':sha(clone),'manifestSha256':sha(manifest),'schemaSha256':expected['content']['schemaSha256'],'userTableCount':len(expected['content']['tables']),'manifestRelativePath':str(manifest.relative_to(ROOT)),'sourceSnapshotRelativePath':str(snapshot.relative_to(ROOT)),'restoreRelativePath':str(clone.relative_to(ROOT)),'verifiedAt':int(time.time()),'contentMatches':True}
            base.private_json(AUDIT/'backup-restore-reviewed.private.json',proof)
            self.verify_reference_backup(snapshot, expected, AUDIT/'rainbow-original')

        def verify_reference_backup(self, snapshot, manifest, restored_directory=None):
            metadata=manifest.get('referenceMetadata')
            if metadata is None:
                require('backup' not in CHANGED, 'Selected backup rollout requires metadata-aware backup')
                return
            helper=self.new/'scripts/rainbow_reference_backup.py'
            require(helper.is_file() and not helper.is_symlink() and sha(helper)==scope['candidateFiles'].get('scripts/rainbow_reference_backup.py'), 'Original metadata restore helper differs from reviewed source')
            spec=importlib.util.spec_from_file_location('reviewed_rainbow_restore',helper)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            module.verify_backup(pathlib.Path(snapshot).parent/'rainbow-original',metadata)
            if restored_directory is not None:
                module.verify_backup(restored_directory,metadata)

        def verify_active_backup(self, started_at):
            deadline=time.monotonic()+base.BACKUP_START_SECONDS
            while True:
                path=ROOT/'shared/data/backup-status.json'
                try:
                    require(path.is_file() and not path.is_symlink() and path.stat().st_size<=16384,'Invalid backup status')
                    state=json.loads(path.read_text())
                    require_backup_metadata_status(state,started_at)
                    return {'verified':True,'completedAt':state['completedAt'],'referenceMetadata':state['referenceMetadata']}
                except (OSError,ValueError):
                    require(time.monotonic()<deadline,'Updated backup process did not verify metadata within the bounded backup startup window')
                    time.sleep(2)

        def run(self,args,timeout=180,input_bytes=None):
            args=list(args)
            if args[:2]==['docker','compose'] and 'up' in args:
                offset=args.index('up')+1
                args[offset:offset]=['--no-build','--pull','never']
            return super().run(args,timeout,input_bytes)

        def verify_activation_inputs(self):
            seal=json.loads((AUDIT/'activation-seal.private.json').read_text())
            require(seal['commit']==self.commit and seal['release']==self.release,'Candidate seal identity differs')
            require(seal['canonicalSha256']==sha(AUDIT/'canonical-dist.tar') and seal['environmentSha256']==sha(self.newenv) and seal['sourceScopeSha256']==sha(AUDIT/'source-scope.json'),'Candidate sealed inputs changed')
            require(seal['imagePortability']==self.report['imagePortability'] and seal['backupFileSha256']==self.report['backupFileSha256'],'Prepared image or backup identity changed')
            self.verify_backup_checkpoint()
            proof=json.loads((AUDIT/'backup-restore-reviewed.private.json').read_text())
            snapshots=list((AUDIT/'backups').glob('*/snapshot.sqlite'))
            require(len(snapshots)==1 and sha(snapshots[0])==proof['sourceSnapshotSha256']==seal['backupFileSha256'] and sha(AUDIT/'rehearsal.sqlite')==proof['restoredSnapshotSha256'] and sha(snapshots[0].parent/'manifest.json')==proof['manifestSha256'] and proof['userTableCount']==21 and proof['contentMatches'] is True,'Reviewed independent backup changed')
            self.verify_reference_backup(snapshots[0],json.loads((snapshots[0].parent/'manifest.json').read_text()),AUDIT/'rainbow-original')
            for field,sha_field in [('sourceArchive','sourceArchiveSha256'),('imageArchive','imageArchiveSha256')]:
                name=self.manifest[field]
                require(pathlib.Path(name).name==name and not (AUDIT/name).is_symlink() and sha(AUDIT/name)==self.manifest[sha_field],'Activation artifact hash mismatch')
            with tarfile.open(AUDIT/self.manifest['sourceArchive'],'r:gz') as archive:
                source_body=archive.extractfile('release-manifest.json').read()
            require(not self.new.is_symlink() and not (self.new/'release-manifest.json').is_symlink() and (self.new/'release-manifest.json').read_bytes()==source_body,'Activation source manifest changed')
            source=json.loads(source_body)
            require(source['files']==scope['candidateFiles'] and source['sourceSha256']==scope['sourceSha256'],'Activation reviewed source differs')
            for name,wanted in source['files'].items():
                path=self.new/name
                require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(self.new) and sha(path)==wanted,'Activation extracted source changed: '+name)
            with tarfile.open(AUDIT/self.manifest['imageArchive'],'r:gz') as archive:
                image_manifest=json.load(archive.extractfile('manifest.json'))
                config_body=archive.extractfile(image_manifest[0]['Config']).read()
            require('sha256:'+hashlib.sha256(config_body).hexdigest()==seal['imagePortability']['ciConfigId'],'Activation CI image config differs')
            loaded=json.loads(self.run(['docker','image','inspect',self.image]))[0]
            cfg=json.loads(config_body)
            require(loaded['Id']==seal['imagePortability']['loadedId'] and loaded['RootFS']['Layers']==cfg['rootfs']['diff_ids'] and loaded['Os']=='linux' and loaded['Architecture']=='amd64','Activation loaded image changed')
            before=self.containers()
            require(all(before[name]['Id']==seal['initialContainerIds'][name] for name in SERVICES),'An original service changed after rehearsal')
            return before

        def activate(self):
            before=self.verify_activation_inputs()
            super().activate()
            require(all(self.containers()[name]['Id']==before[name]['Id'] for name in PROTECTED),'A protected service changed')
    return Deployment

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['prepare','activate'])
    parser.add_argument('--audit',required=True)
    parser.add_argument('commit')
    parser.add_argument('--execute-reviewed-selective-rollout',action='store_true')
    args=parser.parse_args()
    AUDIT=pathlib.Path(args.audit)
    require(re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',AUDIT.name), 'Invalid audit name')
    require(args.execute_reviewed_selective_rollout,'Explicit reviewed rollout flag required')
    base,pins,scope=reviewed_module(args.commit)
    deployment=deployment_type(base,pins,scope)(args.commit)
    getattr(deployment,args.phase)()
    print(json.dumps({'phase':args.phase,'commit':deployment.commit,'release':deployment.release,'servicesChanged':CHANGED,'protectedServices':PROTECTED,'schemaChanged':False,'prepared':deployment.report.get('prepared',False)}))
