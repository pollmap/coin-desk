import { refreshMinuteQuotes, scheduled } from './scheduled';
import { refreshObservations, refreshBriefing } from './observations';
import { refreshEthereumContext } from './ethereum-context';
import { refreshProviderWatch } from './provider-watch';
import type { Env } from './storage';
export default {
  async scheduled(
    event: ScheduledController,
    env: Env & { COLLECTOR_LANE: string },
    ctx: ExecutionContext,
  ) {
    const at = Math.floor(event.scheduledTime / 1000);
    if (env.COLLECTOR_LANE === 'quotes') ctx.waitUntil(refreshMinuteQuotes(env));
    else if (env.COLLECTOR_LANE === 'background') ctx.waitUntil(scheduled(env, at, true));
    else {
      // One price source/asset per invocation, not three full histories in parallel.
      // The remaining minute slots run non-price observations and auxiliary feeds.
      const slot = Math.floor(at / 60) % 20;
      if (slot < 15) ctx.waitUntil(refreshObservations(env, slot));
      else if (slot === 15) ctx.waitUntil(refreshBriefing(env));
      else if (slot === 16) ctx.waitUntil(refreshEthereumContext(env, 'tvl'));
      else if (slot === 17) ctx.waitUntil(refreshEthereumContext(env, 'stablecoins'));
      else if (slot === 18) ctx.waitUntil(refreshProviderWatch(env));
    }
  },
};
