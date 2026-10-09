import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from merge_registry_seed import merge
from backup_check import fingerprint


class RegistryImport(unittest.TestCase):
    def test_import_only_missing_partitions_and_all_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ['seed','target']:
                db = sqlite3.connect(root / (name+'.sqlite'))
                for migration in sorted(Path('migrations').glob('*.sql')):
                    db.executescript(migration.read_text(encoding='utf-8'))
                db.execute('INSERT INTO reference_prices VALUES(?,?,?,?)', ('BTC',1,100 if name=='target' else 1,10))
                day = {'time':86400,'values':{'mvrv':3 if name=='target' else 1,'price':99 if name=='target' else 1}}
                if name=='seed': day['values']['issuance']=0
                db.execute('INSERT INTO network_months VALUES(?,?,?,?)',('LINK',0,json.dumps([day]),10))
                db.execute('INSERT INTO network_coverage VALUES(?,?,?,?,?,?)',('LINK','mvrv',86400,86400,1,10))
                if name=='seed':db.execute('INSERT INTO network_coverage VALUES(?,?,?,?,?,?)',('LINK','issuance',86400,86400,1,10))
                if name == 'seed':
                    db.executemany('INSERT INTO reference_prices VALUES(?,?,?,?)', [('ADA',i,2,10) for i in range(1,31)])
                db.commit(); db.close()
            def snapshot():
                db=sqlite3.connect(root/'target.sqlite')
                (root/'backup.json').write_text(json.dumps({'verified':True,'content':fingerprint(db)}))
                db.close()
            snapshot()
            (root/'seed.json').write_text(json.dumps({'fixture':False,'integrity':'ok','seedSha256':hashlib.sha256((root/'seed.sqlite').read_bytes()).hexdigest()}))
            def run(): return merge(root/'seed.sqlite',root/'target.sqlite',root/'seed.json',root/'backup.json')
            result=run()
            self.assertEqual(result['inserted']['reference_prices'],30)
            self.assertEqual(result['addedNetworkMetricValues'],1)
            self.assertEqual(result['existingNetworkValuesReplaced'],0)
            db=sqlite3.connect(root/'target.sqlite')
            self.assertEqual(db.execute('SELECT value FROM reference_prices WHERE asset="BTC"').fetchone()[0],100)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM reference_prices WHERE asset="ADA"').fetchone()[0],30)
            self.assertEqual(json.loads(db.execute('SELECT payload FROM network_months WHERE asset="LINK"').fetchone()[0])[0]['values'],{'mvrv':3,'price':99,'issuance':0})
            self.assertEqual(db.execute('SELECT COUNT(*) FROM network_coverage WHERE asset="LINK"').fetchone()[0],2)
            db.close()
            with self.assertRaisesRegex(ValueError,'changed after backup'): run()
            snapshot()
            self.assertEqual(run()['inserted']['reference_prices'],0)
            (root/'seed.json').write_text(json.dumps({'fixture':True,'integrity':'ok','seedSha256':''}))
            with self.assertRaisesRegex(ValueError,'Seed verification'): run()


if __name__ == '__main__': unittest.main()
