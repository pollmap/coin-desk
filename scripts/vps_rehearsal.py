"""Offline rehearsal using a read-only local cache; never a production export proof."""
import argparse,json,pathlib,sqlite3,tempfile,time
from backup_check import fingerprint
from import_d1_export import import_export
from vps_backup import backup

def rehearse(source,output):
    source=pathlib.Path(source).resolve(strict=True);output=pathlib.Path(output).resolve()
    output.mkdir(parents=True,exist_ok=True)
    folder=pathlib.Path(tempfile.mkdtemp(prefix='rehearsal-',dir=output))
    live=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
    isolated=sqlite3.connect(folder/'source-snapshot.sqlite')
    try:
        live.backup(isolated)
        expected=fingerprint(isolated)
        with (folder/'cache-export.sql').open('w',encoding='utf-8',newline='') as export:
            for line in isolated.iterdump(): export.write(line+'\n')
    finally: live.close();isolated.close()
    imported=import_export(folder/'cache-export.sql',folder/'coin-desk.sqlite')
    if imported['imported']!=expected: raise ValueError('Local cache content changed during isolated import')
    recovered=backup(folder/'coin-desk.sqlite',folder/'backups',folder/'backup-status.json')
    report={'verifiedAt':int(time.time()),'sourceKind':'local-cache-not-production-export',
            'originalOpenedReadOnly':True,'sourceCacheTables':len(expected['tables']),
            'sourceCacheRows':sum(row['rows'] for row in expected['tables'].values()),
            'allImportedTablesMatch':True,'backupRestoreVerified':True,
            'migrationsAcknowledged':imported['migrationsAcknowledged'],
            'restoredTables':len(recovered['content']['tables']),'productionDataOrServerVerified':False}
    (folder/'rehearsal.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return {'report':report,'database':str(folder/'coin-desk.sqlite'),'privateArtifacts':str(folder)}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True);parser.add_argument('--output',default='work/vps-rehearsal')
    args=parser.parse_args();print(json.dumps(rehearse(args.source,args.output),indent=2))
