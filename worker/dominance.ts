import { ASSETS } from '../shared/catalog';
import type { Dominance } from '../shared/types';
import { DAY } from '../shared/math';
import { feedRequest } from './feed-client';
import { claimRefresh, epoch, failure, readState, putState, success, type Env } from './storage';
const ids: Record<string, string> = {
  BTC: '90',
  DOGE: '2',
  ETH: '80',
  SOL: '48543',
  XRP: '58',
  LINK: '2751',
  ONDO: '121611',
  PEPE: '93841',
  USDT: '518',
  USDC: '33285',
};
export const DOMINANCE_VERSION = 'coinlore-defillama-usd-v1';
async function fetchJson(url: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'User-Agent': 'Coin-Desk/0.2 market-dashboard' },
  });
  if (!res.ok) throw new Error(new URL(url).hostname + ' HTTP ' + res.status);
  return res.json() as Promise<any>;
}
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
export interface StableSnapshot {
  marketCap: number;
  asOf: number;
  fetchedAt: number;
}
export function normalizeStable(rows: any, now: number): StableSnapshot {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Invalid stablecoin history');
  const last = rows.at(-1),
    asOf = Number(last.date);
  // Only USD-valued totals; native EUR/JPY/etc quantities must never be added.
  const amounts = Object.values(last.totalCirculatingUSD || {});
  if (
    !amounts.length ||
    amounts.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) ||
    !positive(asOf) ||
    asOf > now + 300
  )
    throw new Error('Invalid stablecoin USD totals');
  const marketCap = (amounts as number[]).reduce((s, v) => s + v, 0);
  if (!positive(marketCap)) throw new Error('Invalid stablecoin market cap');
  return { marketCap, asOf, fetchedAt: now };
}
/** Parse only the final object of a JSON array, including quoted/escaped braces.
 * The upstream returns its full history; parsing thousands of unused days costs CPU.
 */
export function lastArrayObject(text: string): unknown {
  const s = text.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) throw new Error('Invalid stablecoin array');
  let end = s.length - 2;
  while (end > 0 && /\s/.test(s[end])) end--;
  if (s[end] !== '}') throw new Error('Invalid stablecoin array tail');
  let depth = 0,
    quoted = false;
  for (let i = end; i > 0; i--) {
    const c = s[i];
    if (c === '"') {
      let escapes = 0;
      for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) escapes++;
      if (escapes % 2 === 0) quoted = !quoted;
    }
    if (quoted) continue;
    if (c === '}') depth++;
    if (c === '{' && --depth === 0) return JSON.parse(s.slice(i, end + 1));
  }
  throw new Error('Invalid stablecoin array nesting');
}
export async function updateStable(env: Env) {
  const response = await fetch('https://stablecoins.llama.fi/stablecoincharts/all', {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'User-Agent': 'Coin-Desk/0.2 market-dashboard' },
  });
  if (!response.ok) throw new Error('DefiLlama HTTP ' + response.status);
  const raw = lastArrayObject(await response.text());
  const result = normalizeStable([raw], epoch());
  await putState(env.DB, 'stablecoin-total', result);
  await env.DB.prepare(
    'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
  )
    .bind(
      'defillama',
      'https://stablecoins.llama.fi/stablecoincharts/all',
      epoch(),
      JSON.stringify(raw),
    )
    .run();
  await success(env.DB, 'defillama', result.asOf);
  return result;
}
export function normalizeDominance(
  global: any,
  markets: any,
  stable: StableSnapshot | null,
  now: number,
): Dominance {
  const total = Number(global?.[0]?.total_mcap);
  if (!positive(total) || !Array.isArray(markets)) throw new Error('Invalid market cap source');
  const coins: Dominance['coins'] = [
    ...ASSETS.map((a) => ({ id: a.id, label: a.name })),
    { id: 'USDT', label: 'USDT' },
    { id: 'USDC', label: 'USDC' },
  ].map((asset) => {
    const row = markets.find((r: any) => r.id === ids[asset.id]);
    const cap = Number(row?.market_cap_usd);
    if (!row || row.symbol !== asset.id || !positive(cap) || cap > total)
      throw new Error('Invalid market cap: ' + asset.id);
    return {
      id: asset.id,
      label: asset.label,
      value: (100 * cap) / total,
      marketCap: cap,
      asOf: now,
      source: 'CoinLore',
      timeBasis: 'retrieved',
    };
  });
  if (coins.reduce((sum, coin) => sum + coin.marketCap!, 0) > total)
    throw new Error('Selected market caps exceed total market cap');
  if (stable) {
    if (
      !positive(stable.marketCap) ||
      stable.marketCap > total ||
      !positive(stable.asOf) ||
      stable.asOf > now + 300
    )
      throw new Error('Invalid stablecoin snapshot');
    coins.splice(8, 0, {
      id: 'STABLE',
      label: '스테이블코인 전체 ≈',
      value: (100 * stable.marketCap) / total,
      marketCap: stable.marketCap,
      asOf: stable.asOf,
      source: 'DefiLlama / CoinLore',
      timeBasis: 'daily',
    });
  }
  return {
    coins,
    totalMarketCap: total,
    asOf: now,
    fetchedAt: now,
    stale: !!stable && now - stable.asOf > 3 * DAY,
    source: 'CoinLore / DefiLlama',
    calculationVersion: DOMINANCE_VERSION,
    warning: !stable ? '스테이블코인 전체 시가총액 수집 대기 중입니다.' : undefined,
  };
}
export async function updateDominance(env: Env): Promise<Dominance> {
  const stable = await readState<StableSnapshot | null>(env.DB, 'stablecoin-total', null);
  const { global, markets } =
    env.FEED_URL && env.FEED_TOKEN
      ? ((await feedRequest(env, '/coinlore')) as { global: unknown; markets: unknown })
      : await coinloreSnapshot();
  const result = normalizeDominance(global, markets, stable, epoch());
  await putState(env.DB, 'dominance', result);
  await env.DB.prepare(
    'INSERT OR REPLACE INTO raw_samples(id,source,fetched_at,body) VALUES(?,?,?,?)',
  )
    .bind('coinlore', 'https://api.coinlore.net/api/', epoch(), JSON.stringify({ global, markets }))
    .run();
  if (!result.stale && !result.warning)
    await env.DB.prepare(
      'INSERT OR REPLACE INTO dominance_history(time,data,fetched_at) VALUES(?,?,?)',
    )
      .bind(result.asOf, JSON.stringify(result), epoch())
      .run();
  await success(env.DB, 'coinlore', result.asOf);
  return result;
}
export async function coinloreSnapshot() {
  const global = await fetchJson('https://api.coinlore.net/api/global/');
  // Respect the provider's one-request-per-second recommendation.
  await new Promise((resolve) => setTimeout(resolve, 1050));
  const markets = await fetchJson(
    'https://api.coinlore.net/api/ticker/?id=' + Object.values(ids).join(','),
  );
  return { global, markets };
}
export async function getDominance(env: Env, refresh = true) {
  let value = await readState<Dominance | null>(env.DB, 'dominance', null);
  if (value?.calculationVersion !== DOMINANCE_VERSION) value = null;
  const retry = await env.DB.prepare('SELECT next_attempt,error FROM ingestion WHERE key=?')
    .bind('coinlore')
    .first<{ next_attempt: number; error: string | null }>();
  let warning: string | undefined = retry?.error
    ? '시장 비중 원천의 연결이 지연되어 마지막 정상 값을 표시합니다.'
    : undefined;
  if (
    refresh &&
    (!value ||
      epoch() - value.fetchedAt > 3600 ||
      (!value.coins.some((c) => c.id === 'STABLE') && epoch() - value.fetchedAt > 300)) &&
    (retry?.next_attempt || 0) <= epoch() &&
    (await claimRefresh(env.DB, 'dominance', 300))
  ) {
    try {
      value = await updateDominance(env);
      warning = undefined;
    } catch (e) {
      await failure(env.DB, 'coinlore', e);
      warning = '시장 비중 원천의 연결이 지연되어 마지막 정상 값을 표시합니다.';
    }
  } else if ((retry?.next_attempt || 0) > epoch()) warning = '시장 비중 원천 재시도 대기 중입니다.';
  return value
    ? {
        ...value,
        stale:
          !!warning ||
          value.stale ||
          epoch() - value.asOf > 7200 ||
          value.coins.some((c) => c.id === 'STABLE' && epoch() - c.asOf > 3 * DAY),
        warning: warning || value.warning,
      }
    : null;
}
