"""Read-only reconciliation of current price coverage and verified provider starts.

Coverage includes immutable archives plus recent candles. Provider-first evidence
is reused with its original date; no exchange requests or ingestion are triggered.
Optional bounded price-page probes independently check full daily and UTC weekly/
monthly OHLC. Output never contains credentials, request headers or personal data.
"""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DAY = 86400
UTC = dt.timezone.utc
ALLOWED_HOSTS = {'coin-desk.pages.dev', 'coin-desk.62.171.141.206.sslip.io', '127.0.0.1', 'localhost'}


def iso(value):
    return dt.datetime.fromtimestamp(value, UTC).isoformat() if value is not None else None


def bucket(stamp, interval):
    if interval == '1w':
        return ((stamp - 4 * DAY) // (7 * DAY)) * 7 * DAY + 4 * DAY
    value = dt.datetime.fromtimestamp(stamp, UTC)
    return int(dt.datetime(value.year, value.month, 1, tzinfo=UTC).timestamp())


def bucket_end(stamp, interval):
    if interval == '1w':
        return stamp + 7 * DAY
    value = dt.datetime.fromtimestamp(stamp, UTC)
    year, month = (value.year + 1, 1) if value.month == 12 else (value.year, value.month + 1)
    return int(dt.datetime(year, month, 1, tzinfo=UTC).timestamp())


def aggregate(candles, interval, now):
    groups = {}
    for candle in candles:
        stamp = bucket(candle['time'], interval)
        if stamp not in groups:
            groups[stamp] = {**candle, 'time': stamp, 'closeTime': bucket_end(stamp, interval)}
        else:
            row = groups[stamp]
            row['high'] = max(row['high'], candle['high'])
            row['low'] = min(row['low'], candle['low'])
            row['close'] = candle['close']
            row['volume'] += candle['volume']
    return [{**groups[stamp], 'closed': groups[stamp]['closeTime'] <= now} for stamp in sorted(groups)]


def expected_sources(asset, origins):
    sources = []
    for market, symbol in asset['markets'].items():
        if symbol:
            sources.extend([(market + ':1d', origins.get(market)), (market + ':1h', None)])
    if 'reference' in origins:
        sources.append(('reference', origins['reference']))
    return sources


def coverage_result(asset, body, origins, evidence):
    if body.get('asset') != asset['id']:
        raise ValueError('CROSS_ASSET_RESPONSE')
    rows = body.get('sources')
    if not isinstance(rows, list) or len({row.get('id') for row in rows}) != len(rows):
        raise ValueError('INVALID_COVERAGE_ROWS')
    by_id = {row['id']: row for row in rows}
    output = []
    for source_id, expected_first in expected_sources(asset, origins):
        source = by_id.get(source_id)
        provider = source_id.split(':')[0]
        provider_evidence = evidence.get(asset['id'] + ':' + provider, {})
        if source is None:
            output.append({'id': source_id, 'classification': 'missing-coverage-source'})
            continue
        first, last, count = source.get('first'), source.get('last'), source.get('observations')
        if any(value is not None and (not isinstance(value, int) or value < 0) for value in [first, last, count]):
            raise ValueError('INVALID_COVERAGE_BOUNDARY')
        expected_unit = 'USD' if provider == 'reference' else 'KRW' if provider == 'upbit' else 'USDT'
        reasons = []
        if source.get('unit') != expected_unit:
            reasons.append('unit-mismatch')
        if expected_first is not None and first != expected_first:
            reasons.append('provider-start-mismatch' if first else 'no-stored-history')
        if first is not None and (last is None or last < first or not count):
            reasons.append('invalid-stored-extent')
        gaps = source.get('gaps') or {}
        if gaps.get('slots'):
            reasons.append('provider-no-observation-at-prior-check' if gaps.get('checkedMissingSlots', 0) >= gaps['slots']
                           else 'internal-gaps-require-classification')
        output.append({
            'id': source_id, 'unit': source.get('unit'), 'first': first, 'last': last,
            'firstDate': iso(first), 'lastDate': iso(last), 'observations': count,
            'providerFirst': expected_first, 'providerFirstDate': iso(expected_first),
            'providerEvidenceCheckedAt': provider_evidence.get('checkedAt'),
            'providerEvidenceOriginallyMatched': provider_evidence.get('sameStart') is True,
            'currentProviderApiQueried': False, 'includesArchive': provider != 'reference',
            'cadence': source.get('cadence'), 'state': source.get('status'),
            'missingSlots': gaps.get('slots'), 'gapClassification': gaps.get('classification'),
            'checkedMissingSlots': gaps.get('checkedMissingSlots', 0),
            'priorGapEvidenceCheckedAt': sorted({item['checkedAt'] for item in gaps.get('evidence', [])}),
            'unverifiedMissingSlots': max(0, (gaps.get('slots') or 0) - gaps.get('checkedMissingSlots', 0)),
            'classification': reasons or ['rolling-90-day-history' if source_id.endswith(':1h') else 'start-and-stored-extent-match'],
        })
    return {'asset': asset['id'], 'coverageCheckedAt': body.get('checkedAt'), 'sources': output}


class Reader:
    def __init__(self, origin, delay=0.3, timeout=25):
        parsed = urllib.parse.urlsplit(origin)
        if parsed.hostname not in ALLOWED_HOSTS or parsed.path not in ['', '/'] or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('ONLY_EXISTING_PUBLIC_OR_LOCAL_ORIGINS_ALLOWED')
        if parsed.scheme not in ({'http', 'https'} if parsed.hostname in {'127.0.0.1', 'localhost'} else {'https'}):
            raise ValueError('INVALID_ORIGIN_SCHEME')
        self.origin, self.delay, self.timeout = origin.rstrip('/'), delay, timeout
        self.lock, self.next_request, self.requests = threading.Lock(), 0.0, 0

    def get(self, route, query):
        if route not in {'coverage', 'candles', 'reference'}:
            raise ValueError('ONLY_READ_ONLY_HISTORY_ROUTES_ALLOWED')
        with self.lock:
            pause = max(0, self.next_request - time.monotonic())
            if pause:
                time.sleep(pause)
            self.next_request = time.monotonic() + self.delay
            self.requests += 1
        url = self.origin + '/api/v1/' + route + '?' + urllib.parse.urlencode(query)
        request = urllib.request.Request(url, headers={'User-Agent': 'BoriChart owner read-only history QA'})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            payload = response.read(2 * 1024 * 1024 + 1)
            if len(payload) > 2 * 1024 * 1024:
                raise ValueError('HISTORY_RESPONSE_TOO_LARGE')
            if 'application/json' not in response.headers.get('Content-Type', ''):
                raise ValueError('NON_JSON_HISTORY_RESPONSE')
            return json.loads(payload)

    def pages(self, asset, source, interval, before):
        route = 'reference' if source == 'reference' else 'candles'
        query = {'asset': asset, 'limit': 1000, 'to': before}
        if route == 'candles':
            query.update(market=source, interval=interval)
        points, cursor, metadata = [], -1, None
        for _ in range(20):
            body = self.get(route, query)
            metadata = metadata or body.get('meta', {})
            rows = body.get('data')
            if not isinstance(rows, list):
                raise ValueError('INVALID_PRICE_PAGE')
            points.extend(rows)
            next_cursor = body.get('nextCursor')
            if next_cursor is None:
                stamps = [row['time'] for row in points]
                if stamps != sorted(set(stamps)):
                    raise ValueError('UNORDERED_OR_DUPLICATED_PRICE_PAGE')
                return points, metadata
            if not isinstance(next_cursor, int) or next_cursor <= cursor or next_cursor >= before:
                raise ValueError('PRICE_CURSOR_NOT_ADVANCING')
            cursor = next_cursor
            query['from'] = cursor
        raise ValueError('PRICE_PAGE_BOUND_EXCEEDED')


def probe_prices(reader, asset, coverage, before, now):
    output = []
    for entry in coverage['sources']:
        if entry['id'].endswith(':1h'):
            continue
        source = entry['id'].split(':')[0]
        rows, metadata = reader.pages(asset, source, '1d', before)
        observed = rows if source == 'reference' else [row for row in rows if row.get('closed') and row['closeTime'] <= now]
        row = {'source': source, 'pricePagesBound': 20, 'observations': len(observed),
               'first': observed[0]['time'] if observed else None,
               'last': observed[-1]['time'] if observed else None,
               'matchesCoverage': bool(observed) and observed[0]['time'] == entry['first'] and observed[-1]['time'] == entry['last'] and len(observed) == entry['observations'],
               'historyMetadataMatchesFirstPrice': bool(observed) and metadata.get('historyStart') == observed[0]['time'],
               'unitMatchesCoverage': metadata.get('unit') == entry['unit']}
        if source != 'reference':
            calendars = []
            for interval in ['1w', '1M']:
                actual, _ = reader.pages(asset, source, interval, before)
                expected = aggregate(observed, interval, now)
                same = len(actual) == len(expected) and all(
                    a['time'] == b['time'] and a['closeTime'] == b['closeTime'] and a['closed'] == b['closed'] and
                    all(math.isclose(a[field], b[field], rel_tol=1e-10, abs_tol=1e-12) for field in ['open', 'high', 'low', 'close', 'volume'])
                    for a, b in zip(actual, expected))
                calendars.append({'interval': interval, 'observations': len(actual), 'independentDailyAggregationMatches': same,
                                  'closedBars': sum(bar['closed'] for bar in actual), 'unfinishedBars': sum(not bar['closed'] for bar in actual)})
            row['calendarChecks'] = calendars
        output.append(row)
    return output


def failure(error):
    if isinstance(error, urllib.error.HTTPError):
        return {'code': 'HTTP_' + str(error.code)}
    if isinstance(error, ValueError) and str(error).replace('_', '').isalnum():
        return {'code': str(error)}
    return {'code': type(error).__name__}


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def check_hourly_gaps(snapshot, prior_checks, reader, now):
    """Probe only presently unknown Upbit gaps; 429 stops all provider reads."""
    candidates = [row for row in snapshot['review'] if row['id'] == 'upbit:1h' and row.get('unverifiedMissingSlots')]
    if len(candidates) > 20:
        raise ValueError('HOURLY_ASSET_PROBE_BOUND_EXCEEDED')
    result, provider_requests, stop = [], 0, False
    before = now // 3600 * 3600
    for source in candidates:
        asset = source['asset']
        if stop:
            result.append({'asset': asset, 'outcome': 'not-queried-after-provider-limit'})
            continue
        try:
            rows, _ = reader.pages(asset, 'upbit', '1h', before)
            times = sorted(row['time'] for row in rows if row.get('closed') and row['closeTime'] <= now)
            missing = {stamp for a, b in zip(times, times[1:]) for stamp in range(a+3600, b, 3600)}
            known = {stamp for check in prior_checks if check['asset'] == asset and check['id'] == 'upbit:1h' for stamp in check['times']}
            unknown = sorted(missing - known)
            groups = []
            for stamp in unknown:
                if not groups or stamp - groups[-1][0] >= 198 * 3600:
                    groups.append([stamp])
                else:
                    groups[-1].append(stamp)
            checked = []
            for stamps in groups:
                if provider_requests >= 40:
                    raise ValueError('UPBIT_GAP_REQUEST_BOUND_EXCEEDED')
                params = {'market': 'KRW-'+asset, 'to': iso(stamps[-1]+3600), 'count': 200}
                url = 'https://api.upbit.com/v1/candles/minutes/60?' + urllib.parse.urlencode(params)
                provider_requests += 1
                request = urllib.request.Request(url, headers={'User-Agent': 'BoriChart owner bounded read-only gap QA'})
                with urllib.request.urlopen(request, timeout=20) as response:
                    raw = response.read(256*1024+1)
                    if len(raw) > 256*1024:
                        raise ValueError('UPBIT_GAP_RESPONSE_TOO_LARGE')
                    candles = json.loads(raw)
                if not isinstance(candles, list) or len(candles) > 200:
                    raise ValueError('INVALID_UPBIT_GAP_RESPONSE')
                observed = {}
                for candle in candles:
                    if candle.get('market') != 'KRW-'+asset:
                        raise ValueError('CROSS_ASSET_UPBIT_GAP_RESPONSE')
                    values = [candle.get(key) for key in ['opening_price', 'high_price', 'low_price', 'trade_price']]
                    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0 for v in values):
                        raise ValueError('INVALID_UPBIT_GAP_PRICE')
                    opening, high, low, closing = values
                    if high < max(opening, closing) or low > min(opening, closing) or high < low:
                        raise ValueError('INVALID_UPBIT_GAP_OHLC')
                    stamp = int(dt.datetime.fromisoformat(candle['candle_date_time_utc']).replace(tzinfo=UTC).timestamp())
                    if stamp % 3600 or stamp >= stamps[-1]+3600 or stamp in observed:
                        raise ValueError('INVALID_UPBIT_GAP_TIMESTAMP')
                    observed[stamp] = candle
                for stamp in stamps:
                    checked.append({'time': stamp, 'date': iso(stamp), 'classification': 'recoverable-source-observation' if stamp in observed else 'provider-no-observation-at-check'})
                time.sleep(0.3)
            result.append({'asset': asset, 'interval': '1h', 'storedObservations': len(times), 'storedMissingSlots': len(missing),
                           'priorEvidenceMissingSlots': len(missing & known), 'unknownBeforeProviderProbe': len(unknown),
                           'providerChecks': checked, 'providerRequests': len(groups),
                           'outcome': 'bounded-provider-probe-complete', 'storageMutation': False})
        except Exception as error:
            if isinstance(error, urllib.error.HTTPError) and error.code in [403, 418, 429]:
                stop = True
            result.append({'asset': asset, 'error': failure(error), 'outcome': 'probe-incomplete'})
    checks = [check for row in result for check in row.get('providerChecks', [])]
    return {'checkedAt': iso(int(time.time())), 'scope': 'Bounded recheck of currently unverified hourly gaps; absence does not establish original non-provision or withdrawal.',
            'readOnly': True, 'mutatingRequests': 0, 'retries': 0, 'coverageSnapshotCheckedAt': snapshot['checkedAt'],
            'ownerHistoryRequests': reader.requests, 'providerRequests': provider_requests, 'providerLimitStopped': stop,
            'checkedAssets': len(candidates), 'checkedMissingSlots': len(checks),
            'recoverableMissingSlots': sum(c['classification'] == 'recoverable-source-observation' for c in checks),
            'providerAbsentMissingSlots': sum(c['classification'] == 'provider-no-observation-at-check' for c in checks),
            'rows': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='https://coin-desk.pages.dev')
    parser.add_argument('--assets', default='')
    parser.add_argument('--probe-assets', default='BTC,DOGE')
    parser.add_argument('--workers', type=int, choices=[1, 2], default=2)
    parser.add_argument('--checkpoint', default='work/qa-034/history-checkpoint.json')
    parser.add_argument('--report', default='work/qa-034/history.json')
    parser.add_argument('--retry-errors', action='store_true')
    parser.add_argument('--hourly-gap-only', action='store_true')
    parser.add_argument('--gap-report', default='docs/audit-34/hourly-gap-check.json')
    args = parser.parse_args()
    if args.hourly_gap_only:
        snapshot = json.loads((ROOT / args.report).read_text(encoding='utf-8'))
        checks = json.loads((ROOT / 'worker/coverage-provider-evidence.json').read_text(encoding='utf-8'))['checks']
        output = check_hourly_gaps(snapshot, checks, Reader(args.origin), int(time.time()))
        write_json(ROOT / args.gap_report, output)
        print(json.dumps({k: output[k] for k in ['checkedAssets', 'checkedMissingSlots', 'recoverableMissingSlots', 'providerAbsentMissingSlots', 'providerRequests', 'providerLimitStopped']}, ensure_ascii=False))
        return
    registry_bytes = (ROOT / 'shared/asset-registry.json').read_bytes()
    origins_bytes = (ROOT / 'shared/price-history-origins.json').read_bytes()
    evidence_bytes = (ROOT / 'docs/audit-28/provider-origins.json').read_bytes()
    registry, origins, evidence = map(json.loads, [registry_bytes, origins_bytes, evidence_bytes])
    selected = set(filter(None, args.assets.split(',')))
    assets = [a for a in registry['assets'] if not selected or a['id'] in selected]
    if selected - {a['id'] for a in assets}:
        parser.error('Unknown registry asset')
    now = int(time.time())
    before = now // DAY * DAY
    config = {'origin': args.origin.rstrip('/'), 'before': before, 'assets': [a['id'] for a in assets],
              'inputsHash': hashlib.sha256(registry_bytes + origins_bytes + evidence_bytes).hexdigest()}
    checkpoint = ROOT / args.checkpoint
    state = json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else {'config': config, 'rows': {}}
    if state['config'] != config:
        raise ValueError('CHECKPOINT_SCOPE_CHANGED_USE_NEW_CHECKPOINT')
    reader = Reader(args.origin)
    jobs = [a for a in assets if a['id'] not in state['rows'] or args.retry_errors and 'error' in state['rows'][a['id']]]
    retry_count = sum(a['id'] in state['rows'] for a in jobs)

    def examine(asset):
        try:
            body = reader.get('coverage', {'asset': asset['id']})
            return coverage_result(asset, body, origins['assets'][asset['id']], evidence['sources'])
        except Exception as error:
            return {'asset': asset['id'], 'error': failure(error)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(examine, asset): asset['id'] for asset in jobs}
        for future in concurrent.futures.as_completed(futures):
            asset = futures[future]
            state['rows'][asset] = future.result()
            state['checkedAt'] = iso(int(time.time()))
            write_json(checkpoint, state)
            print(asset, 'error' if 'error' in state['rows'][asset] else 'checked', flush=True)
    probes = dict(state.get('pricePageProbes', {}))
    for asset in filter(None, args.probe_assets.split(',')):
        row = state['rows'].get(asset)
        if not row or 'error' in row or asset in probes:
            continue
        try:
            probes[asset] = probe_prices(reader, asset, row, before, now)
        except Exception as error:
            probes[asset] = {'error': failure(error)}
    state['pricePageProbes'] = probes
    state.setdefault('runs', []).append({'checkedAt': iso(int(time.time())), 'requests': reader.requests, 'retries': retry_count})
    write_json(checkpoint, state)
    rows = [state['rows'][a['id']] for a in assets]
    histories = [s for row in rows for s in row.get('sources', []) if not s['id'].endswith(':1h')]
    mismatches = [dict(asset=row['asset'], **source) for row in rows for source in row.get('sources', [])
                  if source['classification'] not in [['start-and-stored-extent-match'], ['rolling-90-day-history']]]
    report = {'checkedAt': iso(int(time.time())), 'scope': 'Current archived plus recent price extent and prior verified provider-first boundaries, not all historical values or worldwide first trade.',
              'origin': config['origin'], 'readOnly': True, 'mutatingRequests': 0, 'providerRequests': 0,
              'requestsThisRun': reader.requests, 'retriesThisRun': retry_count, 'workers': args.workers,
              'totalAuditRequests': sum(run['requests'] for run in state['runs']), 'runs': state['runs'],
              'assets': len(assets), 'checkedAssets': sum('error' not in row for row in rows),
              'assetErrors': sum('error' in row for row in rows), 'dailyAndReferenceHistories': len(histories),
              'startMatches': sum(s.get('first') is not None and s.get('first') == s.get('providerFirst') for s in histories),
              'unitMatches': sum(s.get('unit') == ('USD' if s['id'] == 'reference' else 'KRW' if s['id'].startswith('upbit:') else 'USDT') for s in histories),
              'dailyAndReferenceInternalMissingSlots': sum(s.get('missingSlots') or 0 for s in histories),
              'dailyAndReferencePriorCheckedMissingSlots': sum(s.get('checkedMissingSlots') or 0 for s in histories),
              'dailyAndReferenceUnverifiedMissingSlots': sum(s.get('unverifiedMissingSlots') or 0 for s in histories),
              'hourlyInternalMissingSlots': sum(s.get('missingSlots') or 0 for row in rows for s in row.get('sources', []) if s['id'].endswith(':1h')),
              'hourlyUnverifiedMissingSlots': sum(s.get('unverifiedMissingSlots') or 0 for row in rows for s in row.get('sources', []) if s['id'].endswith(':1h')),
              'historiesRequiringReview': len(mismatches), 'priorProviderEvidenceCompletedAt': evidence['completedAt'],
              'hourlyRetentionDays': 90, 'historySpaceProtectionGiB': 8,
              'allHistoricalValuesIndependentlyVerified': False, 'rows': rows, 'review': mismatches,
              'pricePageProbes': probes}
    write_json(ROOT / args.report, report)
    print(json.dumps({key: report[key] for key in ['assets', 'checkedAssets', 'assetErrors', 'dailyAndReferenceHistories', 'startMatches', 'historiesRequiringReview', 'requestsThisRun']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
