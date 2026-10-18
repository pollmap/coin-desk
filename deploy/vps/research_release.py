"""Reviewed 0010 + API + disabled research-worker rollout.

Legacy collectors, quote hub, migration container, backups and other projects keep
their current image and identity. A later explicit enable changes only the research
process. Rollback never overwrites a live DB or removes additive research tables.
"""
import argparse, copy, hashlib, json, os, pathlib, shutil, sqlite3, subprocess, sys, time
from contextlib import closing
import selective_release as selective
import research_schema as schema

WORKER='research-worker'
RESEARCH_ENV={'COIN_DESK_DB','COIN_DESK_RELEASE','COIN_DESK_RESEARCH_ENABLED',
    'COIN_DESK_RESEARCH_MAX_JOB_SECONDS','COIN_DESK_RESEARCH_MAX_MARKETS','COIN_DESK_INJECTIVE_NETWORK'}

def require(value,message):
    if not value: raise ValueError(message)

def validate_configs(previous,candidate,image,release,before):
    require(previous['name']==candidate['name']=='coin-desk','Compose project changed')
    require(set(candidate['services'])==set(previous['services'])|{WORKER} and WORKER not in previous['services'],'Only a new research service is allowed')
    require(previous.get('networks')==candidate.get('networks'),'Network changed')
    for name,old in previous['services'].items():
        new=candidate['services'][name]
        if name!='api':require(old==new,'Protected service configuration changed: '+name);continue
        require(set(old)==set(new),'API fields changed')
        require(all(old[k]==new[k] for k in old if k not in ['image','environment']),'API containment changed')
        require({k:v for k,v in old.get('environment',{}).items() if k!='COIN_DESK_RELEASE'}=={k:v for k,v in new.get('environment',{}).items() if k!='COIN_DESK_RELEASE'},'API environment changed')
        require(new['image']==image and new['environment']['COIN_DESK_RELEASE']==release,'API release differs')
        require(old['image']==before['api']['Config']['Image'],'Previous API image differs from live baseline')
    worker=candidate['services'][WORKER];env=worker.get('environment',{})
    require(worker['image']==image and env.get('COIN_DESK_RELEASE')==release,'Research image/release differs')
    require(env.get('COIN_DESK_DB')=='/app/data/coin-desk.sqlite' and str(env.get('COIN_DESK_RESEARCH_ENABLED'))=='0','Research must use the existing DB and start disabled')
    require(not any('KEY' in k or 'TOKEN' in k or 'SECRET' in k for k in env),'Do not add unreviewed research credentials')
    require(set(env)==RESEARCH_ENV,'Research environment differs from reviewed fields')
    require(str(env['COIN_DESK_RESEARCH_MAX_JOB_SECONDS'])=='600' and str(env['COIN_DESK_RESEARCH_MAX_MARKETS'])=='10' and env['COIN_DESK_INJECTIVE_NETWORK']=='mainnet','Research execution bounds changed')
    require(worker.get('depends_on',{})=={} and worker.get('profiles')==['research'],'Research must not automatically migrate or join collectors')
    require(worker.get('command')==['node','server/research-worker.mjs'],'Research command differs')
    # Compose versions serialize byte limits as either integers or digit strings.
    # Match the exact reviewed value; do not coerce booleans, floats or units.
    memory=worker.get('mem_limit')
    require(float(worker['cpus'])==0.5 and (type(memory) is int and memory==512*1024**2 or type(memory) is str and memory==str(512*1024**2)),'Research resource limits differ')
    require(worker.get('read_only') is True and worker.get('user')=='10001:10001' and worker.get('cap_drop')==['ALL'] and 'no-new-privileges:true' in worker.get('security_opt',[]),'Research containment differs')
    require(not worker.get('ports') and len(worker.get('volumes',[]))==1 and worker['volumes'][0]['target']=='/app/data','Unexpected research ports or mounts')
    require(worker['volumes'][0]['source']==str(selective.ROOT/'shared/data'),'Research data source differs')
    require(worker.get('healthcheck',{}).get('test')==['CMD','node','server/research-worker.mjs','--health'],'Separate research health contract required')

def enabled_environment(content):
    lines=content.splitlines();key='COIN_DESK_RESEARCH_ENABLED='
    matches=[n for n,line in enumerate(lines) if line.startswith(key)]
    require(len(matches)==1 and lines[matches[0]]==key+'0','Exactly one disabled research setting required')
    lines[matches[0]]=key+'1'
    return '\n'.join(lines)+'\n'

def validate_enable_configs(disabled,enabled):
    expected=copy.deepcopy(disabled)
    require(str(expected['services'][WORKER]['environment'].get('COIN_DESK_RESEARCH_ENABLED'))=='0','Research must already be disabled')
    expected['services'][WORKER]['environment']['COIN_DESK_RESEARCH_ENABLED']='1'
    require(enabled==expected,'Enabling research may change only its enabled flag')

def require_collector_progress(before,after,now):
    old={r[0]:r[2] for r in before['lanes']};new={r[0]:r[2] for r in after['lanes']}
    for lane in ['quotes','background','recent','analysis']:
        require(isinstance(old.get(lane),(int,float)) and isinstance(new.get(lane),(int,float)) and new[lane]>old[lane] and now-180<=new[lane]<=now+60,'Existing collector did not progress: '+lane)

def deployment_type(base,pins,scope):
    Parent=selective.deployment_type(base,pins,scope)
    class ResearchDeployment(Parent):
        def config(self,folder,env):
            return super().config(folder,env)+['--profile','research']

        def validate_migrations(self,source,prior):
            schema.validate_migration_set(pins['schemaPlan'],source,prior)

        def write_environment(self):
            overrides={'COIN_DESK_API_IMAGE':self.image,'COIN_DESK_API_RELEASE':self.release,
                'COIN_DESK_RESEARCH_IMAGE':self.image,'COIN_DESK_RESEARCH_RELEASE':self.release,
                'COIN_DESK_RESEARCH_ENABLED':'0'}
            content='\n'.join([line for line in self.oldenv.read_text().splitlines() if line.split('=',1)[0] not in overrides]+[k+'='+v for k,v in overrides.items()])+'\n'
            if self.newenv.exists():require(not self.newenv.is_symlink() and self.newenv.read_text()==content,'Research candidate environment differs')
            else:
                with os.fdopen(os.open(self.newenv,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:f.write(content)

        def validate_configs(self,before):
            old=json.loads(self.run(self.config(selective.OLD,self.oldenv)+['config','--format','json']))
            new=json.loads(self.run(self.config(self.new,self.newenv)+['config','--format','json']))
            base.private_json(selective.AUDIT/'private-logs/previous-compose.json',old)
            base.private_json(selective.AUDIT/'private-logs/candidate-compose.json',new)
            validate_configs(old,new,self.image,self.release,before)
            self.report['protectedConfigsVerified']=selective.PROTECTED
            self.report['protectedContainerIdsBefore']={n:before[n]['Id'][:12] for n in selective.PROTECTED};self.persist()

        def rehearsal_database(self):
            return selective.AUDIT/'research-rehearsal.sqlite'

        def backup_and_restore(self):
            super().backup_and_restore()
            self.capacity('before isolated additive rehearsal',3*(selective.ROOT/'shared/data/coin-desk.sqlite').stat().st_size)
            target=self.rehearsal_database();require(not target.exists(),'Preserve prior migrated rehearsal')
            shutil.copy2(selective.AUDIT/'rehearsal.sqlite',target)
            sys.path.insert(0,str(self.new/'scripts'))
            from backup_check import fingerprint
            with closing(sqlite3.connect(target)) as db:before=fingerprint(db)
            migration=schema.apply(target,self.new/schema.MIGRATION,pins['schemaPlan'])
            with closing(sqlite3.connect(target)) as db:
                after=fingerprint(db);require(db.execute('PRAGMA integrity_check').fetchone()==('ok',),'Research clone integrity failed')
                require(not db.execute('PRAGMA foreign_key_check').fetchall(),'Research clone foreign keys failed')
            schema.compare_legacy_content(before,after)
            from vps_backup import backup,restore
            backup(target,selective.AUDIT/'research-clone-backups',selective.AUDIT/'research-clone-backup-status.json',budget_bytes=512*1024**2)
            snapshots=list((selective.AUDIT/'research-clone-backups').glob('*/snapshot.sqlite'));require(len(snapshots)==1,'One post-schema clone backup required')
            restored=selective.AUDIT/'research-independent-restore.sqlite';restore(snapshots[0],restored,snapshots[0].parent/'manifest.json')
            with closing(sqlite3.connect(restored.as_uri()+'?mode=ro',uri=True)) as db:require(fingerprint(db)==after,'Research schema independent restore differs')
            os.chown(target,10001,10001);os.chmod(target,0o640)
            proof={'migration':migration,'legacyContentPreserved':True,'newSchemaBackupRestored':True,
                'before':before,'after':after,'migratedCloneSha256':selective.sha(target),'restoredCloneSha256':selective.sha(restored)}
            base.private_json(selective.AUDIT/'research-schema-rehearsal.private.json',proof)
            self.report['researchSchemaRehearsed']=True;self.report['schemaPlanSha256']=hashlib.sha256(json.dumps(pins['schemaPlan'],sort_keys=True).encode()).hexdigest();self.persist()

        def rehearsal(self,report_name='candidate-runtime.json'):
            # Existing API rehearsal uses the migrated clone; immutable backup stays unchanged.
            super().rehearsal(report_name)
            self.capacity('before independent research worker smoke',self.rehearsal_database().stat().st_size)
            target=selective.AUDIT/'research-worker-smoke';require(not target.exists(),'Preserve prior worker smoke')
            target.mkdir(mode=0o700);os.chown(target,10001,10001)
            shutil.copy2(self.rehearsal_database(),target/'coin-desk.sqlite');os.chown(target/'coin-desk.sqlite',10001,10001)
            args=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','10001:10001','--cpus','.5','--memory','512m','-v',str(target)+':/app/data','-e','COIN_DESK_DB=/app/data/coin-desk.sqlite','-e','COIN_DESK_RESEARCH_ENABLED=0',self.image,'node','server/research-worker.mjs']
            self.run(args+['--once'],timeout=40);self.run(args+['--health'],timeout=15)
            # A true read-only mount proves template dry-run performs no database writes.
            readonly=args.copy();readonly[readonly.index(str(target)+':/app/data')]=str(target)+':/app/data:ro'
            self.run(readonly+['--dry-run'],timeout=60)
            # The old image reads its four collector lanes and market tables on the new schema.
            compatibility="import {openSqlite} from './server/sqlite.mjs';const db=openSqlite('/app/data/coin-desk.sqlite',{readOnly:true});for(const lane of ['quotes','background','recent','analysis']){if(!db.sqlite.prepare('SELECT lane FROM _coin_desk_runtime_runs WHERE lane=? LIMIT 1').get(lane))throw Error('missing lane');}db.sqlite.prepare('SELECT key FROM ingestion LIMIT 1').get();db.sqlite.close();console.log('legacy-reader-ok');"
            self.run(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','10001:10001','--memory','512m','--cpus','.5','-v',str(target)+':/app/data:ro','coin-desk:'+selective.OLD.name,'node','--input-type=module','-e',compatibility],timeout=30)
            seal_path=selective.AUDIT/'activation-seal.private.json';seal=json.loads(seal_path.read_text())
            seal['researchSchemaProofSha256']=selective.sha(selective.AUDIT/'research-schema-rehearsal.private.json')
            seal['researchMigratedCloneSha256']=selective.sha(self.rehearsal_database());seal['schemaPlanSha256']=self.report['schemaPlanSha256']
            base.private_json(seal_path,seal);self.report['researchDisabledSmokeVerified']=True;self.report['researchReadonlyDryRunVerified']=True;self.report['oldImageReadsNewSchema']=True;self.persist()

        def inspect_worker(self):
            return json.loads(self.run(['docker','inspect','coin-desk-research-worker-1']))[0]

        def activate(self):
            self.assert_current();before=self.verify_activation_inputs();seal=json.loads((selective.AUDIT/'activation-seal.private.json').read_text())
            require(self.report.get('researchDisabledSmokeVerified') and self.report.get('researchReadonlyDryRunVerified'),'Research image smoke tests required')
            require(seal['researchSchemaProofSha256']==selective.sha(selective.AUDIT/'research-schema-rehearsal.private.json') and seal['researchMigratedCloneSha256']==selective.sha(self.rehearsal_database()) and seal['schemaPlanSha256']==self.report['schemaPlanSha256'],'Research rehearsal seal differs')
            require(subprocess.run(['docker','inspect','coin-desk-research-worker-1'],capture_output=True).returncode!=0,'Research service already exists; use a separately reviewed update')
            self.validate_configs(before);self.capacity('before additive migration',3*(selective.ROOT/'shared/data/coin-desk.sqlite').stat().st_size)
            result={'commit':self.commit,'release':self.release,'previousRelease':selective.OLD.name,'startedAt':int(time.time()),'promoted':False,'schemaChanged':False,'attemptedServices':[],'rollbackServices':[]}
            try:
                result['migration']=schema.apply(selective.ROOT/'shared/data/coin-desk.sqlite',self.new/schema.MIGRATION,pins['schemaPlan']);result['schemaChanged']=True
                base.private_json(selective.AUDIT/'activation.json',result)
                sys.path.insert(0,str(self.new/'scripts'));from vps_backup import backup,restore
                saved=backup(selective.ROOT/'shared/data/coin-desk.sqlite',selective.AUDIT/'post-migration-backups',selective.AUDIT/'post-migration-backup-status.json',budget_bytes=512*1024**2)
                snapshots=list((selective.AUDIT/'post-migration-backups').glob('*/snapshot.sqlite'));require(len(snapshots)==1,'One live post-migration backup required')
                restore(snapshots[0],selective.AUDIT/'post-migration-restored.sqlite',snapshots[0].parent/'manifest.json')
                result['postMigrationBackupRestored']=saved['verified']
                result['postMigrationBackupManifestSha256']=selective.sha(snapshots[0].parent/'manifest.json')
                result['postMigrationBackupAt']=saved['completedAt']
                for service in ['api',WORKER]:
                    result['attemptedServices'].append(service);base.private_json(selective.AUDIT/'activation.json',result)
                    self.run(self.config(self.new,self.newenv)+['up','-d','--no-deps','--wait','--wait-timeout','180',service],timeout=210)
                    c=self.inspect_worker() if service==WORKER else self.containers()['api']
                    require(c['Image'] in self.report['imagePortability']['verifiedIds'] and c['Config']['Image']==self.image,'Activated research/API image differs')
                    require(all(self.containers()[n]['Id']==before[n]['Id'] for n in selective.PROTECTED),'A protected service changed')
                worker=self.inspect_worker();env=dict(item.split('=',1) for item in worker['Config']['Env'])
                require(env.get('COIN_DESK_RESEARCH_ENABLED')=='0','Worker must be disabled at initial deployment')
                self.run(['docker','exec','coin-desk-research-worker-1','node','server/research-worker.mjs','--health'],timeout=15)
                first=self.operating_snapshot();time.sleep(60);last=self.operating_snapshot()
                base.require_core_progress(first,last,time.time());require_collector_progress(first,last,time.time());result['sixCoreConfirmationsAdvanced']=True;result['fourCollectorsAdvanced']=True
                require(all(self.containers()[n]['Id']==before[n]['Id'] for n in selective.PROTECTED),'A protected service changed')
                link=selective.ROOT/('.current-'+selective.AUDIT.name+'-next');require(not link.exists() and not link.is_symlink(),'Temporary promotion link exists')
                link.symlink_to(self.new);os.replace(link,selective.ROOT/'current');result.update(promoted=True,researchEnabled=False,protectedServices=selective.PROTECTED)
            except BaseException:
                if WORKER in result['attemptedServices']:
                    try:
                        c=self.inspect_worker();require(c['Config']['Image']==self.image,'Refuse to stop another research image');self.run(['docker','stop','--time','30','coin-desk-research-worker-1']);result['rollbackServices'].append(WORKER)
                    except BaseException:result.setdefault('rollbackFailures',[]).append(WORKER)
                if 'api' in result['attemptedServices']:
                    try:
                        self.run(self.config(selective.OLD,self.oldenv)+['up','-d','--no-deps','--wait','--wait-timeout','180','api'],timeout=210);base.require_restored_image(before['api'],self.containers()['api'],'api');result['rollbackServices'].append('api')
                    except BaseException:result.setdefault('rollbackFailures',[]).append('api')
                result['liveDatabaseRestored']=False;result['additiveTablesRetained']=result['schemaChanged'];raise
            finally:result['completedAt']=int(time.time());base.private_json(selective.AUDIT/'activation.json',result)

        def enable(self):
            # Separate, explicit operational change after disabled deployment succeeds.
            require((selective.ROOT/'current').resolve()==self.new,'Current release differs before research enable')
            activation=json.loads((selective.AUDIT/'activation.json').read_text())
            require(activation.get('commit')==self.commit and activation.get('release')==self.release and activation.get('promoted') is True and activation.get('researchEnabled') is False and activation.get('postMigrationBackupRestored') is True,'Disabled activation and restored new schema are required')
            require(self.report.get('researchDisabledSmokeVerified') and self.report.get('researchReadonlyDryRunVerified') and self.report.get('oldImageReadsNewSchema'),'Research and legacy-reader rehearsal required')
            require(not (selective.AUDIT/'research-enable.json').exists(),'Preserve prior enable outcome; inspect it before retry')
            source=json.loads((self.new/'release-manifest.json').read_text())
            require(source.get('files')==scope['candidateFiles'] and source.get('sourceSha256')==scope['sourceSha256'],'Research source identity differs')
            for name,digest in source['files'].items():
                path=self.new/name
                require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(self.new) and selective.sha(path)==digest,'Research source changed: '+name)
            seal=json.loads((selective.AUDIT/'activation-seal.private.json').read_text())
            require(seal['environmentSha256']==selective.sha(self.newenv),'Disabled environment changed after rehearsal')
            before=self.containers();worker=self.inspect_worker()
            for container in [before['api'],worker]:
                require(container['Config']['Image']==self.image and container['Image'] in self.report['imagePortability']['verifiedIds'] and container['State'].get('Health',{}).get('Status')=='healthy','API/research current image or health differs')
            require(all(before[n]['Id']==seal['initialContainerIds'][n] for n in selective.PROTECTED),'Protected collector changed after activation')
            with closing(sqlite3.connect((selective.ROOT/'shared/data/coin-desk.sqlite').as_uri()+'?mode=ro',uri=True)) as db:
                require(schema.schema_hash(schema.schema(db))==activation['migration']['afterSchemaSha256'],'Live research schema changed')
                require(db.execute('SELECT sha256 FROM _coin_desk_migrations WHERE name=?',(pathlib.Path(schema.MIGRATION).name,)).fetchone()==(pins['schemaPlan']['ledgerSha256'],),'Research migration ledger differs')
            snapshots=list((selective.AUDIT/'post-migration-backups').glob('*/snapshot.sqlite'))
            require(len(snapshots)==1,'Verified post-migration snapshot required')
            manifest=snapshots[0].parent/'manifest.json';saved=json.loads(manifest.read_text())
            require(selective.sha(manifest)==activation['postMigrationBackupManifestSha256'] and selective.sha(snapshots[0])==saved['fileSha256'] and 0<=time.time()-saved['completedAt']<3600,'Fresh new-schema backup required before enable')
            require(set(saved['content']['tables'])==set(schema.LEGACY_TABLES+schema.NEW_TABLES),'Post-migration backup table set differs')
            self.capacity('before explicit research enable',memory_required=1024**3)
            original=self.newenv.read_text();updated=enabled_environment(original)
            stage=selective.AUDIT/'research-enabled.env';require(not stage.exists() and not stage.is_symlink(),'Preserve prior research environment checkpoint')
            with os.fdopen(os.open(stage,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as out:out.write(updated)
            old_config=json.loads(self.run(self.config(self.new,self.newenv)+['config','--format','json']))
            new_config=json.loads(self.run(self.config(self.new,stage)+['config','--format','json']))
            validate_enable_configs(old_config,new_config)
            result={'commit':self.commit,'release':self.release,'startedAt':int(time.time()),'enabled':False,'changedServices':[WORKER],'legacyServicesUnchanged':False,'rollbackDisabled':False,'liveDatabaseRestored':False}
            first=self.operating_snapshot();temporary=self.newenv.with_name('.'+self.newenv.name+'.research-next')
            require(not temporary.exists() and not temporary.is_symlink(),'Preserve prior environment transition')
            try:
                with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as out:out.write(updated);out.flush();os.fsync(out.fileno())
                require(selective.sha(self.newenv)==seal['environmentSha256'],'Environment changed concurrently')
                os.replace(temporary,self.newenv)
                self.run(self.config(self.new,self.newenv)+['up','-d','--no-deps','--wait','--wait-timeout','180',WORKER],timeout=210)
                current=self.inspect_worker();env=dict(item.split('=',1) for item in current['Config']['Env'])
                require(current['Config']['Image']==self.image and current['Image'] in self.report['imagePortability']['verifiedIds'] and env.get('COIN_DESK_RESEARCH_ENABLED')=='1','Enabled worker identity differs')
                self.run(['docker','exec','coin-desk-research-worker-1','node','server/research-worker.mjs','--health'],timeout=15)
                time.sleep(60);last=self.operating_snapshot();base.require_core_progress(first,last,time.time());require_collector_progress(first,last,time.time())
                require(all(self.containers()[n]['Id']==before[n]['Id'] for n in selective.SERVICES),'An existing service changed while enabling research')
                result.update(enabled=True,legacyServicesUnchanged=True,sixCoreConfirmationsAdvanced=True,fourCollectorsAdvanced=True)
                base.private_json(selective.AUDIT/'research-enable-natural.private.json',{'before':first,'after':last})
            except BaseException:
                # Only this new worker is rolled back; market tables and publication rows stay.
                require(self.newenv.read_text() in [original,updated],'Concurrent environment change prevents automatic rollback')
                rollback=self.newenv.with_name('.'+self.newenv.name+'.research-disabled')
                require(not rollback.exists() and not rollback.is_symlink(),'Preserve prior rollback checkpoint')
                with os.fdopen(os.open(rollback,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as out:out.write(original);out.flush();os.fsync(out.fileno())
                os.replace(rollback,self.newenv)
                try:
                    self.run(self.config(self.new,self.newenv)+['up','-d','--no-deps','--wait','--wait-timeout','180',WORKER],timeout=210);result['rollbackDisabled']=True
                except BaseException:
                    current=self.inspect_worker();require(current['Config']['Image']==self.image,'Refuse to stop another research release');self.run(['docker','stop','--time','30','coin-desk-research-worker-1']);result['rollbackStopped']=True
                raise
            finally:result['completedAt']=int(time.time());base.private_json(selective.AUDIT/'research-enable.json',result)
    return ResearchDeployment

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('phase',choices=['prepare','activate','enable']);p.add_argument('commit');p.add_argument('--audit',required=True);p.add_argument('--execute-reviewed-selective-rollout',action='store_true');args=p.parse_args()
    require(args.execute_reviewed_selective_rollout,'Explicit reviewed rollout flag required')
    selective.AUDIT=pathlib.Path(args.audit);base,pins,scope=selective.reviewed_module(args.commit,research_contract=schema)
    job=deployment_type(base,pins,scope)(args.commit);getattr(job,args.phase)()
    print(json.dumps({'phase':args.phase,'commit':job.commit,'release':job.release,'researchEnabled':args.phase=='enable','prepared':job.report.get('prepared',False)}))

if __name__=='__main__':main()
