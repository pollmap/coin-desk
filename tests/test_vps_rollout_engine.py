"""Local synthetic guard regressions. No SSH, Docker, env credentials or deployment."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deployment_helper_test_subject', pathlib.Path(__file__).resolve().parents[1]/'deploy/vps/rollout_engine.py')
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)
subject.CHANGED=['quote-hub','quotes','background','api']
subject.PROTECTED=['recent','analysis','backup','migrate']


def fixtures():
    old = {'name': 'coin-desk', 'networks': {'default': {'name': 'coin-desk-private'}}, 'services': {}}
    before = {}
    for index, name in enumerate(subject.SERVICES):
        old['services'][name] = {
            'image': 'coin-desk:old-' + name, 'environment': {'COIN_DESK_RELEASE': 'old'},
            'read_only': True, 'mem_limit': 384 * 1024 ** 2, 'volumes': ['owned-data:/app/data'],
        }
        before[name] = {'Id': format(index + 1, '064x'), 'Config': {'Image': 'coin-desk:old-' + name}}
    old['services']['quote-hub']['environment'] = {'HOST': '0.0.0.0', 'PORT': '8091'}
    next_config = copy.deepcopy(old)
    for name in subject.CHANGED:
        next_config['services'][name]['image'] = 'coin-desk:candidate'
        if name != 'quote-hub':
            next_config['services'][name]['environment']['COIN_DESK_RELEASE'] = 'candidate'
    next_config['services']['quotes']['environment']['COIN_DESK_QUOTE_HUB'] = 'http://quote-hub:8091'
    # Protected historical container releases intentionally differ from current Compose.
    for name in ['analysis', 'backup', 'migrate']:
        before[name]['Config']['Image'] = 'coin-desk:retained-history-' + name
    return old, next_config, before


def instance(old, next_config):
    value = subject.Deployment.__new__(subject.Deployment)
    value.image = 'coin-desk:candidate'
    value.release = 'candidate'
    value.oldenv = pathlib.Path('synthetic-old.env')
    value.newenv = pathlib.Path('synthetic-next.env')
    value.new = pathlib.Path('synthetic-release')
    value.report = {}
    answers = iter([json.dumps(old).encode(), json.dumps(next_config).encode()])
    value.run = lambda *args, **kwargs: next(answers)
    value.persist = lambda: None
    return value


class Guards(unittest.TestCase):
    def test_natural_confirmation_requires_all_six_sources_and_actual_trade_time(self):
        before={'quotes': [[str(i), 800, 800] for i in range(6)]}
        after={'quotes': [[str(i), 950, 940] for i in range(6)],
               'proof': [[str(i), 'trade', 940, 940, 123] for i in range(3)]}
        subject.require_core_progress(before, after, 1000)
        for field, index, value, message in [
            ('quotes', 1, 800, 'confirmations'),
            ('quotes', 2, 699, 'not fresh'),
            ('quotes', 2, 1061, 'not fresh'),
            ('proof', 1, 'statistics', 'not yet proven'),
            ('proof', 3, 939, 'not yet proven'),
        ]:
            changed=copy.deepcopy(after);changed[field][0][index]=value
            with self.assertRaisesRegex(ValueError, message):
                subject.require_core_progress(before, changed, 1000)
        changed=copy.deepcopy(after);changed['quotes'][0]=changed['quotes'][1]
        with self.assertRaisesRegex(ValueError, 'confirmations'):
            subject.require_core_progress(before, changed, 1000)

    def test_rollback_requires_image_id_and_tag_to_match_baseline(self):
        before={'Image':'sha256:original','Config':{'Image':'coin-desk:previous'}}
        subject.require_restored_image(before, copy.deepcopy(before), 'api')
        for restored in [dict(before, Image='sha256:candidate'),
                         dict(before, Config={'Image':'coin-desk:candidate'})]:
            with self.assertRaisesRegex(ValueError, 'Rollback image differs'):
                subject.require_restored_image(before, restored, 'api')

    def test_hashrate_unit_uses_the_actual_meta_contract(self):
        subject.require_hashrate_unit({'data': [], 'meta': {'unit': 'GH/s'}}, 'DASH')
        subject.require_hashrate_unit({'unit': 'TH/s', 'meta': {'unit': 'GH/s'}}, 'ZEC')
        for invalid in [{'unit': 'GH/s'}, {'meta': {'unit': 'TH/s'}}, {'meta': None}]:
            with self.assertRaisesRegex(ValueError, 'Candidate hashrate unit mismatch: DASH'):
                subject.require_hashrate_unit(invalid, 'DASH')

    def test_new_candidate_report_name_reaches_only_the_mocked_read_only_probe(self):
        value = subject.Deployment.__new__(subject.Deployment)
        with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)):
            for name in [None, 'candidate-runtime-after-unit-fix.json']:
                with self.subTest(report=name), patch.object(subject.subprocess, 'run', side_effect=RuntimeError('read-only probe reached')) as probe:
                    with self.assertRaisesRegex(RuntimeError, 'read-only probe reached'):
                        value.rehearsal(*([] if name is None else [name]))
                    probe.assert_called_once()

    def test_invalid_report_names_fail_before_any_external_probe(self):
        value = subject.Deployment.__new__(subject.Deployment)
        names = ['../candidate-runtime.json', '/candidate-runtime.json',
                 r'..\candidate-runtime.json', 'folder/candidate-runtime.json',
                 'candidate-runtimeXjson', 'candidate-runtime.json/extra',
                 'candidate-runtime.json\n', '', 'candidate-runtime.JSON']
        with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)), patch.object(subject.subprocess, 'run') as probe:
            for name in names:
                with self.subTest(report=name), self.assertRaisesRegex(ValueError, 'Candidate report must be new'):
                    value.rehearsal(name)
            probe.assert_not_called()

    def test_existing_report_evidence_is_preserved_before_any_external_probe(self):
        value = subject.Deployment.__new__(subject.Deployment)
        with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)), patch.object(subject.subprocess, 'run') as probe:
            path = pathlib.Path(folder) / 'candidate-runtime.json'
            evidence = b'{"reviewed":true}'
            path.write_bytes(evidence)
            with self.assertRaisesRegex(ValueError, 'Candidate report must be new'):
                value.rehearsal()
            self.assertEqual(path.read_bytes(), evidence)
            probe.assert_not_called()

    def test_preserved_historical_images_are_not_restarted_to_match_compose(self):
        old, next_config, before = fixtures()
        value = instance(old, next_config)
        with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)):
            value.validate_configs(before)
        self.assertEqual(set(value.report['protectedContainerIdsBefore']), set(subject.PROTECTED))

    def test_changed_service_rollback_image_must_match_live_baseline(self):
        old, next_config, before = fixtures()
        before['quotes']['Config']['Image'] = 'coin-desk:unexpected'
        value = instance(old, next_config)
        with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)):
            with self.assertRaisesRegex(ValueError, 'Previous config differs from live image: quotes'):
                value.validate_configs(before)

    def test_protected_limits_and_volumes_cannot_change(self):
        for field, changed in [('mem_limit', 1), ('volumes', ['unrelated-data:/app/data'])]:
            old, next_config, before = fixtures()
            next_config['services']['analysis'][field] = changed
            value = instance(old, next_config)
            with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)):
                with self.assertRaisesRegex(ValueError, 'Protected service configuration changed: analysis'):
                    value.validate_configs(before)

    def test_all_four_initial_protected_ids_must_match(self):
        _, _, before = fixtures()
        value = subject.Deployment.__new__(subject.Deployment)
        baseline = {name: before[name]['Id'] for name in subject.PROTECTED}
        value.assert_protected_ids(before, baseline)
        changed = copy.deepcopy(before)
        changed['migrate']['Id'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'Initial protected container changed: migrate'):
            value.assert_protected_ids(changed, baseline)

    def test_first_inspect_identity_wins_without_publishing_environment(self):
        value = subject.Deployment.__new__(subject.Deployment)
        with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)):
            logs = pathlib.Path(folder) / 'private-logs'
            logs.mkdir()
            expected = {}
            for index, name in enumerate(subject.PROTECTED):
                identity = format(index + 1, '064x')
                expected[name] = identity
                record = {'Id': identity, 'Config': {'Env': ['SYNTHETIC_SECRET=must-not-be-returned'],
                          'Labels': {'com.docker.compose.service': name, 'com.docker.compose.project': 'coin-desk'}}}
                (logs / f'command-initial-{index}.log').write_text(json.dumps(record), encoding='utf-8')
            self.assertEqual(value.initial_protected_ids(), expected)
            self.assertNotIn('SYNTHETIC_SECRET', json.dumps(value.initial_protected_ids()))

    def test_all_original_services_are_required_for_prepare_resume(self):
        value = subject.Deployment.__new__(subject.Deployment)
        with tempfile.TemporaryDirectory() as folder, patch.object(subject, 'AUDIT', pathlib.Path(folder)):
            logs = pathlib.Path(folder) / 'private-logs'
            logs.mkdir()
            expected = {}
            for index, name in enumerate(subject.SERVICES):
                identity = format(index + 1, '064x')
                expected[name] = identity
                record = {'Id': identity, 'Config': {'Labels': {
                    'com.docker.compose.service': name, 'com.docker.compose.project': 'coin-desk'}}}
                (logs / f'command-initial-{index}.log').write_text(json.dumps(record), encoding='utf-8')
            self.assertEqual(value.initial_container_ids(subject.SERVICES), expected)


if __name__ == '__main__':
    unittest.main()
