import { expect, it } from 'vitest';
import {
  backgroundPolicies,
  selectJob,
  cleanError,
  failureCode,
  type IngestionState,
} from '../worker/health';
import { ASSETS } from '../shared/catalog';

it('VPS serves every overdue source despite repeated primary catch-up and an expired ETH retry', () => {
  const now = 1791471600;
  const jobs = backgroundPolicies(
    ASSETS.map((a) => a.id),
    false,
  );
  const states: IngestionState[] = jobs.map((job) => ({
    key: job.key,
    last_attempt: now - 86400,
    last_success: now - 86400,
    data_as_of: now - 4 * 86400,
    next_attempt: 0,
    error: null,
    failures: 0,
  }));
  const eth = states.find((s) => s.key === 'network:ETH')!;
  eth.error = 'storage failure';
  eth.failures = 1;
  eth.next_attempt = now - 120;
  const seen = new Set<string>();
  // Real daily sources remain dated to the closed day, not the poll timestamp.
  for (let tick = 0; tick <= jobs.length + 1; tick++) {
    const clock = now + tick * 60;
    const job = selectJob(jobs, states, clock, true)!;
    seen.add(job.key);
    const state = states.find((s) => s.key === job.key)!;
    state.last_attempt = clock;
    state.last_success = clock;
    state.next_attempt = 0;
    // Retain stale values to simulate continuous catch-up across all sources.
  }
  expect([...seen].sort()).toEqual(jobs.map((j) => j.key).sort());
});

it('VPS respects provider retry deadlines even when a failed source is the oldest', () => {
  const job = backgroundPolicies(['ETH'], false).find((j) => j.key === 'network:ETH')!;
  const state = {
    key: job.key,
    last_attempt: 100,
    last_success: null,
    data_as_of: null,
    error: 'HTTP 429',
    failures: 4,
    next_attempt: 3600,
  };
  expect(selectJob([job], [state], 3599, true)).toBeUndefined();
  expect(selectJob([job], [state], 3600, true)?.key).toBe(job.key);
});

it('public failure diagnostics separate storage, source revisions and request limits without exposing details', () => {
  expect(failureCode('Error: database or disk is full')).toBe('STORAGE_FULL');
  expect(cleanError('SQLITE_FULL at private/path?token=secret')).not.toContain('secret');
  expect(failureCode('CoinGecko HTTP 429')).toBe('PROVIDER_RATE_LIMIT');
  expect(failureCode('source observation retracted; rebuild required')).toBe('SOURCE_REVISION');
  expect(cleanError('fetch https://private/?secret=1 failed')).toBe(
    '원천 연결 또는 데이터 검증 오류',
  );
});
