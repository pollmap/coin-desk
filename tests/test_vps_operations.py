import pathlib,sqlite3,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'deploy/vps'))
from operations_report import report,LANES

class OperationsEvidence(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=pathlib.Path(self.tmp.name)/'db.sqlite'
        self.start=1790985600 # 2026-10-03 UTC
        db=sqlite3.connect(self.path)
        db.executescript('CREATE TABLE _coin_desk_runtime_runs(lane,scheduled_at,started_at,completed_at,outcome); CREATE TABLE daily_briefings(id,created_at); CREATE TABLE ingestion(key,last_success,data_as_of,error,failures); CREATE TABLE state(key,value);')
        db.executemany('INSERT INTO _coin_desk_runtime_runs VALUES(?,?,?,?,?)',[(lane,self.start+i*60,self.start+i*60+2,self.start+i*60+5,'ok') for lane in LANES for i in range(1440)])
        db.commit();db.close()

    def test_partial_day_cannot_pass_as_full_day_and_does_not_write(self):
        before=self.path.read_bytes()
        r=report(self.path,'2026-10-03',now=self.start+7200)
        self.assertFalse(r['completeUtcDay']);self.assertFalse(r['allDayScheduledRunsPresent'])
        self.assertEqual(r['lanes']['quotes']['expected'],118)
        self.assertEqual(self.path.read_bytes(),before)

    def test_full_day_preserves_missing_and_failed_runs(self):
        db=sqlite3.connect(self.path)
        db.execute('DELETE FROM _coin_desk_runtime_runs WHERE lane=? AND scheduled_at=?',('quotes',self.start+600))
        db.execute("UPDATE _coin_desk_runtime_runs SET outcome='error' WHERE lane='analysis' AND scheduled_at=?",(self.start+60,))
        db.commit();db.close()
        r=report(self.path,'2026-10-03',now=self.start+86520)
        self.assertTrue(r['completeUtcDay']);self.assertFalse(r['allDayScheduledRunsPresent'])
        self.assertEqual(r['lanes']['quotes']['missing'],1)
        self.assertEqual(r['lanes']['quotes']['maxScheduledGapSeconds'],120)
        self.assertEqual(r['lanes']['analysis']['outcomes']['error'],1)
        self.assertFalse(r['waiting48hRequired'])

    def test_future_day_refused(self):
        with self.assertRaises(ValueError): report(self.path,'2026-10-04',now=self.start)
