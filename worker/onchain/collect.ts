import type { ResearchMarket } from '../../shared/report-types';
import { DAY, iso, observation, seconds, type Observation } from './core';
import {
  collectCoinGecko,
  collectCoinLore,
  collectTvl,
  collectInjectiveDex,
  type ProviderOptions,
  type ProviderResult,
} from './providers';
import {
  collectChronosHistory,
  collectMarketSnapshot,
  createInjectiveClients,
  emptyTradeCheckpoint,
  normalizeMarkets,
  resumeTradeWindow,
  tradeObservation,
  type InjectiveClient,
  type TradeCheckpoint,
} from './injective';
import {
  providerFailure,
  providerState,
  providerSuccess,
  saveMarkets,
  saveObservations,
} from './storage';

export interface CollectorOptions extends ProviderOptions {
  maxMarkets?: number;
  clients?: { spot: InjectiveClient; derivative: InjectiveClient };
  now?: () => number;
}
export interface CollectionOutcome {
  success: string[];
  failed: string[];
  observations: number;
}
/** One bounded collector; data reads and report publication never call providers. */
export async function collectResearch(
  db: D1Database,
  at: number,
  options: CollectorOptions = {},
): Promise<CollectionOutcome> {
  const output: CollectionOutcome = { success: [], failed: [], observations: 0 };
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  options = { ...options, now };
  const run = async (
    provider: string,
    scope: string,
    interval: number,
    task: () => Promise<ProviderResult>,
  ) => {
    if (options.signal?.aborted) return;
    const state = await providerState(db, provider, scope);
    const attemptedAt = now();
    if (
      state &&
      (state.next_attempt > attemptedAt ||
        (state.last_success !== null && attemptedAt - state.last_success < interval))
    )
      return;
    try {
      const result = await task();
      options.signal?.throwIfAborted();
      await saveObservations(db, result.observations);
      const dates = result.observations
        .map((r) => (r.dataAsOf ? seconds(r.dataAsOf) : null))
        .filter((t): t is number => t !== null);
      await providerSuccess(
        db,
        provider,
        scope,
        now(),
        dates.length ? Math.max(...dates) : null,
        result.checkpoint ?? null,
      );
      output.success.push(provider);
      output.observations += result.observations.length;
    } catch (error) {
      await providerFailure(db, provider, scope, now(), error);
      output.failed.push(provider);
    }
  };
  await run('coinlore', 'both', 1800, () => collectCoinLore(at, options));
  if (options.coinGeckoKey)
    await run('coingecko', 'both', 1800, () => collectCoinGecko(at, options));
  for (const chain of ['Injective', 'Ethereum', 'Solana'] as const)
    await run(
      'defillama:' + chain.toLowerCase(),
      chain === 'Injective' ? 'both' : 'global',
      3600,
      () => collectTvl(chain, at, options),
    );
  await run('defillama-dex', 'both', 3600, () => collectInjectiveDex(at, options));
  if (options.signal?.aborted) return output;
  const clients = options.clients ?? (await createInjectiveClients(options.signal));
  const maxMarkets = Math.max(1, Math.min(10, options.maxMarkets ?? 10));
  await run('injective-metadata', 'injective', 6 * 3600, async () => {
    const spotRaw = await clients.spot.fetchMarkets({ marketStatuses: ['active'] });
    const derivativeRaw = await clients.derivative.fetchMarkets({ marketStatuses: ['active'] });
    const receivedAt = now(),
      spot = normalizeMarkets(spotRaw, 'spot', receivedAt),
      derivative = normalizeMarkets(derivativeRaw, 'derivative', receivedAt);
    options.signal?.throwIfAborted();
    const all = [...spot, ...derivative];
    await saveMarkets(db, all, receivedAt);
    await db
      .prepare(
        "UPDATE onchain_markets SET payload=json_set(payload,'$.status','inactive') WHERE verified_at<? AND json_extract(payload,'$.status')='active'",
      )
      .bind(receivedAt)
      .run();
    // Stable market IDs are selected once from verified metadata. No volume-unit guess ranks markets.
    const previous = await providerState(db, 'injective-metadata', 'injective');
    const prior: string[] = previous?.checkpoint
      ? (JSON.parse(previous.checkpoint).selected ?? [])
      : [];
    const score = (m: ResearchMarket) =>
      m.baseDenom === 'inj'
        ? 0
        : /^INJ\//.test(m.ticker)
          ? 1
          : /^BTC\//.test(m.ticker)
            ? 2
            : /^ETH\//.test(m.ticker)
              ? 3
              : 9;
    const candidates = all
      .filter((m) => score(m) < 9 && ['USDT', 'USDC'].includes(m.quoteSymbol))
      .sort(
        (a, b) => score(a) - score(b) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
      );
    const counts = { spot: 0, derivative: 0 };
    const selected = [
      ...prior.filter((id) => candidates.some((m) => m.id === id)),
      ...candidates.map((m) => m.id),
    ]
      .filter((id, i, ids) => ids.indexOf(id) === i)
      .filter((id) => {
        const kind = candidates.find((m) => m.id === id)!.kind === 'spot' ? 'spot' : 'derivative';
        if (counts[kind] >= 5) return false;
        counts[kind]++;
        return true;
      })
      .slice(0, maxMarkets);
    const common = {
      reportScope: 'injective' as const,
      provider: 'injective-metadata',
      entityId: 'injective',
      entityType: 'chain' as const,
      unit: '개',
      source: 'Injective Indexer',
      sourceUrl: 'https://docs.injective.network/developers-native/query-indexer/markets',
      scope: 'Injective mainnet 활성 시장',
      dataAsOf: null,
      fetchedAt: iso(receivedAt),
      observedAt: receivedAt,
      periodStart: null,
      periodEnd: null,
      status: 'verified' as const,
    };
    return {
      observations: [
        await observation({ ...common, metric: 'active_spot_markets', value: String(spot.length) }),
        await observation({
          ...common,
          metric: 'active_derivative_markets',
          value: String(derivative.length),
        }),
      ],
      checkpoint: { selected },
    };
  });
  const metadata = await providerState(db, 'injective-metadata', 'injective');
  const selected: string[] = metadata?.checkpoint
    ? (JSON.parse(metadata.checkpoint).selected ?? [])
    : [];
  for (const id of selected.slice(0, maxMarkets)) {
    if (options.signal?.aborted) break;
    const record = await db
      .prepare('SELECT payload,verified_at FROM onchain_markets WHERE id=?')
      .bind(id)
      .first<{ payload: string; verified_at: number }>();
    if (!record || at - record.verified_at > 24 * 3600) continue;
    const market: ResearchMarket = JSON.parse(record.payload),
      client = market.kind === 'spot' ? clients.spot : clients.derivative;
    await run('injective-price:' + id, 'injective', 300, async () => ({
      observations: await collectMarketSnapshot(client, market, now(), now),
    }));
    await run('injective-history:' + id, 'injective', 3600, async () => ({
      observations: await collectChronosHistory(market, at, options),
    }));
    await run('injective-trades:' + id, 'injective', 300, async () => {
      const state = await providerState(db, 'injective-trades:' + id, 'injective');
      let prior: TradeCheckpoint | null = state?.checkpoint
        ? (JSON.parse(state.checkpoint) as TradeCheckpoint)
        : null;
      const end = Math.floor(at / DAY) * DAY;
      // Resume a fixed window; latest complete day first, then at most 14 completed days.
      if (!prior || prior.complete || prior.limited || prior.end < end - 13 * DAY) {
        const known = await db
          .prepare(
            "SELECT observed_at FROM onchain_observations WHERE scope='injective' AND entity_id=? AND metric='observed_taker_notional' AND provider='injective-trades' AND observed_at>=?",
          )
          .bind('market:' + id, end - 14 * DAY)
          .all<{ observed_at: number }>();
        const available = new Set(known.results.map((r) => r.observed_at));
        const start = Array.from({ length: 14 }, (_, i) => end - (i + 1) * DAY).find(
          (t) => !available.has(t),
        );
        if (start === undefined) return { observations: [], checkpoint: prior ?? {} };
        prior = emptyTradeCheckpoint(market, start, start + DAY);
      }
      const checkpoint = await resumeTradeWindow(client, market, prior, now(), 2, now);
      return {
        observations: [await tradeObservation(market, checkpoint, now())],
        checkpoint: { ...checkpoint },
      };
    });
  }
  return output;
}
