import { describe, expect, it } from 'vitest';
import {
  decimal,
  DAY,
  iso,
  boundedJson,
  ProviderHttpError,
  observation,
  parseProviderJson,
} from '../worker/onchain/core';
import {
  GECKO_IDS,
  normalizeCoinLore,
  normalizeTvl,
  normalizeInjectiveDex,
} from '../worker/onchain/providers';
import {
  normalizeMarkets,
  normalizeTrade,
  resumeTradeWindow,
  emptyTradeCheckpoint,
  tradeObservation,
  collectChronosHistory,
  collectMarketSnapshot,
  type InjectiveClient,
} from '../worker/onchain/injective';
import { dueReportJobs } from '../worker/onchain/schedule';
import type { ResearchMarket } from '../shared/report-types';
const at = Date.parse('2026-10-18T01:00:00Z') / 1000;
const id = '0x' + 'a'.repeat(64);
const market: ResearchMarket = {
  id,
  chain: 'injective',
  network: 'mainnet',
  venue: 'injective',
  kind: 'spot',
  ticker: 'INJ/USDT',
  baseDenom: 'inj',
  quoteDenom: 'peggy',
  quoteSymbol: 'USDT',
  baseDecimals: 18,
  quoteDecimals: 6,
  status: 'active',
  sourceUrl: 'https://api.injective.exchange',
  verifiedAt: iso(at),
};
const rawTrade = (n = 0) => ({
  marketId: id,
  tradeId: 'block_' + n,
  executionSide: 'taker',
  executedAt: (Math.floor(at / DAY) * DAY - DAY) * 1000 + n,
  price: '0.000000000008709',
  quantity: '229000000000000000',
});
const client = (trades: unknown[]): InjectiveClient => ({
  fetchMarkets: async () => [],
  fetchOrderbookV2: async () => ({}),
  fetchTrades: async () => ({ trades }),
});
describe('research provider contracts', () => {
  it('preserves original JSON decimal tokens before normalization', () => {
    expect(parseProviderJson('{"value":9007199254740993.0000000001,"zero":0,"ok":true}')).toEqual({
      value: '9007199254740993.0000000001',
      zero: '0',
      ok: true,
    });
  });
  it('preserves decimal precision and rejects resource-exhausting exponents', () => {
    expect(decimal('0.000000000000000001')).toBe('0.000000000000000001');
    expect(() => decimal('1e-99999999')).toThrow('INVALID_DECIMAL');
    expect(() => decimal('Infinity')).toThrow();
    expect(decimal(0)).toBe('0');
  });
  it('normalizes independently verified spot and derivative chain units', () => {
    expect(normalizeTrade(rawTrade(), market, at)).toMatchObject({
      price: '8.709',
      quantity: '0.229',
      notional: '1.994361',
    });
    const perp = { ...market, kind: 'perpetual' as const, baseDecimals: null, quoteSymbol: 'USDC' };
    expect(
      normalizeTrade(
        { ...rawTrade(), executionPrice: '8628000', executionQuantity: '0.12' },
        perp,
        at,
      ),
    ).toMatchObject({ price: '8.628', quantity: '0.12', notional: '1.03536' });
    expect(() => normalizeTrade({ ...rawTrade(), executionSide: 'maker' }, market, at)).toThrow();
    expect(() =>
      normalizeTrade({ ...rawTrade(), marketId: '0x' + 'b'.repeat(64) }, market, at),
    ).toThrow();
  });
  it('does not identify a derivative as spot or use a ticker as the market identity', () => {
    const rows = normalizeMarkets(
      [
        {
          marketId: id,
          marketStatus: 'active',
          ticker: 'INJ/USDC PERP',
          quoteDenom: 'erc20:verified',
          quoteToken: { symbol: 'USDC', decimals: 6 },
          isPerpetual: true,
        },
      ],
      'derivative',
      at,
    );
    expect(rows[0]).toMatchObject({ id, kind: 'perpetual', baseDenom: null, quoteDecimals: 6 });
    expect(() => normalizeMarkets([{ marketId: 'INJ', quoteToken: {} }], 'spot', at)).toThrow();
  });
  it('keeps global values when a token identity is invalid and records its rejection', async () => {
    const diagnostics = { rejectedTokens: 0 };
    const rows = await normalizeCoinLore(
      [{ total_mcap: '100', total_volume: '0', btc_d: '50', eth_d: '20' }],
      [{ id: '90', symbol: 'WRONG', price_usd: '4' }],
      at,
      diagnostics,
    );
    expect(rows.find((r) => r.metric === 'volume_24h')?.value).toBe('0');
    expect(rows.every((r) => r.entityId === 'global')).toBe(true);
    expect(diagnostics.rejectedTokens).toBe(1);
    expect(rows.every((r) => r.dataAsOf === null)).toBe(true);
  });
  it('uses all thirteen verified CoinGecko IDs', () => {
    expect(Object.keys(GECKO_IDS)).toHaveLength(13);
    expect(GECKO_IDS['dydx-chain']).toBe('DYDX');
  });
  it('keeps UTC day TVL observations, zero and missing history distinct', async () => {
    const day = Math.floor(at / DAY) * DAY;
    const rows = await normalizeTvl(
      [
        { date: day - DAY, tvl: 0 },
        { date: day, tvl: 7 },
      ],
      'Injective',
      'injective',
      at,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('0');
    await expect(
      normalizeTvl([{ date: day - DAY, tvl: null }], 'Injective', 'injective', at),
    ).rejects.toThrow();
    await expect(
      normalizeTvl([{ date: day - DAY + 1, tvl: 1 }], 'Injective', 'injective', at),
    ).rejects.toThrow();
  });
  it('honors Retry-After without putting request credentials into errors', async () => {
    const fetcher = async () =>
      new Response('limited', { status: 429, headers: { 'Retry-After': '123' } });
    try {
      await boundedJson('https://api.coingecko.com/api/v3/global', {
        fetcher: fetcher as typeof fetch,
        headers: { 'x-cg-demo-api-key': 'private-example' },
      });
      throw new Error('expected');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect((error as ProviderHttpError).retryAfterSeconds).toBe(123);
      expect(String(error)).not.toContain('private-example');
    }
  });
  it('uses real completed Chronos days without turning countback into calendar coverage', async () => {
    const day = Math.floor(at / DAY) * DAY;
    const fetcher = async (url: RequestInfo | URL) => {
      expect(String(url)).toContain('resolution=1440');
      return Response.json([
        { marketID: id, t: [day - 3 * DAY, day - DAY, day], c: ['8', '9', '10'] },
      ]);
    };
    const rows = await collectChronosHistory(market, at, { fetcher: fetcher as typeof fetch });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.observedAt)).toEqual([day - 3 * DAY, day - DAY]);
  });
  it('normalizes only spot DEX daily USD values, excluding double-counted frontends and prediction/derivative activity', async () => {
    const day = Math.floor(at / DAY) * DAY;
    const raw = {
      chain: 'Injective',
      total24h: 999999,
      protocols: [
        { name: 'Spot A', category: 'Dexs', chains: ['Injective'] },
        { name: 'Frontend', category: 'Dexs', chains: ['Injective'], doublecounted: true },
        { name: 'Prediction', category: 'Prediction Market', chains: ['Injective'] },
        { name: 'Perp', category: 'Derivatives', chains: ['Injective'] },
      ],
      totalDataChartBreakdown: [
        [day - DAY, { 'Spot A': '100.12', Frontend: 100.12, Prediction: 10, Perp: 500 }],
        [day, { 'Spot A': 300 }],
      ],
    };
    const rows = await normalizeInjectiveDex(raw, at);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reportScope)).toEqual(['global', 'injective']);
    expect(rows[0]).toMatchObject({
      value: '100.12',
      unit: 'USD',
      observedAt: day - DAY,
      periodStart: iso(day - DAY),
      periodEnd: iso(day),
      status: 'verified',
    });
    expect(rows[0].scope).toContain('Spot A');
    expect(rows[0].scope).not.toContain('Frontend');
    const unknown = await normalizeInjectiveDex(
      { ...raw, totalDataChartBreakdown: [[day - DAY, { 'Spot A': 1, Unknown: 50 }]] },
      at,
    );
    expect(unknown[0].status).toBe('partial');
    expect(unknown[0].value).toBe('1');
    await expect(normalizeInjectiveDex({ ...raw, chain: 'Ethereum' }, at)).rejects.toThrow(
      'INVALID_DEX_SCOPE',
    );
    await expect(
      normalizeInjectiveDex(
        { ...raw, totalDataChartBreakdown: [[day - DAY, { 'Spot A': null }]] },
        at,
      ),
    ).rejects.toThrow('INVALID_EMPTY_DEX');
  });
  it('uses response receipt time after a slow tick without changing actual trade time', async () => {
    const received = at + 601,
      api = {
        ...client([{ ...rawTrade(), executedAt: received * 1000 - 1000 }]),
        fetchOrderbookV2: async () => ({ buys: [], sells: [] }),
      };
    const rows = await collectMarketSnapshot(api, market, at, () => received);
    expect(rows[0].dataAsOf).toBe(iso(received - 1));
    expect(rows[0].fetchedAt).toBe(iso(received));
    expect(rows[0].status).toBe('verified');
  });
});
describe('fixed-window trades and schedule', () => {
  const end = Math.floor(at / DAY) * DAY;
  it('deduplicates overlapping trade pages and keeps fixed root time arguments', async () => {
    let calls = 0;
    const api: InjectiveClient = {
      ...client([]),
      fetchTrades: async (args) => {
        expect(args.startTime).toBe((end - DAY) * 1000);
        expect(args.endTime).toBe(end * 1000 - 1);
        calls++;
        return {
          trades:
            calls === 1
              ? Array.from({ length: 100 }, (_, i) => rawTrade(i))
              : [rawTrade(99), rawTrade(100)],
        };
      },
    };
    const cp = await resumeTradeWindow(
      api,
      market,
      emptyTradeCheckpoint(market, end - DAY, end),
      at,
    );
    expect(cp.count).toBe(101);
    expect(cp.notional).toBe('201.430461');
    expect(cp.complete).toBe(true);
    expect((await tradeObservation(market, cp, at)).status).toBe('verified');
  });
  it('does not promote capped or repeating pages to complete history', async () => {
    const cp = { ...emptyTradeCheckpoint(market, end - DAY, end), skip: 900 };
    const result = await resumeTradeWindow(
      client(Array.from({ length: 100 }, (_, i) => rawTrade(i))),
      market,
      cp,
      at,
    );
    expect(result.limited).toBe(true);
    expect(result.complete).toBe(false);
    expect((await tradeObservation(market, result, at)).status).toBe('partial');
    const repeated = await resumeTradeWindow(
      client(Array.from({ length: 100 }, (_, i) => rawTrade(i))),
      market,
      emptyTradeCheckpoint(market, end - DAY, end),
      at,
    );
    expect(repeated.count).toBe(100);
    expect(repeated.limited).toBe(true);
  });
  it('rejects a provider ignoring the fixed window rather than counting other days', async () => {
    await expect(
      resumeTradeWindow(
        client([{ ...rawTrade(), executedAt: end * 1000 }]),
        market,
        emptyTradeCheckpoint(market, end - DAY, end),
        at,
      ),
    ).rejects.toThrow('INVALID_TRADE_WINDOW');
  });
  it('publishes daily at 09:10 KST and weekly Monday 09:20 KST', () => {
    const monday = Date.parse('2026-10-19T00:00:00Z') / 1000;
    const before = dueReportJobs(monday + 599),
      daily = dueReportJobs(monday + 600),
      weekly = dueReportJobs(monday + 1200);
    expect(before.find((j) => j.type === 'daily')!.end).toBe(monday - DAY);
    expect(daily.find((j) => j.type === 'daily')!.end).toBe(monday);
    expect(daily.find((j) => j.type === 'weekly')!.end).toBe(monday - 7 * DAY);
    expect(weekly.find((j) => j.type === 'weekly')!.end).toBe(monday);
    expect(new Set(weekly.map((j) => j.key)).size).toBe(4);
  });
  it('does not allow source credentials, negative or future observation times', async () => {
    const input = {
      reportScope: 'global' as const,
      provider: 'test',
      entityId: 'BTC',
      entityType: 'token' as const,
      metric: 'price',
      value: '1',
      unit: 'USD',
      source: 'Test',
      sourceUrl: 'https://example.com/?key=secret',
      scope: 'test',
      dataAsOf: iso(at),
      fetchedAt: iso(at),
      observedAt: at,
      periodStart: null,
      periodEnd: null,
      status: 'verified' as const,
    };
    await expect(observation(input)).rejects.toThrow('INVALID_SOURCE_URL');
    await expect(
      observation({ ...input, sourceUrl: 'https://example.com', observedAt: at + 301 }),
    ).rejects.toThrow('INVALID_OBSERVATION_TIME');
  });
});
