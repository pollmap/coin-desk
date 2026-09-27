import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../worker/scheduled', () => ({ refreshMinuteQuotes: vi.fn(), scheduled: vi.fn() }));
vi.mock('../worker/observations', () => ({
  refreshObservations: vi.fn(),
  refreshBriefing: vi.fn(),
}));
vi.mock('../worker/ethereum-context', () => ({ refreshEthereumContext: vi.fn() }));
vi.mock('../worker/provider-watch', () => ({ refreshProviderWatch: vi.fn() }));
import collector from '../worker/collector-entry';
import { refreshMinuteQuotes, scheduled } from '../worker/scheduled';
import { refreshObservations } from '../worker/observations';
import { feedRequest } from '../worker/feed-client';
beforeEach(() => vi.clearAllMocks());
it('never runs quotes and background computation in the same collector invocation', async () => {
  const event = { scheduledTime: 1800000000000 } as ScheduledController;
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  await collector.scheduled(event, { COLLECTOR_LANE: 'quotes' } as never, ctx);
  expect(refreshMinuteQuotes).toHaveBeenCalledTimes(1);
  expect(scheduled).not.toHaveBeenCalled();
  expect(refreshObservations).not.toHaveBeenCalled();
  vi.clearAllMocks();
  await collector.scheduled(event, { COLLECTOR_LANE: 'background' } as never, ctx);
  expect(scheduled).toHaveBeenCalledTimes(1);
  expect(refreshMinuteQuotes).not.toHaveBeenCalled();
});
it('covers every core asset/source once in the bounded analysis cycle', async () => {
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  for (let minute = 0; minute < 20; minute++)
    await collector.scheduled(
      { scheduledTime: minute * 60000 } as ScheduledController,
      { COLLECTOR_LANE: 'analysis' } as never,
      ctx,
    );
  expect(vi.mocked(refreshObservations).mock.calls.map((call) => call[1])).toEqual(
    Array.from({ length: 15 }, (_, i) => i),
  );
});
it('uses an account-scoped feed binding without copying a secret to new collectors', async () => {
  const invoke = vi.fn(async (request: Request) => {
    expect(request.headers.has('X-Feed-Token')).toBe(false);
    expect(new URL(request.url).pathname).toBe('/coinlore');
    return Response.json({ valid: true });
  });
  expect(
    await feedRequest({ FEED_SERVICE: { fetch: invoke } as unknown as Fetcher }, '/coinlore'),
  ).toEqual({ valid: true });
  expect(invoke).toHaveBeenCalledTimes(1);
});
