import datetime as dt
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from audit_price_history import Reader, aggregate, coverage_result, expected_sources, check_hourly_gaps, DAY


class PriceHistoryAuditTest(unittest.TestCase):
    def test_source_identity_unit_and_provider_start_are_separate_from_hourly_retention(self):
        asset = {'id': 'DOGE', 'markets': {'upbit': 'KRW-DOGE', 'binance': None}}
        row = {'id': 'upbit:1d', 'unit': 'KRW', 'first': DAY, 'last': 3*DAY, 'observations': 3,
               'gaps': {'slots': 0, 'classification': 'unverified'}, 'status': 'available', 'cadence': '1d'}
        body = {'asset': 'DOGE', 'sources': [row, {**row, 'id': 'upbit:1h', 'cadence': '1h'}]}
        result = coverage_result(asset, body, {'upbit': DAY}, {'DOGE:upbit': {'sameStart': True}})
        self.assertEqual(result['sources'][0]['classification'], ['start-and-stored-extent-match'])
        self.assertEqual(result['sources'][1]['classification'], ['rolling-90-day-history'])
        body['sources'][0] = {**row, 'unit': 'USD', 'first': 2*DAY}
        reasons = coverage_result(asset, body, {'upbit': DAY}, {})['sources'][0]['classification']
        self.assertEqual(reasons, ['unit-mismatch', 'provider-start-mismatch'])
        with self.assertRaisesRegex(ValueError, 'CROSS_ASSET'):
            coverage_result(asset, {**body, 'asset': 'BTC'}, {'upbit': DAY}, {})

    def test_missing_history_and_unclassified_gaps_are_not_silently_passed(self):
        asset = {'id': 'BTC', 'markets': {'binance': 'BTCUSDT'}}
        result = coverage_result(asset, {'asset': 'BTC', 'sources': []}, {'binance': DAY}, {})
        self.assertEqual(result['sources'][0]['classification'], 'missing-coverage-source')
        self.assertEqual(expected_sources(asset, {'binance': DAY, 'reference': 0}), [('binance:1d', DAY), ('binance:1h', None), ('reference', 0)])

    def test_independent_calendar_aggregation_preserves_prices_and_leap_month(self):
        start = int(dt.datetime(2024, 2, 28, tzinfo=dt.timezone.utc).timestamp())
        candles = [{'time': start+i*DAY, 'closeTime': start+(i+1)*DAY, 'open': 10+i, 'high': 20+i,
                    'low': 5+i, 'close': 12+i, 'volume': 100+i, 'closed': True} for i in range(3)]
        result = aggregate(candles, '1M', start+3*DAY)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['volume'], 201)
        self.assertEqual(result[0]['close'], 13)
        self.assertEqual(result[0]['closeTime'], start+2*DAY)
        self.assertTrue(result[0]['closed'])
        self.assertFalse(result[1]['closed'])
        self.assertEqual(candles[0]['volume'], 100)

    def test_operator_audit_only_reads_owner_origins_and_history_routes(self):
        for origin in ['https://example.com', 'https://coin-desk.pages.dev/secret', 'http://coin-desk.pages.dev', 'https://u@coin-desk.pages.dev']:
            with self.assertRaises(ValueError):
                Reader(origin)
        reader = Reader('https://coin-desk.pages.dev')
        with self.assertRaisesRegex(ValueError, 'READ_ONLY'):
            reader.get('overview', {'asset': 'BTC'})
        with self.assertRaisesRegex(ValueError, 'READ_ONLY'):
            reader.get('collect', {})

    def test_provider_limit_stops_all_remaining_gap_reads_without_retry(self):
        class FakeReader:
            requests = 0
            def pages(self, asset, source, interval, before):
                self.requests += 1
                return [{'time': stamp, 'closeTime': stamp+3600, 'closed': True} for stamp in [DAY, DAY+7200]], {}
        reader = FakeReader()
        snapshot = {'checkedAt': 'test', 'review': [{'asset': a, 'id': 'upbit:1h', 'unverifiedMissingSlots': 1} for a in ['MNT', 'WIF']]}
        with patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('https://api.upbit.com', 429, 'limited', None, None)) as get:
            result = check_hourly_gaps(snapshot, [], reader, 3*DAY)
        self.assertEqual(get.call_count, 1)
        self.assertEqual(reader.requests, 1)
        self.assertTrue(result['providerLimitStopped'])
        self.assertEqual(result['recoverableMissingSlots'], 0)
        self.assertEqual(result['rows'][1]['outcome'], 'not-queried-after-provider-limit')


if __name__ == '__main__':
    unittest.main()
