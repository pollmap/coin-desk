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
