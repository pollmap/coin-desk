import { claimRefresh, epoch, putState, readState, type Env } from './storage';
export const WATCHED_PROVIDERS = [
  ['TradingView', 'https://www.tradingview.com/blog/en/category/new-features/'],
  ['CryptoQuant', 'https://cryptoquant.com/asset/btc/summary'],
  ['Glassnode', 'https://docs.glassnode.com/'],
  ['CoinGlass', 'https://docs.coinglass.com/'],
  ['DefiLlama', 'https://api.llama.fi/v2/historicalChainTvl/Ethereum'],
  ['Coin Metrics', 'https://community-api.coinmetrics.io/v4/catalog/assets'],
  ['Upbit', 'https://docs.upbit.com/kr/changelog'],
] as const;
interface Check {
  name: string;
  url: string;
  checkedAt: number;
  status: number | null;
  fingerprint: string | null;
  changed: boolean;
  previousFingerprint: string | null;
}
/** A weekly availability/change candidate check, never an automatic product rewrite. */
export async function refreshProviderWatch(env: Env) {
  if (!(await claimRefresh(env.DB, 'provider-watch', 7 * 86400))) return;
  const previous = await readState<Check[]>(env.DB, 'provider-watch', []);
  const checks: Check[] = [];
  for (const [name, url] of WATCHED_PROVIDERS) {
    const prior = previous.find((p) => p.name === name);
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
      const status = res.status;
      const reader = res.body?.getReader();
      let total = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (total < 96000) {
          const part = await reader.read();
          if (part.done) break;
          const bytes = part.value.slice(0, 96000 - total);
          chunks.push(bytes);
          total += bytes.length;
        }
        await reader.cancel();
      }
      const body = new Uint8Array(total);
      let at = 0;
      for (const part of chunks) {
        body.set(part, at);
        at += part.length;
      }
      const digest = res.ok
        ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')
        : null;
      checks.push({
        name,
        url,
        checkedAt: epoch(),
        status,
        fingerprint: digest ?? prior?.fingerprint ?? null,
        changed: !!digest && !!prior?.fingerprint && digest !== prior.fingerprint,
        previousFingerprint: prior?.fingerprint ?? null,
      });
    } catch {
      checks.push({
        name,
        url,
        checkedAt: epoch(),
        status: null,
        fingerprint: prior?.fingerprint ?? null,
        changed: false,
        previousFingerprint: prior?.fingerprint ?? null,
      });
    }
  }
  await putState(env.DB, 'provider-watch', checks);
}
