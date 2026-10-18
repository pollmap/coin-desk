import type {
  PublishedReport,
  ReportEvidence,
  ReportFact,
  ReportSection,
  ResearchMarket,
} from '../../shared/report-types';
import {
  D,
  DAY,
  hash,
  iso,
  percentageChange,
  RESEARCH_VERSION,
  seconds,
  TEMPLATE_VERSION,
  type Observation,
} from './core';
import { RESEARCH_ASSETS } from './providers';
import { reportId, type ReportJob } from './schedule';

type ReportInput = {
  job: ReportJob;
  cutoff: number;
  observations: Observation[];
  markets: ResearchMarket[];
  supersedes?: string | null;
};
/** Only observations at/before the report boundary can support a historical report. */
export async function buildReport(input: ReportInput): Promise<PublishedReport | null> {
  const { job, cutoff } = input;
  if (cutoff < job.end) throw new Error('INVALID_REPORT_PERIOD');
  const boundary = job.end,
    days = job.type === 'weekly' ? 7 : 1;
  const rows = input.observations
    .filter(
      (r) =>
        r.reportScope === job.scope && seconds(r.fetchedAt) <= cutoff && r.observedAt <= boundary,
    )
    .sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id));
  const used = new Map<string, ReportEvidence>(),
    notes = new Set<string>(),
    reading = new Set<string>();
  const sections: ReportSection[] = [],
    highlights: string[] = [];
  let incomplete = false;
  const use = (r: Observation) => {
    const { provider: _p, reportScope: _s, observedAt: _t, ...e } = r;
    used.set(e.id, e);
    return e.id;
  };
  const latest = (entity: string, metric: string, provider?: string, at = boundary) =>
    rows.find(
      (r) =>
        r.entityId === entity &&
        r.metric === metric &&
        (!provider || r.provider === provider) &&
        r.observedAt <= at &&
        r.value !== null &&
        r.status === 'verified',
    );
  const fact = (label: string, r: Observation | undefined, maxAge = 3600): ReportFact | null => {
    if (!r || boundary - r.observedAt > maxAge) {
      incomplete = true;
      return null;
    }
    return { label, value: r.value, unit: r.unit, evidenceIds: [use(r)] };
  };
  const facts = (items: (ReportFact | null)[]) => items.filter((r): r is ReportFact => r !== null);
  const changeLabel = days === 1 ? '하루 전 대비' : '전주 대비';
  const change = (
    entity: string,
    metric: string,
    provider: string,
    maxAge: number,
  ): ReportFact | null => {
    const current = latest(entity, metric, provider, boundary),
      previous = latest(entity, metric, provider, boundary - days * DAY);
    if (
      !current ||
      !previous ||
      current.unit !== previous.unit ||
      boundary - current.observedAt > maxAge ||
      boundary - days * DAY - previous.observedAt > maxAge
    ) {
      incomplete = true;
      return null;
    }
    const value = percentageChange(current.value!, previous.value!);
    return {
      label: changeLabel,
      value,
      unit: '%',
      evidenceIds: [use(current), use(previous)],
      ...(value === null ? { note: '비교값이 0이므로 변화율을 계산하지 않습니다.' } : {}),
    };
  };
  const addHighlight = (label: string, item: ReportFact | null) => {
    if (!item || item.value === null || highlights.length >= 3) return;
    const n = new D(item.value);
    highlights.push(
      n.eq(0)
        ? `${label}은 ${days === 1 ? '하루 전' : '전주'}과 같습니다.`
        : `${label}은 ${days === 1 ? '하루 전' : '전주'}보다 ${n.abs().toFixed(2)}% ${n.gt(0) ? '증가' : '감소'}했습니다.`,
    );
  };
  if (job.scope === 'global') {
    const items = facts([
      fact('시가총액', latest('global', 'market_cap', 'coinlore')),
      fact('최근 24시간 거래대금', latest('global', 'volume_24h', 'coinlore')),
      fact('BTC 비중', latest('global', 'btc_share', 'coinlore')),
      fact('ETH 비중', latest('global', 'eth_share', 'coinlore')),
    ]);
    const delta = change('global', 'market_cap', 'coinlore', 3600);
    if (delta) items.push(delta);
    if (items.length) {
      sections.push({ kind: 'facts', title: '시장 요약', items });
      reading.add(
        '시장 집계는 CoinLore 수록 범위입니다. 최근 24시간 거래대금은 겹치는 구간을 합산하지 않습니다.',
      );
    } else {
      incomplete = true;
      notes.add('이 기간의 시장 요약은 제외했습니다.');
    }
    addHighlight('시장 시가총액', delta);
  } else {
    const items = facts([
      fact('활성 현물 시장', latest('injective', 'active_spot_markets'), 8 * 3600),
      fact('활성 파생 시장', latest('injective', 'active_derivative_markets'), 8 * 3600),
      fact('INJ 가격', latest('INJ', 'price', 'coinlore')),
    ]);
    if (items.length) sections.push({ kind: 'facts', title: 'Injective', items });
    reading.add(
      'Injective 공유 거래 모듈을 관찰합니다. 특정 앱의 거래량이나 전체 거래소 시장으로 확대하지 않습니다.',
    );
  }
  const assets = job.scope === 'global' ? RESEARCH_ASSETS : (['INJ'] as const);
  const tokenRows = assets.flatMap((asset) => {
    const candidate = latest(asset, 'fdv', 'coingecko'),
      fdv = candidate && boundary - candidate.observedAt <= 3600 ? candidate : undefined;
    const sameCap = fdv
      ? rows.find(
          (r) =>
            r.entityId === asset &&
            r.metric === 'market_cap' &&
            r.provider === 'coingecko' &&
            r.observedAt === fdv.observedAt &&
            r.unit === fdv.unit &&
            r.status === 'verified' &&
            r.value !== null,
        )
      : undefined;
    const cap = sameCap ?? latest(asset, 'market_cap', 'coinlore');
    const fields = facts([fact('시가총액', cap)]);
    // Optional FDV is absent as a column when the provider is disabled/unavailable.
    if (fdv)
      fields.push({ label: 'FDV', value: fdv.value, unit: fdv.unit, evidenceIds: [use(fdv)] });
    if (sameCap?.value !== null && sameCap && fdv?.value && new D(fdv.value).gt(0))
      fields.push({
        label: '시총 / FDV',
        value: new D(sameCap.value!).div(fdv.value).toFixed(12),
        unit: '배',
        evidenceIds: [use(sameCap), use(fdv)],
      });
    return fields.length ? [{ label: asset, href: '/coins/' + asset, facts: fields }] : [];
  });
  if (tokenRows.length)
    sections.push({
      kind: 'table',
      title: job.scope === 'global' ? '관심 코인' : 'INJ 토큰',
      rows: tokenRows,
    });
  const chains = job.scope === 'global' ? ['ethereum', 'solana', 'injective'] : ['injective'];
  const tvlRows = chains.flatMap((chain) => {
    const label = { ethereum: 'Ethereum', solana: 'Solana', injective: 'Injective' }[chain]!;
    const current = latest('chain:' + chain, 'tvl', 'defillama'),
      value = fact('TVL', current, DAY);
    if (!value) return [];
    // TVL is a snapshot. Compare equally spaced daily observations, not sums.
    const previous = rows.find(
      (r) =>
        r.entityId === current!.entityId &&
        r.metric === 'tvl' &&
        r.provider === 'defillama' &&
        r.unit === current!.unit &&
        r.observedAt === current!.observedAt - days * DAY &&
        r.status === 'verified' &&
        r.value !== null,
    );
    const delta: ReportFact | null = previous
      ? {
          label: changeLabel,
          value: percentageChange(current!.value!, previous.value!),
          unit: '%',
          evidenceIds: [use(current!), use(previous)],
        }
      : null;
    if (!delta) incomplete = true;
    addHighlight(label + ' TVL', delta);
    return [{ label, facts: delta ? [value, delta] : [value] }];
  });
  if (tvlRows.length) {
    sections.push({ kind: 'table', title: '체인 TVL', rows: tvlRows });
    reading.add('TVL의 달러 가치 변화에는 가격 효과가 포함됩니다. 자금 순유입을 뜻하지 않습니다.');
  }
  const dexRows = rows.filter(
    (r) =>
      r.entityId === 'chain:injective' &&
      r.metric === 'dex_spot_volume' &&
      r.provider === 'defillama-dex' &&
      r.unit === 'USD',
  );
  if (dexRows.length) {
    const completed = (start: number) => {
      const points = Array.from({ length: days }, (_, i) => start + i * DAY).map((at) =>
        dexRows.find(
          (r) =>
            r.observedAt === at &&
            r.periodStart === iso(at) &&
            r.periodEnd === iso(at + DAY) &&
            r.status === 'verified' &&
            r.value !== null,
        ),
      );
      return points.every((p): p is Observation => Boolean(p)) ? (points as Observation[]) : null;
    };
    const current = completed(job.start),
      previous = completed(job.start - days * DAY);
    if (current) {
      const total = (points: Observation[]) =>
        points.reduce((sum, p) => sum.plus(p.value!), new D(0)).toFixed();
      const items: ReportFact[] = [
        {
          label: days === 7 ? '완료 7일 현물 거래대금' : '완료 하루 현물 거래대금',
          value: total(current),
          unit: 'USD',
          evidenceIds: current.map(use),
        },
      ];
      if (previous) {
        const delta: ReportFact = {
          label: changeLabel,
          value: percentageChange(total(current), total(previous)),
          unit: '%',
          evidenceIds: [...current, ...previous].map(use),
        };
        items.push(delta);
        addHighlight('Injective 현물 DEX 거래대금', delta);
      } else incomplete = true;
      sections.push({ kind: 'facts', title: 'Injective 현물 DEX', items });
      reading.add(
        '현물 DEX 거래대금은 DefiLlama에 수록된 검증 대상 합계입니다. 예측시장·파생·중복 집계를 제외하며 Injective 전체 거래량과 구분합니다.',
      );
    } else {
      incomplete = true;
      notes.add('전체 기간을 확인하지 못한 현물 DEX 거래대금은 제외했습니다.');
    }
  }
  if (job.scope === 'injective') {
    const activeIds = new Set(
      rows.filter((r) => r.entityType === 'market').map((r) => r.entityId.slice(7)),
    );
    const markets = input.markets.filter((m) => activeIds.has(m.id)).slice(0, 10);
    const marketRows = markets.flatMap((m) => {
      const items = facts([
        fact('마지막 체결', latest('market:' + m.id, 'last_trade_price', 'injective'), 300),
        fact('스프레드', latest('market:' + m.id, 'spread_bps', 'injective'), 300),
      ]);
      return items.length
        ? [{ label: m.ticker + ' · ' + (m.kind === 'spot' ? '현물' : '파생'), facts: items }]
        : [];
    });
    if (marketRows.length) sections.push({ kind: 'table', title: '관측 시장', rows: marketRows });
    const flowRows = markets.flatMap((m) => {
      const matching = rows.filter(
        (r) =>
          r.entityId === 'market:' + m.id &&
          r.metric === 'observed_taker_notional' &&
          r.provider === 'injective-trades' &&
          r.unit === m.quoteSymbol,
      );
      const window = (start: number, end: number) => {
        const items = Array.from({ length: (end - start) / DAY }, (_, i) => start + i * DAY).map(
          (t) =>
            matching.find(
              (r) => r.observedAt === t && r.periodStart === iso(t) && r.periodEnd === iso(t + DAY),
            ),
        );
        const complete = items.every((r) => r?.status === 'verified' && r.value !== null),
          available = items.filter((r): r is Observation => Boolean(r));
        return {
          complete,
          available,
          value: complete
            ? available.reduce((sum, r) => sum.plus(r.value!), new D(0)).toFixed()
            : null,
        };
      };
      const current = window(job.start, job.end);
      if (!current.complete) {
        incomplete = true;
        return [];
      }
      const fields: ReportFact[] = [
        {
          label: job.type === 'weekly' ? '완료 7일 거래대금' : '완료 하루 거래대금',
          value: current.value,
          unit: m.quoteSymbol,
          evidenceIds: current.available.map(use),
        },
      ];
      if (job.type === 'weekly') {
        const previous = window(job.start - 7 * DAY, job.start);
        if (previous.complete)
          fields.push({
            label: '전주 대비',
            value: percentageChange(current.value!, previous.value!),
            unit: '%',
            evidenceIds: [...current.available, ...previous.available].map(use),
          });
        else incomplete = true;
      }
      return [
        { label: m.ticker + ' · ' + (m.kind === 'spot' ? '현물' : '파생 명목'), facts: fields },
      ];
    });
    if (flowRows.length)
      sections.push({ kind: 'table', title: '기간별 관측 taker 체결', rows: flowRows });
    if (flowRows.length < markets.length || !markets.length) {
      incomplete = true;
      notes.add('전체 기간을 확인하지 못한 시장의 거래대금은 제외했습니다.');
    }
    reading.add(
      '선정 시장의 taker 체결을 원래 통화로 비교합니다. USDT·USDC를 합산하거나 정확한 USD로 바꾸지 않습니다.',
    );
  }
  const evidence = [...used.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!evidence.some((e) => e.value !== null && e.status === 'verified')) return null;
  // Definitions belong at the end; collection diagnostics never become report prose.
  if (reading.size) sections.push({ kind: 'note', title: '읽는 법', text: [...reading].join(' ') });
  const evidenceHash = await hash(evidence),
    date = iso(job.start).slice(0, 10).replaceAll('-', '.');
  return {
    reportId: reportId(job),
    reportType: job.type,
    scopeId: job.scope,
    title: `${date} ${job.scope === 'global' ? '시장' : 'Injective'} ${job.type === 'daily' ? '일간' : '주간'} 보고서`,
    periodStart: iso(job.start),
    periodEnd: iso(job.end),
    publishedAt: iso(cutoff),
    revision: job.revision,
    publicationStatus: 'published',
    dataQuality: incomplete ? 'partial' : 'complete',
    highlights,
    dataCutoff: iso(cutoff),
    generatedAt: iso(cutoff),
    supersedesReportId: input.supersedes ?? null,
    supersededByReportId: null,
    sections,
    evidence,
    coverageNotes: [...notes],
    methodologyVersion: RESEARCH_VERSION,
    templateVersion: TEMPLATE_VERSION,
    schemaVersion: 1,
    evidenceHash,
  };
}
export async function buildStoredReport(
  db: D1Database,
  job: ReportJob,
  cutoff: number,
  supersedes: string | null = null,
) {
  // Keep each series' closing observation for every UTC day. A boundary at
  // midnight belongs to the day it closes, so exact comparison anchors survive.
  // A global row cap silently discarded the previous week in a dense snapshot
  // feed. This bounds output by series × days, independently of polling rate.
  const result = await db
    .prepare(
      `SELECT payload FROM (
    SELECT payload,observed_at,id,ROW_NUMBER() OVER (
      PARTITION BY entity_id,metric,unit,provider,CAST((observed_at-1)/86400 AS INTEGER)
      ORDER BY observed_at DESC,id
    ) AS sample_rank
    FROM onchain_observations WHERE scope=? AND observed_at>=? AND observed_at<=? AND fetched_at<=?
      AND value IS NOT NULL AND status='verified'
  ) WHERE sample_rank=1 ORDER BY observed_at DESC,id`,
    )
    .bind(job.scope, job.start - 8 * DAY, job.end, cutoff)
    .all<{ payload: string }>();
  const markets = await db
    .prepare('SELECT payload FROM onchain_markets ORDER BY id')
    .all<{ payload: string }>();
  return buildReport({
    job,
    cutoff,
    observations: result.results.map((r) => JSON.parse(r.payload)),
    markets: markets.results.map((r) => JSON.parse(r.payload)),
    supersedes,
  });
}
