import { describe, expect, it } from 'vitest';
import { buildReport } from '../worker/onchain/report-builder';
import { DAY, iso, observation, type Observation } from '../worker/onchain/core';
import type { ReportJob } from '../worker/onchain/schedule';
import type { ResearchMarket } from '../shared/report-types';

const end = Date.parse('2026-10-18T00:00:00Z') / 1000,
  cutoff = end + 3600;
const job: ReportJob = {
  key: 'daily-global',
  revision: 1,
  type: 'daily',
  scope: 'global',
  start: end - DAY,
  end,
  scheduledAt: end + 600,
};
async function point(
  entity: string,
  metric: string,
  value: string,
  at: number,
  extra: Partial<Observation> = {},
) {
  return observation({
    reportScope: 'global',
    provider: entity.startsWith('chain:') ? 'defillama' : 'coinlore',
    entityId: entity,
    entityType: entity === 'global' ? 'global' : entity.startsWith('chain:') ? 'chain' : 'token',
    metric,
    value,
    unit: 'USD',
    source: 'fixture',
    sourceUrl: 'https://example.test/source',
    scope: 'fixture',
    dataAsOf: iso(at),
    fetchedAt: iso(cutoff),
    observedAt: at,
    periodStart: null,
    periodEnd: null,
    status: 'verified',
    ...extra,
  });
}
const facts = (report: NonNullable<Awaited<ReturnType<typeof buildReport>>>) =>
  report.sections.flatMap((s) =>
    s.kind === 'facts' ? s.items : s.kind === 'table' ? s.rows.flatMap((r) => r.facts) : [],
  );

describe('report period and evidence', () => {
  it('does not put today snapshot into yesterday report', async () => {
    const before = await point('global', 'market_cap', '100', end - 60);
    const future = await point('global', 'market_cap', '99999', end + 60);
    const report = await buildReport({ job, cutoff, observations: [before, future], markets: [] });
    expect(report).not.toBeNull();
    expect(facts(report!).find((f) => f.label === '시가총액')?.value).toBe('100');
    expect(report!.evidence.map((e) => e.id)).not.toContain(future.id);
  });
  it('publishes no document when only future or expired snapshots exist', async () => {
    for (const at of [end + 1, end - 4 * DAY])
      expect(
        await buildReport({
          job,
          cutoff,
          observations: [await point('global', 'market_cap', '100', at)],
          markets: [],
        }),
      ).toBeNull();
  });
  it('omits disabled FDV and empty token rows instead of generating dummy zeroes', async () => {
    const report = await buildReport({
      job,
      cutoff,
      observations: [await point('BTC', 'market_cap', '100', end - 10)],
      markets: [],
    });
    expect(report).not.toBeNull();
    expect(facts(report!).some((f) => f.label === 'FDV' || f.label === '시총 / FDV')).toBe(false);
    const table = report!.sections.find((s) => s.kind === 'table' && s.title === '관심 코인');
    expect(table && table.kind === 'table' ? table.rows.map((r) => r.label) : []).toEqual(['BTC']);
  });
  it('uses same-provider contemporaneous FDV, never mixes CoinLore cap into its ratio', async () => {
    const fdv = await point('INJ', 'fdv', '200', end - 10, { provider: 'coingecko' });
    const lore = await point('INJ', 'market_cap', '100', end - 10);
    let report = await buildReport({ job, cutoff, observations: [fdv, lore], markets: [] });
    expect(facts(report!).some((f) => f.label === '시총 / FDV')).toBe(false);
    const same = await point('INJ', 'market_cap', '80', end - 10, { provider: 'coingecko' });
    report = await buildReport({ job, cutoff, observations: [fdv, lore, same], markets: [] });
    expect(facts(report!).find((f) => f.label === '시총 / FDV')?.value).toBe('0.400000000000');
  });
  it('makes reproducible factual highlights from equal daily TVL observations', async () => {
    const observations = [
      await point('chain:injective', 'tvl', '110', end - DAY),
      await point('chain:injective', 'tvl', '100', end - 2 * DAY),
    ];
    const first = await buildReport({ job, cutoff, observations, markets: [] });
    const second = await buildReport({
      job,
      cutoff,
      observations: [...observations].reverse(),
      markets: [],
    });
    expect(second).toEqual(first);
    expect(first!.highlights).toContain('Injective TVL은 하루 전보다 10.00% 증가했습니다.');
    expect(
      first!.sections.some(
        (s) => s.kind === 'note' && s.text.includes('자금 순유입을 뜻하지 않습니다'),
      ),
    ).toBe(true);
    expect(first!.highlights.some((s) => s.includes('순유입'))).toBe(false);
  });
  it('rejects a report for an unfinished future period', async () => {
    await expect(
      buildReport({ job, cutoff: end - 1, observations: [], markets: [] }),
    ).rejects.toThrow('INVALID_REPORT_PERIOD');
  });
});

describe('completed non-overlapping flow windows', () => {
  it('sums only complete verified DEX days and does not add rolling snapshots', async () => {
    const dexJob: ReportJob = { ...job, key: 'weekly-dex', type: 'weekly', start: end - 7 * DAY };
    const observations = await Promise.all(
      Array.from({ length: 14 }, (_, i) => {
        const at = end - (i + 1) * DAY;
        return point('chain:injective', 'dex_spot_volume', i < 7 ? '0.2' : '0.1', at, {
          provider: 'defillama-dex',
          periodStart: iso(at),
          periodEnd: iso(at + DAY),
        });
      }),
    );
    const report = await buildReport({ job: dexJob, cutoff, observations, markets: [] });
    expect(facts(report!).find((f) => f.label === '완료 7일 현물 거래대금')?.value).toBe('1.4');
    expect(facts(report!).find((f) => f.label === '전주 대비')?.value).toBe('100.000000000000');
    expect(report!.evidence).toHaveLength(14);
    expect(
      await buildReport({ job: dexJob, cutoff, observations: observations.slice(1), markets: [] }),
    ).toBeNull();
  });
  const market: ResearchMarket = {
    id: '0x' + 'a'.repeat(64),
    chain: 'injective',
    network: 'mainnet',
    venue: 'injective',
    kind: 'spot',
    ticker: 'INJ/USDT',
    baseDenom: 'inj',
    quoteDenom: 'usdt',
    quoteSymbol: 'USDT',
    baseDecimals: 18,
    quoteDecimals: 6,
    status: 'active',
    sourceUrl: 'https://example.test/source',
    verifiedAt: iso(cutoff),
  };
  const weekly: ReportJob = {
    ...job,
    key: 'weekly-injective',
    scope: 'injective',
    type: 'weekly',
    start: end - 7 * DAY,
  };
  async function flows(count: number) {
    return Promise.all(
      Array.from({ length: count }, (_, i) => {
        const at = end - (i + 1) * DAY;
        return point('market:' + market.id, 'observed_taker_notional', '0.1', at, {
          reportScope: 'injective',
          entityType: 'market',
          provider: 'injective-trades',
          unit: 'USDT',
          periodStart: iso(at),
          periodEnd: iso(at + DAY),
        });
      }),
    );
  }
  it('requires 14 complete days for week-over-week and sums Decimal values exactly', async () => {
    const report = await buildReport({
      job: weekly,
      cutoff,
      observations: await flows(14),
      markets: [market],
    });
    const values = facts(report!);
    expect(values.find((f) => f.label === '완료 7일 거래대금')?.value).toBe('0.7');
    expect(values.find((f) => f.label === '전주 대비')?.value).toBe('0.000000000000');
    expect(values.find((f) => f.label === '완료 7일 거래대금')?.unit).toBe('USDT');
  });
  it('does not turn three days or overlapping 24-hour snapshots into a weekly total', async () => {
    const observations = await flows(3);
    observations.push(
      await point('market:' + market.id, 'volume_24h', '500', end - 1, {
        reportScope: 'injective',
        entityType: 'market',
        provider: 'injective-trades',
        unit: 'USDT',
      }),
    );
    const report = await buildReport({ job: weekly, cutoff, observations, markets: [market] });
    expect(report).toBeNull();
  });
  it('shows a verified week without inventing the previous week', async () => {
    const report = await buildReport({
      job: weekly,
      cutoff,
      observations: await flows(7),
      markets: [market],
    });
    expect(facts(report!).find((f) => f.label === '완료 7일 거래대금')?.value).toBe('0.7');
    expect(facts(report!).some((f) => f.label === '전주 대비')).toBe(false);
    expect(report!.dataQuality).toBe('partial');
  });
});
