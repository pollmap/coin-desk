import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Limited public-source probe. Does not open a database or advance any collector. */
export async function checkUpstreams(env, providers, request = fetch) {
  const checks = [];
  const json = async (url) => {
    const response = await request(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'User-Agent': 'CoinDesk-owned-VPS-preflight/1.0' },
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  };
  const probe = async (source, run) => {
    try {
      const detail = await run();
      checks.push({ source, ok: true, ...detail });
    } catch (error) {
      // Upstream messages/headers can contain sensitive or untrusted content.
      const status = /^HTTP (\d{3})$/.exec(error?.message || '');
      checks.push({
        source,
        ok: false,
        reason: status
          ? 'HTTP ' + status[1]
          : ['EACCES', 'EPERM'].includes(error?.cause?.code || error?.code)
            ? 'network-permission-denied'
            : 'connection-or-data-validation-failed',
      });
    }
  };
  await Promise.all([
    ...['binance', 'upbit'].map((market) =>
      probe(market, async () => {
        const result = await providers.getQuotes(['BTC', 'DOGE', 'ETH'], market, env);
        if (result.requestFailed || result.errors.length || result.quotes.length !== 3)
          throw new Error('Quote validation failed');
        return { validatedCoreQuotes: result.quotes.length };
      }),
    ),
    probe('coin-metrics', async () => {
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const data = await json(
        'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD&frequency=1d&page_size=7&start_time=' +
          encodeURIComponent(from),
      );
      if (!Array.isArray(data.data) || !data.data.some((row) => Number(row.PriceUSD) > 0))
        throw new Error('Invalid data');
    }),
    probe('bitview', async () => {
      const data = await providers.bitviewPage(env.BITVIEW_BASE_URL, 0, 1);
      if (!data.rows.length) throw new Error('Invalid data');
    }),
    probe('bybit', async () => {
      const data = await json(
        'https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1',
      );
      if (data.retCode !== 0 || !Array.isArray(data.result?.list) || !data.result.list.length)
        throw new Error('Invalid data');
    }),
    probe('defillama', async () => {
      const data = await json('https://api.llama.fi/v2/historicalChainTvl/Ethereum');
      if (!Array.isArray(data) || !data.some((row) => Number(row.tvl) > 0))
        throw new Error('Invalid data');
    }),
    probe('coinlore', async () => {
      const data = await json('https://api.coinlore.net/api/global/');
      if (!Array.isArray(data) || !(Number(data[0]?.total_mcap) > 0))
        throw new Error('Invalid data');
    }),
    probe('mempool', async () => {
      const data = await json('https://mempool.space/api/v1/fees/recommended');
      if (!Number.isFinite(data.fastestFee) || data.fastestFee < 0) throw new Error('Invalid data');
    }),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    scope: 'limited-upstream-access-not-all-103-sources',
    databaseWrites: 0,
    ok: checks.every((check) => check.ok),
    checks: checks.sort((a, b) => a.source.localeCompare(b.source)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { createEnvironment } = await import('./environment.mjs');
  const providers = await import('../server-dist/providers.mjs');
  const report = await checkUpstreams(await createEnvironment(null), providers);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
