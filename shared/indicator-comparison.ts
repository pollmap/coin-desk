import { ASSETS } from './catalog';
import { indicatorDefinition } from './indicator-catalog';
import { isRangePeriod, periodStart } from './ranges';
import type { Asset, Period, Point, Provenance } from './types';

export const COMPARISON_METRICS = ['net:mvrv', 'rsi', 'drawdown', 'futures:funding'] as const;
export interface IndicatorComparisonRow {
  asset: Asset;
  state: 'ready' | 'delayed' | 'unsupported' | 'pending' | 'error';
  reason?: string;
  data: Point[];
  meta?: Provenance;
}
export interface IndicatorComparison {
  metric: string;
  definitionKey: string;
  mode: 'shared-axis' | 'separate-panels';
  source: string;
  unit: string;
  range: { from: number; to: number };
  common: { first: number | null; last: number | null; observations: number };
  rows: IndicatorComparisonRow[];
  warning: string;
}
export function comparisonSelection(q: URLSearchParams, now = Math.floor(Date.now() / 1000)) {
  const allowed = ['assets', 'metric', 'source', 'period', 'from', 'to'];
  for (const key of q.keys())
    if (!allowed.includes(key) || q.getAll(key).length !== 1)
      throw new Error('잘못된 비교 설정입니다.');
  const assets = (q.get('assets') ?? 'BTC,ETH').split(',');
  if (
    assets.length < 2 ||
    assets.length > 3 ||
    new Set(assets).size !== assets.length ||
    assets.some((id) => !ASSETS.some((a) => a.id === id))
  )
    throw new Error('서로 다른 코인 2~3개를 선택해 주세요.');
  const metric = q.get('metric') ?? 'net:mvrv';
  if (!(COMPARISON_METRICS as readonly string[]).includes(metric))
    throw new Error('지원하지 않는 비교 지표입니다.');
  const definition = indicatorDefinition(metric)!;
  const source =
    q.get('source') ??
    (definition.comparison!.source === 'price' ? 'binance' : definition.comparison!.source);
  if (
    definition.comparison!.source === 'price'
      ? !['reference', 'binance', 'upbit'].includes(source)
      : source !== definition.comparison!.source
  )
    throw new Error('지표와 데이터 원천이 일치하지 않습니다.');
  const period = q.get('period') ?? definition.defaultPeriod;
  if (!isRangePeriod(period)) throw new Error('지원하지 않는 기간입니다.');
  const number = (key: string, fallback: number) => {
    const raw = q.get(key);
    if (raw === null) return fallback;
    if (!/^\d{1,10}$/.test(raw) || Number(raw) > now + 86400) throw new Error('잘못된 날짜입니다.');
    return Number(raw);
  };
  const from = number('from', periodStart(period as Period, now));
  const to = number('to', now);
  if (from >= to) throw new Error('시작일은 종료일보다 앞서야 합니다.');
  return {
    assets: assets as Asset[],
    metric,
    source,
    definition,
    from,
    to,
    period: period as Period,
  };
}
export function commonObservations(rows: IndicatorComparisonRow[]) {
  const valid = rows.filter((r) => r.data.length);
  if (valid.length < 2 || valid.length !== rows.length)
    return { first: null, last: null, observations: 0 };
  const maps = valid.slice(1).map((r) => new Set(r.data.map((p) => p.time)));
  const times = valid[0].data.filter((p) => maps.every((m) => m.has(p.time))).map((p) => p.time);
  return { first: times[0] ?? null, last: times.at(-1) ?? null, observations: times.length };
}
export function indicatorComparisonUrl(asset: Asset, metric: string, context: URLSearchParams) {
  const compareMetric = (COMPARISON_METRICS as readonly string[]).includes(metric)
    ? metric
    : 'net:mvrv';
  const definition = indicatorDefinition(compareMetric)!;
  const q = new URLSearchParams({
    mode: 'indicator',
    assets: `${asset},${asset === 'BTC' ? 'ETH' : 'BTC'}`,
    metric: compareMetric,
    period: context.get('period') ?? definition.defaultPeriod,
    source:
      definition.comparison!.source === 'price'
        ? (context.get('price_source') ?? context.get('market') ?? 'binance')
        : definition.comparison!.source,
  });
  for (const [before, after] of [
    ['from', 'from'],
    ['to', 'to'],
    ['chart_from', 'chart_from'],
    ['chart_to', 'chart_to'],
    ['reading_date', 'reading_date'],
  ])
    if (context.has(before)) q.set(after, context.get(before)!);
  return '/compare?' + q;
}
