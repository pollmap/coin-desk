import { expect, it } from 'vitest';
// @ts-expect-error JavaScript-only local SQLite adapter.
import { openDatabase } from '../scripts/local-db.mjs';
import { buildReport, buildStoredReport } from '../worker/onchain/report-builder';
import { DAY, iso, type Observation } from '../worker/onchain/core';
import { RESEARCH_ASSETS } from '../worker/onchain/providers';
import type { ReportJob } from '../worker/onchain/schedule';
import type { PublishedReport } from '../shared/report-types';

it('retains the weekly comparison boundary after normal half-hourly collection exceeds 20,000 rows', async () => {
  const db = openDatabase(':memory:');
  try {
    const end = Date.parse('2026-10-19T00:00:00Z') / 1000;
    const start = end - 7 * DAY;
    const cutoff = end + 1200;
    const job: ReportJob = {
      key: 'weekly|global|density-fixture',
      revision: 1,
      type: 'weekly',
      scope: 'global',
      start,
      end,
      scheduledAt: cutoff,
    };
    const rows: Observation[] = [];
    const add = (
      entityId: string,
      metric: string,
      unit: string,
      observedAt: number,
      value = '100',
    ) => {
      rows.push({
        id: 'obs-' + rows.length.toString(16).padStart(32, '0'),
        reportScope: 'global',
        provider: 'coinlore',
        entityId,
        entityType: entityId === 'global' ? 'global' : 'token',
        metric,
        unit,
        value,
        source: 'CoinLore',
        sourceUrl: 'https://www.coinlore.com/cryptocurrency-data-api',
        scope: 'deterministic density fixture',
        observedAt,
        fetchedAt: iso(observedAt),
        dataAsOf: null,
        periodStart: null,
        periodEnd: null,
        status: 'verified',
        calculationVersion: 'research-v1',
        contentHash: 'fixture',
      });
    };
    // The actual collection contract: 13 tokens, 5 fields, 4 global fields,
    // once every 30 minutes. No oversized provider response is required.
    for (let at = end - 8 * DAY; at <= end; at += 1800) {
      for (const asset of RESEARCH_ASSETS) {
        for (const metric of [
          'price',
          'market_cap',
          'circulating_supply',
          'total_supply',
          'max_supply',
        ])
          add(asset, metric, metric.endsWith('supply') ? asset : 'USD', at);
      }
      for (const metric of ['market_cap', 'volume_24h', 'btc_share', 'eth_share'])
        add(
          'global',
          metric,
          metric.endsWith('share') ? '%' : 'USD',
          at,
          at <= start ? '100' : '110',
        );
    }
    const insert = db.sqlite.prepare(`INSERT INTO onchain_observations
      (id,scope,entity_id,metric,unit,provider,observed_at,fetched_at,status,value,payload,content_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.sqlite.exec('BEGIN');
    for (const row of rows)
      insert.run(
        row.id,
        row.reportScope,
        row.entityId,
        row.metric,
        row.unit,
        row.provider,
        row.observedAt,
        row.observedAt,
        row.status,
        row.value,
        JSON.stringify(row),
        row.contentHash,
      );
    db.sqlite.exec('COMMIT');
    expect(rows.length).toBeGreaterThan(20_000);
    const baseline = rows.find(
      (row) => row.entityId === 'global' && row.metric === 'market_cap' && row.observedAt === start,
    )!;
    expect(
      db.sqlite.prepare('SELECT value FROM onchain_observations WHERE id=?').get(baseline.id).value,
    ).toBe('100');

    const direct = await buildReport({ job, cutoff, observations: rows, markets: [] });
    const stored = await buildStoredReport(db, job, cutoff);
    const weeklyChange = (report: PublishedReport | null) => {
      const section = report?.sections.find(
        (section) => section.kind === 'facts' && section.title === '시장 요약',
      );
      return section?.kind === 'facts'
        ? section.items.find((fact) => fact.label === '전주 대비')
        : undefined;
    };
    expect(weeklyChange(direct)?.value).toBe('10.000000000000');
    expect(weeklyChange(stored)).toEqual(weeklyChange(direct));
    expect(stored?.evidence.some((item) => item.id === baseline.id)).toBe(true);
  } finally {
    db.sqlite.close();
  }
});
