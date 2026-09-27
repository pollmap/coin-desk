import { refreshMinuteQuotes, scheduled } from './scheduled';
import { refreshObservations, refreshBriefing } from './observations';
import { refreshEthereumContext } from './ethereum-context';
import { refreshProviderWatch } from './provider-watch';
import type { Env } from './storage';
export async function runCollector(at: number, env: Env & { COLLECTOR_LANE: string }) {
  if (env.COLLECTOR_LANE === 'quotes') await refreshMinuteQuotes(env);
  else if (env.COLLECTOR_LANE === 'background') await scheduled(env, at, true);
  else if (env.COLLECTOR_LANE === 'analysis') {
    const slot = Math.floor(at / 60) % 20;
    if (slot < 15) await refreshObservations(env, slot);
    else if (slot === 15) await refreshBriefing(env);
    else if (slot === 16) await refreshEthereumContext(env, 'tvl');
    else if (slot === 17) await refreshEthereumContext(env, 'stablecoins');
    else if (slot === 18) await refreshProviderWatch(env);
  } else throw new Error('Unknown collection lane');
}
export default {
  async scheduled(
    event: ScheduledController,
    env: Env & { COLLECTOR_LANE: string },
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runCollector(Math.floor(event.scheduledTime / 1000), env));
  },
  // No workers.dev/custom route. Only the main Worker's explicit Service binding calls this.
  async fetch(request: Request, env: Env & { COLLECTOR_LANE: string }) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/tick')
      return new Response(null, { status: 404 });
    const data = (await request.json()) as { at?: number };
    if (!Number.isSafeInteger(data.at) || data.at! < 0 || data.at! > Date.now() / 1000 + 300)
      return new Response(null, { status: 400 });
    await runCollector(data.at!, env);
    return new Response(null, { status: 204 });
  },
};
