import {
  comparisonSelection,
  commonObservations,
  type IndicatorComparison,
  type IndicatorComparisonRow,
} from '../shared/indicator-comparison';
import { contiguousCalculation, drawdowns } from '../shared/analysis-workspace';
import { supportsMarket, referenceAssets } from '../shared/asset-registry';
import { DAY } from '../shared/math';
import type { Asset, Market, Point, SeriesResponse } from '../shared/types';
import { candleHistory } from './candle-history';
import { readNetworkSeries } from './network-data';
import { readDerivativeSeries } from './derivatives';
import { epoch, type Env } from './storage';

async function pages(read: (from: number) => Promise<SeriesResponse>, from: number) {
  const data: Point[] = [];
  let result: SeriesResponse;
  for (let count = 0; count < 24; count++) {
    result = await read(from);
    data.push(...result.data);
    if (result.nextCursor === null) return { ...result, data };
    if (result.nextCursor <= from) throw new Error('Invalid history cursor');
    from = result.nextCursor;
  }
  throw new Error('Comparison history limit exceeded');
}
export async function indicatorComparison(
  env: Env,
  q: URLSearchParams,
): Promise<IndicatorComparison> {
  const selection = comparisonSelection(q);
  const { assets, definition, metric, source, from, to } = selection;
  const rows: IndicatorComparisonRow[] = [];
  for (const asset of assets) {
    if (
      !definition.assets.includes(asset) ||
      !env.ENABLED_ASSETS.split(',').includes(asset) ||
      (source === 'reference' && !referenceAssets.includes(asset)) ||
      (['upbit', 'binance'].includes(source) && !supportsMarket(asset, source as Market))
    ) {
      rows.push({
        asset,
        data: [],
        state: 'unsupported',
        reason: '이 코인에서 선택한 지표·원천을 지원하지 않습니다.',
      });
      continue;
    }
    try {
      let result: SeriesResponse;
      if (metric === 'net:mvrv')
        result = await pages(
          (start) => readNetworkSeries(env.DB, asset, 'mvrv', start, to, 1000),
          from,
        );
      else if (metric === 'futures:funding')
        result = await pages(
          (start) => readDerivativeSeries(env.DB, asset, 'funding', start, to, 1000),
          from,
        );
      else result = await priceIndicator(env, asset, source, metric, from, to);
      rows.push({
        asset,
        data: result.data,
        meta: result.meta,
        state: !result.data.length ? 'pending' : result.meta.stale ? 'delayed' : 'ready',
        reason: result.data.length ? result.meta.warning : '선택 기간의 확정 관측이 없습니다.',
      });
    } catch {
      rows.push({
        asset,
        data: [],
        state: 'error',
        reason: '이 코인의 데이터를 조회하지 못했습니다. 다시 시도해 주세요.',
      });
    }
  }
  return {
    metric,
    definitionKey: definition.comparison!.definitionKey,
    mode: definition.comparison!.mode,
    source,
    unit: definition.unit,
    range: { from, to },
    common: commonObservations(rows),
    rows,
    warning:
      metric === 'net:mvrv'
        ? 'Coin Metrics의 코인별 공급·실현가치 정의가 적용됩니다. 코인 간 저평가 순위가 아닙니다.'
        : metric === 'futures:funding'
          ? 'Bybit 실제 정산 비율입니다. 계약별 정산 간격이 달라 나란히 표시합니다. 공통값은 같은 정산 시각만 비교합니다.'
          : '같은 가격 원천의 확정 일별 종가로 계산합니다. 결측을 보간하지 않습니다.',
  };
}
async function priceIndicator(
  env: Env,
  asset: Asset,
  source: string,
  metric: string,
  from: number,
  to: number,
): Promise<SeriesResponse> {
  // RSI recurrence and expanding peak require the complete preceding history, not just the visible window.
  let points: Point[];
  if (source === 'reference') {
    const result = await env.DB.prepare(
      'SELECT time,value FROM reference_prices WHERE asset=? AND time<? ORDER BY time LIMIT 25001',
    )
      .bind(asset, Math.min(to, epoch() - DAY + 1))
      .all<Point>();
    if (result.results.length > 25000) throw new Error('History limit');
    points = result.results;
  } else {
    const rows = await candleHistory(env, asset, source as Market, '1d', 0, to, 25001);
    if (rows.length > 25000) throw new Error('History limit');
    points = rows
      .filter((r) => r.close_time <= epoch())
      .map((r) => ({ time: r.time, value: r.close }));
  }
  const key = source === 'reference' ? 'reference:' + asset : `${asset}:${source}:1d`;
  const state = await env.DB.prepare('SELECT last_success,error FROM ingestion WHERE key=?')
    .bind(key)
    .first<{ last_success: number; error: string | null }>();
  const fetched = state?.last_success ?? null;
  const data = (
    metric === 'rsi' ? contiguousCalculation(points, 'rsi', 14) : drawdowns(points)
  ).filter((p) => p.time >= from && p.time < to);
  return {
    data,
    price: [],
    nextCursor: null,
    meta: {
      source:
        source === 'reference'
          ? 'Coin Metrics Community'
          : source === 'upbit'
            ? 'Upbit'
            : 'Binance',
      unit: metric === 'rsi' ? '점' : '%',
      market: source,
      historyStart: points[0]?.time ?? null,
      dataAsOf: points.at(-1)?.time ?? null,
      fetchedAt: fetched,
      stale:
        !fetched ||
        epoch() - fetched > 25200 ||
        !points.length ||
        epoch() - points.at(-1)!.time > 3 * DAY ||
        !!state?.error,
      warning: state?.error ? '최근 수집 실패로 마지막 정상 관측을 표시합니다.' : undefined,
      calculationVersion:
        metric === 'rsi' ? 'confirmed-close:wilder-rsi14:1d' : 'confirmed-close:expanding-peak:1d',
    },
  };
}
