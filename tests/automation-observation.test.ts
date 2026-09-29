import { describe, expect, it } from 'vitest';
import { observeAutomation, type ObservationRun } from '../shared/automation-observation';
const now = 1800000000;
const until = Math.floor(now / 60) * 60 - 120;
const runs = (): ObservationRun[] =>
  Array.from({ length: 2880 }, (_, i) => {
    const time = until - 48 * 3600 + i * 60;
    return {
      slot: (time / 60) % 4320,
      started_at: time + 3,
      completed_at: time + 10,
      outcome: 'ok',
      job: 'BTC:upbit:1d',
    };
  });
describe('48-hour automation evidence', () => {
  it('does not confuse endpoint coverage with continuity', () => {
    const r = runs();
    expect(observeAutomation([r[0], r.at(-1)!], now)).toMatchObject({
      windowSatisfied: true,
      ready: false,
      missingRuns: 2878,
    });
  });
  it('accepts complete evidence, excludes in-flight ticks and deduplicates delivery', () => {
    const r = runs();
    r.push(r[20], {
      slot: (now / 60) % 4320,
      started_at: now,
      completed_at: null,
      outcome: 'running',
      job: null,
    });
    expect(observeAutomation(r, now)).toMatchObject({
      ready: true,
      ticks: 2880,
      missingRuns: 0,
      successRate: 1,
      longestGapSeconds: 60,
    });
  });
  it('rejects short observation and a four-minute gap even at 99 percent coverage', () => {
    expect(observeAutomation(runs().slice(1), now).windowSatisfied).toBe(false);
    const r = runs().filter((_, i) => i < 20 || i > 22);
    expect(observeAutomation(r, now)).toMatchObject({ ready: false, longestGapSeconds: 240 });
  });
  it('does not hide a real execution gap behind delayed scheduled deliveries', () => {
    const all = runs();
    const r = all.filter((_, i) => ![21, 22, 24, 26].includes(i));
    all[23].started_at = all[20].started_at + 353;
    all[23].completed_at = all[23].started_at + 1;
    all[25].started_at = all[23].started_at + 8;
    all[25].completed_at = all[25].started_at + 1;
    const result = observeAutomation(r.reverse(), now);
    expect(result.recordingRate).toBeGreaterThan(0.99);
    expect(result).toMatchObject({
      ready: false,
      missingRuns: 4,
      longestScheduledGapSeconds: 180,
      longestStartGapSeconds: 353,
      longestGapSeconds: 353,
      unresolvedErrors: [],
    });
  });
  it('includes mature window edges and does not credit starts during the grace period', () => {
    const r = runs();
    for (const run of r.slice(-4)) {
      run.started_at = until + 30;
      run.completed_at = until + 40;
    }
    expect(observeAutomation(r, now)).toMatchObject({
      ready: false,
      missingRuns: 0,
      longestScheduledGapSeconds: 60,
      longestStartGapSeconds: 297,
      longestGapSeconds: 297,
    });
    const start = until - 48 * 3600;
    const delayed = runs();
    for (const run of delayed.slice(0, 5)) {
      run.started_at = start + 300;
      run.completed_at = start + 301;
    }
    expect(observeAutomation(delayed, now)).toMatchObject({
      ready: false,
      longestStartGapSeconds: 300,
      longestGapSeconds: 300,
    });
  });
  it('retains failure counts after recovery but rejects unresolved and current source errors', () => {
    const r = runs();
    r[50].outcome = 'error';
    expect(observeAutomation(r, now)).toMatchObject({ ready: true, failures: 1 });
    r.at(-1)!.outcome = 'interrupted';
    expect(observeAutomation(r, now).ready).toBe(false);
    expect(observeAutomation(r, now, { 'BTC:upbit:1d': now }).ready).toBe(true);
    expect(observeAutomation(runs(), now, {}, ['quote:BTC:upbit']).ready).toBe(false);
  });
  it('ignores older turns of the ring and never treats zero rows as success', () => {
    expect(observeAutomation([], now)).toMatchObject({ ready: false, ticks: 0, missingRuns: 2880 });
    const old = runs().map((r) => ({
      ...r,
      started_at: r.started_at - 4320 * 60,
      completed_at: r.completed_at! - 4320 * 60,
    }));
    expect(observeAutomation(old, now).ticks).toBe(0);
  });
});
