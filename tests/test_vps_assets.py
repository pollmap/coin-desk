import io, pathlib, sys, tarfile, tempfile, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'deploy/vps'))
from retain_assets import retain

def archive(name, body=b'old chart module'):
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w') as tar:
        entry=tarfile.TarInfo(name);entry.size=len(body);tar.addfile(entry,io.BytesIO(body))
    stream.seek(0)
    return stream

class RetainedAssets(unittest.TestCase):
    def test_retains_old_content_and_rejects_collision_and_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(retain(archive('./AnalysisChart-abc12345.js'),folder),1)
            retain(archive('./AnalysisChart-abc12345.js'),folder)
            with self.assertRaises(ValueError): retain(archive('AnalysisChart-abc12345.js',b'different'),folder)
            with self.assertRaises(ValueError): retain(archive('../escaped-abc12345.js'),folder)
            self.assertEqual((pathlib.Path(folder)/'AnalysisChart-abc12345.js').read_bytes(),b'old chart module')
