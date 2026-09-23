import { afterEach, describe, expect, it, vi } from 'vitest';
import { pages, friendlyError } from '../src/lib';
import type { SeriesResponse } from '../shared/types';

const DAY = 86400,
  start = 1262304000;
const rows = Array.from({ length: 4001 }, (_, i) => ({ time: start + i * DAY, value: i + 1 }));
const end = rows.at(-1)!.time + DAY;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function source(withRange = true, fail = false) {
  const requests: URL[] = [];
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'https://test.local');
    requests.push(url);
    const from = Number(url.searchParams.get('from') || 0),
      to = Number(url.searchParams.get('to') || end);
    if (to > end || (fail && requests.length === 2))
      return Response.json({ error: 'Invalid to' }, { status: 400 });
    const matches = rows.filter((p) => p.time >= from && p.time < to),
      data = matches.slice(0, 1000);
    return Response.json({
      data,
      price: data,
      range: withRange ? { from, to } : undefined,
      nextCursor: matches.length > 1000 ? data.at(-1)!.time + DAY : null,
      meta: { source: 'fixture', stale: false, gapCount: 0 },
    });
  });
  return requests;
}
describe('server-resolved history pagination', () => {
  it.each([300000, -300000, 86400000 * 365])(
    'ignores client clock offset %i ms and returns every point once',
    async (offset) => {
      const requests = source();
      vi.spyOn(Date, 'now').mockReturnValue(end * 1000 + offset);
      const result = await pages<SeriesResponse>('/api/v1/series?metric=mvrv&limit=1000');
      expect(result.data).toEqual(rows);
      expect(result.price).toEqual(rows);
      expect(result.nextCursor).toBeNull();
      expect(requests.slice(1).every((r) => Number(r.searchParams.get('to')) <= end)).toBe(true);
    },
  );
  it('continues old cached responses by cursor without synthesizing a future to', async () => {
    const requests = source(false);
    vi.spyOn(Date, 'now').mockReturnValue(end * 1000 + 1e12);
    const result = await pages<SeriesResponse>('/api/v1/series?metric=mvrv&limit=1000');
    expect(result.data).toEqual(rows);
    expect(requests.every((r) => !r.searchParams.has('to'))).toBe(true);
    expect(requests.length).toBe(5);
  });
  it('does not report partial history as complete after a page fails', async () => {
    source(true, true);
    await expect(pages('/api/v1/series?metric=mvrv')).rejects.toThrow('조회 기간');
    expect(friendlyError('Invalid to')).not.toContain('Invalid');
  });
});
