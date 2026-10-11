import { it, expect, vi } from 'vitest';
import { recoverDerivativeGap } from '../worker/history-recovery';
import type { Env } from '../worker/storage';

it('gap repair refuses unsupported, unbounded or unaligned ranges before making any request', async () => {
  const feed = vi.fn();
  const env = { FEED_SERVICE: { fetch: feed } } as unknown as Env;
  for (const [asset, metric, from, to] of [
    ['FAKE', 'open_interest', 1700002800, 1700006400],
    ['BTC', 'funding', 1700002800, 1700006400],
    ['BTC', 'open_interest', 1, 3601],
    ['BTC', 'open_interest', 1700002800, 1700002800 + 200 * 3600],
  ] as const)
    await expect(
      recoverDerivativeGap(env, asset as never, metric, from, to, true),
    ).rejects.toThrow();
  expect(feed).not.toHaveBeenCalled();
});
it('low-space repair never weakens the guard or calls a provider', async () => {
  const feed = vi.fn();
  const env = { HISTORY_ALLOWED: () => false, FEED_SERVICE: { fetch: feed } } as unknown as Env;
  const from = 1700002800;
  expect(
    await recoverDerivativeGap(env, 'BTC', 'open_interest', from, from + 3600, true),
  ).toMatchObject({ outcome: 'paused_low_space', inserted: 0 });
  expect(feed).not.toHaveBeenCalled();
});
