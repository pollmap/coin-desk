import { ASSET_REGISTRY } from '../../shared/asset-registry';
import type { ReportScope } from '../../shared/report-types';
import { boundedJson, decimal, D, DAY, iso, object, observation, type Observation } from './core';

export const RESEARCH_ASSETS = [
  'BTC',
  'ETH',
  'SOL',
  'INJ',
  'HYPE',
  'UNI',
  'LINK',
  'ONDO',
  'SEI',
  'DYDX',
  'AAVE',
  'XRP',
  'XEC',
] as const;
export interface ProviderResult {
  observations: Observation[];
  checkpoint?: Record<string, unknown>;
}
export interface ProviderOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  coinGeckoKey?: string;
  now?: () => number;
}
const tokenScopes = (id: string): ReportScope[] =>
  id === 'INJ' ? ['global', 'injective'] : ['global'];

export async function normalizeCoinLore(
  globalRaw: unknown,
  tokenRaw: unknown,
  at: number,
  diagnostics = { rejectedTokens: 0 },
): Promise<Observation[]> {
  if (
    !Array.isArray(globalRaw) ||
    globalRaw.length !== 1 ||
    !Array.isArray(tokenRaw) ||
    tokenRaw.length > 30
  )
    throw new Error('INVALID_COINLORE');
  const rows: Observation[] = [],
    global = object(globalRaw[0]);
  const put = async (
    scope: ReportScope,
    entity: string,
    metric: string,
    value: unknown,
    unit: string,
  ) => {
    if (value === null || value === undefined || value === '') return;
    const normalized = decimal(value);
    if (new D(normalized).lt(0)) throw new Error('INVALID_NEGATIVE_MARKET');
    rows.push(
      await observation({
        reportScope: scope,
        provider: 'coinlore',
        entityId: entity,
        entityType: entity === 'global' ? 'global' : 'token',
        metric,
        value: normalized,
        unit,
        source: 'CoinLore',
        sourceUrl: 'https://www.coinlore.com/cryptocurrency-data-api',
        scope: entity === 'global' ? 'CoinLore 수록 암호화폐 시장' : 'CoinLore 토큰 지표',
        dataAsOf: null,
        fetchedAt: iso(at),
        observedAt: at,
        periodStart: null,
        periodEnd: null,
        status: 'verified',
      }),
    );
  };
  await put('global', 'global', 'market_cap', global.total_mcap, 'USD');
  await put('global', 'global', 'volume_24h', global.total_volume, 'USD');
  await put('global', 'global', 'btc_share', global.btc_d, '%');
  await put('global', 'global', 'eth_share', global.eth_d, '%');
  const seen = new Set<string>();
  for (const token of tokenRaw) {
    const before = rows.length;
    try {
      const row = object(token),
        asset = ASSET_REGISTRY.find((a) => a.coinloreId === String(row.id));
      if (
        !asset ||
        !RESEARCH_ASSETS.includes(asset.id as (typeof RESEARCH_ASSETS)[number]) ||
        row.symbol !== asset.id ||
        seen.has(asset.id)
      )
        throw new Error('INVALID_TOKEN_IDENTITY');
      seen.add(asset.id);
      for (const scope of tokenScopes(asset.id)) {
        for (const [metric, field, unit] of [
          ['price', 'price_usd', 'USD'],
          ['market_cap', 'market_cap_usd', 'USD'],
          ['circulating_supply', 'csupply', asset.id],
          ['total_supply', 'tsupply', asset.id],
          ['max_supply', 'msupply', asset.id],
        ])
          await put(scope, asset.id, metric, row[field], unit);
      }
    } catch {
      rows.splice(before);
      diagnostics.rejectedTokens++;
    }
  }
  if (!rows.some((row) => row.metric === 'market_cap' && row.entityId === 'global'))
    throw new Error('INVALID_GLOBAL_TOTAL');
  return rows;
}
export async function collectCoinLore(
  at: number,
  options: ProviderOptions = {},
  cachedGlobal?: unknown,
): Promise<ProviderResult> {
  const global =
    cachedGlobal ?? (await boundedJson('https://api.coinlore.net/api/global/', options));
  if (!cachedGlobal && !options.fetcher) await new Promise((resolve) => setTimeout(resolve, 1050));
  const ids = RESEARCH_ASSETS.map((id) => ASSET_REGISTRY.find((a) => a.id === id)!.coinloreId).join(
    ',',
  );
  const tokens = await boundedJson('https://api.coinlore.net/api/ticker/?id=' + ids, options);
  const diagnostics = { rejectedTokens: 0 };
  return {
    observations: await normalizeCoinLore(global, tokens, options.now?.() ?? at, diagnostics),
    checkpoint: diagnostics,
  };
}
// Only explicitly identified tokens: ticker matching never resolves a provider asset ID.
// IDs/symbols checked against the official /coins/list response on 2026-10-18.
export const GECKO_IDS = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  'injective-protocol': 'INJ',
  hyperliquid: 'HYPE',
  uniswap: 'UNI',
  chainlink: 'LINK',
  'ondo-finance': 'ONDO',
  'sei-network': 'SEI',
  'dydx-chain': 'DYDX',
  aave: 'AAVE',
  ripple: 'XRP',
  ecash: 'XEC',
} as const;
export async function collectCoinGecko(
  at: number,
  options: ProviderOptions,
): Promise<ProviderResult> {
  if (!options.coinGeckoKey) return { observations: [] };
  const raw = await boundedJson(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' +
      Object.keys(GECKO_IDS).join(',') +
      '&sparkline=false',
    { ...options, headers: { 'x-cg-demo-api-key': options.coinGeckoKey } },
  );
  if (!Array.isArray(raw) || raw.length > 13) throw new Error('INVALID_COINGECKO');
  at = options.now?.() ?? at;
  const rows: Observation[] = [];
  for (const input of raw) {
    const row = object(input),
      asset = GECKO_IDS[row.id as keyof typeof GECKO_IDS];
    if (!asset || String(row.symbol).toUpperCase() !== asset)
      throw new Error('INVALID_TOKEN_IDENTITY');
    const time = Math.floor(Date.parse(row.last_updated) / 1000);
    if (!Number.isSafeInteger(time) || time > at + 300 || time < at - 86400)
      throw new Error('INVALID_SOURCE_TIME');
    for (const scope of tokenScopes(asset))
      for (const metric of ['market_cap', 'fully_diluted_valuation'] as const) {
        if (row[metric] === null) continue;
        rows.push(
          await observation({
            reportScope: scope,
            provider: 'coingecko',
            entityId: asset,
            entityType: 'token',
            metric: metric === 'fully_diluted_valuation' ? 'fdv' : metric,
            value: decimal(row[metric]),
            unit: 'USD',
            source: 'CoinGecko',
            sourceUrl: 'https://docs.coingecko.com/demo/reference/coins-markets',
            scope: 'CoinGecko 토큰 지표',
            dataAsOf: iso(time),
            fetchedAt: iso(at),
            observedAt: time,
            periodStart: null,
            periodEnd: null,
            status: 'verified',
          }),
        );
      }
  }
  return { observations: rows };
}
export async function normalizeTvl(
  raw: unknown,
  chain: string,
  scope: ReportScope,
  at: number,
): Promise<Observation[]> {
  if (
    !Array.isArray(raw) ||
    raw.length > 15000 ||
    !['Injective', 'Ethereum', 'Solana'].includes(chain)
  )
    throw new Error('INVALID_TVL');
  const seen = new Set<number>(),
    out: Observation[] = [];
  for (const input of raw) {
    const row = object(input),
      time = Number(row.date);
    if (!Number.isSafeInteger(time) || time < 0 || time % DAY !== 0 || seen.has(time))
      throw new Error('INVALID_TVL_TIME');
    seen.add(time);
    if (time + DAY > at || time < at - 100 * DAY) continue;
    const value = decimal(row.tvl);
    if (new D(value).lt(0)) throw new Error('INVALID_TVL_VALUE');
    out.push(
      await observation({
        reportScope: scope,
        provider: 'defillama',
        entityId: 'chain:' + chain.toLowerCase(),
        entityType: 'chain',
        metric: 'tvl',
        value,
        unit: 'USD',
        source: 'DefiLlama',
        sourceUrl: 'https://defillama.com/chain/' + chain.toLowerCase(),
        scope: chain + ' 체인의 DefiLlama 수록 TVL',
        dataAsOf: iso(time),
        fetchedAt: iso(at),
        observedAt: time,
        periodStart: null,
        periodEnd: null,
        status: 'verified',
      }),
    );
  }
  if (!out.length) throw new Error('INVALID_EMPTY_TVL');
  return out;
}
export async function collectTvl(
  chain: 'Injective' | 'Ethereum' | 'Solana',
  at: number,
  options: ProviderOptions = {},
): Promise<ProviderResult> {
  const raw = await boundedJson('https://api.llama.fi/v2/historicalChainTvl/' + chain, options);
  at = options.now?.() ?? at;
  const rows = await normalizeTvl(raw, chain, chain === 'Injective' ? 'injective' : 'global', at);
  if (chain === 'Injective') rows.push(...(await normalizeTvl(raw, chain, 'global', at)));
  return { observations: rows };
}
/** Provider's spot DEX taxonomy and daily USD breakdown. Chain totals may include
 * prediction markets; frontend/double-counted rows must never be added again. */
export async function normalizeInjectiveDex(raw: unknown, at: number): Promise<Observation[]> {
  const input = object(raw);
  if (
    input.chain !== 'Injective' ||
    !Array.isArray(input.protocols) ||
    input.protocols.length > 100 ||
    !Array.isArray(input.totalDataChartBreakdown) ||
    input.totalDataChartBreakdown.length > 15000
  )
    throw new Error('INVALID_DEX_SCOPE');
  const included = new Set<string>(),
    known = new Set<string>();
  for (const entry of input.protocols) {
    const p = object(entry);
    if (typeof p.name !== 'string' || p.name.length > 100 || known.has(p.name))
      throw new Error('INVALID_DEX_IDENTITY');
    known.add(p.name);
    if (
      p.category === 'Dexs' &&
      p.doublecounted !== true &&
      p.disabled !== true &&
      Array.isArray(p.chains) &&
      p.chains.includes('Injective')
    )
      included.add(p.name);
  }
  if (!included.size) throw new Error('INVALID_EMPTY_DEX');
  const rows: Observation[] = [],
    seen = new Set<number>();
  for (const entry of input.totalDataChartBreakdown) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('INVALID_DEX_DAY');
    const t = Number(entry[0]);
    if (!Number.isSafeInteger(t) || t < 0 || t % DAY || seen.has(t))
      throw new Error('INVALID_DEX_TIME');
    seen.add(t);
    if (t + DAY > at || t < at - 100 * DAY) continue;
    const breakdown = object(entry[1]);
    let total = new D(0),
      partial = false;
    const names: string[] = [];
    for (const [name, rawValue] of Object.entries(breakdown)) {
      if (!known.has(name)) {
        partial = true;
        continue;
      }
      if (!included.has(name)) continue;
      if (rawValue === null) {
        partial = true;
        continue;
      }
      const value = decimal(rawValue);
      if (new D(value).lt(0)) throw new Error('INVALID_DEX_VALUE');
      total = total.plus(value);
      names.push(name);
    }
    if (!names.length) continue;
    for (const reportScope of ['global', 'injective'] as const)
      rows.push(
        await observation({
          reportScope,
          provider: 'defillama-dex',
          entityId: 'chain:injective',
          entityType: 'chain',
          metric: 'dex_spot_volume',
          value: total.toFixed(),
          unit: 'USD',
          source: 'DefiLlama',
          sourceUrl: 'https://defillama.com/dexs/chain/injective',
          scope:
            'Injective 현물 DEX 관측 집계 · ' +
            names.sort().join(', ') +
            ' · 중복·파생·예측시장 제외',
          dataAsOf: iso(t + DAY),
          fetchedAt: iso(at),
          observedAt: t,
          periodStart: iso(t),
          periodEnd: iso(t + DAY),
          status: partial ? 'partial' : 'verified',
        }),
      );
  }
  if (!rows.length) throw new Error('INVALID_EMPTY_DEX');
  return rows;
}
export async function collectInjectiveDex(
  at: number,
  options: ProviderOptions = {},
): Promise<ProviderResult> {
  const raw = await boundedJson(
    'https://api.llama.fi/overview/dexs/Injective?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=false',
    options,
  );
  return { observations: await normalizeInjectiveDex(raw, options.now?.() ?? at) };
}
