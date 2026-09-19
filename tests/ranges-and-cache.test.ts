import { describe, expect, it } from 'vitest';
import { isRangePeriod, periodStart } from '../shared/ranges';
import { QueryCache } from '../src/query-cache';
import { importDesk, chartSettings, DEFAULT_DESK } from '../shared/workspace';
const utc = (s: string) => Date.parse(s + 'T00:00:00Z') / 1000;
describe('calendar periods', () => {
  it('clamps month/year ends instead of drifting into the next month', () => {
    expect(periodStart('1m', utc('2024-03-31'))).toBe(utc('2024-02-29'));
    expect(periodStart('1y', utc('2024-02-29'))).toBe(utc('2023-02-28'));
    expect(periodStart('6m', utc('2026-09-20'))).toBe(utc('2026-03-20'));
    expect(periodStart('5y', utc('2026-09-20'))).toBe(utc('2021-09-20'));
    expect(periodStart('ytd', utc('2026-09-20'))).toBe(utc('2026-01-01'));
    expect(periodStart('all', utc('2026-09-20'))).toBe(0);
  });
  it('round-trips expanded periods through existing workspace backups', () => {
    for (const period of ['6m', 'ytd', '5y']) {
      expect(isRangePeriod(period)).toBe(true);
      const desk = {
        ...DEFAULT_DESK,
        workspaces: [{ ...chartSettings({ period }), name: '기간', view: 'chart', cards: [] }],
      };
      expect(importDesk(JSON.stringify(desk)).workspaces[0].period).toBe(period);
    }
    expect(isRangePeriod('100y')).toBe(false);
  });
});
describe('shared query lifetimes', () => {
  it('shares a single fetch and keeps it alive for remaining subscribers', async () => {
    const cache = new QueryCache();
    let resolve!: (v: number) => void;
    let signal!: AbortSignal;
    let calls = 0;
    const loader = (s: AbortSignal) => {
      calls++;
      signal = s;
      return new Promise<number>((r) => (resolve = r));
    };
    const a = cache.acquire('same', loader),
      b = cache.acquire('same', loader);
    a.release();
    expect(signal.aborted).toBe(false);
    resolve(42);
    expect(await b.task).toBe(42);
    b.release();
    expect(calls).toBe(1);
    expect(cache.peek('same')?.data).toBe(42);
  });
  it('cancels the last subscriber and never lets an abandoned result overwrite a new one', async () => {
    const cache = new QueryCache();
    let resolve!: (v: string) => void;
    let signal!: AbortSignal;
    const old = cache.acquire('x', (s) => {
      signal = s;
      return new Promise<string>((r) => (resolve = r));
    });
    old.release();
    old.release();
    expect(signal.aborted).toBe(true);
    const fresh = cache.acquire('x', async () => 'new');
    await fresh.task;
    resolve('old');
    await old.task;
    expect(cache.peek('x')?.data).toBe('new');
    fresh.release();
  });
  it('bounds memory and retries failed requests', async () => {
    const cache = new QueryCache(2);
    const fail = cache.acquire('fail', async () => {
      throw new Error('offline');
    });
    await expect(fail.task).rejects.toThrow('offline');
    fail.release();
    expect(cache.peek('fail')).toBeUndefined();
    for (const k of ['a', 'b', 'c']) {
      const r = cache.acquire(k, async () => k);
      await r.task;
      r.release();
    }
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.peek('c')?.data).toBe('c');
  });
});
