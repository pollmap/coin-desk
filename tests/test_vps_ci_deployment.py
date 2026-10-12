import gzip, hashlib, io, json, pathlib, sys, tempfile, unittest
from unittest.mock import patch, Mock
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from package_ci_deployment import prepare

class VerifiedImageArtifact(unittest.TestCase):
    def test_rejects_an_unverified_image_before_any_side_effect(self):
        with tempfile.TemporaryDirectory() as temp:
            target = pathlib.Path(temp) / 'artifact'
            for image, commit in [('other:latest', 'a'*40), ('coin-desk:ci', 'HEAD')]:
                with self.assertRaises(ValueError): prepare(image, commit, target)
                self.assertFalse(target.exists())

    def test_stream_bytes_and_commit_are_retained_in_the_artifact_manifest(self):
        content = bytes(range(256))*8193
        process = Mock(stdout=io.BytesIO(content))
        process.wait.return_value = 0; process.poll.return_value = 0
        with tempfile.TemporaryDirectory() as temp:
            target = pathlib.Path(temp) / 'artifact'
            source = {'release': 'vps-source', 'archive': 'vps-source.tar.gz', 'sha256': 'b'*64}
            with patch('package_ci_deployment.package', return_value=source), patch('package_ci_deployment.subprocess.check_output', return_value='sha256:'+'c'*64), patch('package_ci_deployment.subprocess.run'), patch('package_ci_deployment.subprocess.Popen', return_value=process):
                report = prepare('coin-desk:ci', 'a'*40, target)
            compressed = (target / report['imageArchive']).read_bytes()
            self.assertEqual(gzip.decompress(compressed), content)
            self.assertEqual(hashlib.sha256(compressed).hexdigest(), report['imageArchiveSha256'])
            self.assertEqual(report['imageTag'], 'coin-desk:git-'+'a'*40)
            self.assertEqual(json.loads((target/'deployment.json').read_text()), report)

    def test_failed_export_never_publishes_a_deployment_manifest(self):
        process = Mock(stdout=io.BytesIO(b'incomplete'))
        process.wait.return_value = 17; process.poll.return_value = 17
        with tempfile.TemporaryDirectory() as temp:
            target = pathlib.Path(temp) / 'artifact'
            with patch('package_ci_deployment.package', return_value={'release':'vps-source','archive':'source.tar.gz','sha256':'b'*64}), patch('package_ci_deployment.subprocess.check_output', return_value='sha256:'+'c'*64), patch('package_ci_deployment.subprocess.run'), patch('package_ci_deployment.subprocess.Popen', return_value=process):
                with self.assertRaises(RuntimeError): prepare('coin-desk:ci', 'a'*40, target)
            self.assertFalse((target/'deployment.json').exists())
