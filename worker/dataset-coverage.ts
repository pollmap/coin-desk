import { assetDefinition, supportsMarket, referenceAssets } from '../shared/asset-registry';
import { networkMetrics, networkUnit } from '../shared/network-catalog';
import {
  observationGaps,
  type DatasetCoverage,
  type DatasetCoverageRow,
} from '../shared/dataset-coverage';
import type { Asset, Point, Quote } from '../shared/types';
import { candleHistory } from './candle-history';
import { decodeMonth } from './network-data';
import { derivativeAsset, DERIVATIVE_METRICS } from './derivatives';
import { epoch, type Env } from './storage';
import { failureCode } from './health';
import { annotateCoverageGaps } from './coverage-evidence';

export async function datasetCoverage(env: Env, asset: Asset): Promise<DatasetCoverage> {
  const now = epoch();
  const sources: DatasetCoverageRow[] = [];
  const states = (
    await env.DB.prepare(
      'SELECT key,last_success,error FROM ingestion WHERE key LIKE ? OR key LIKE ? OR key=? OR key=?',
    )
      .bind(`${asset}:%`, `derivatives:${asset}:%`, `network:${asset}`, `reference:${asset}`)
      .all<{ key: string; last_success: number; error: string | null }>()
  ).results;
  const add = (
    id: string,
    title: string,
    source: string,
    unit: string,
    times: number[],
    cadence: DatasetCoverageRow['cadence'],
    stateKey: string,
    providerFirst: number | null = null,
  ) => {
    sources.push({
      id,
      title,
      source,
      unit,
      first: times[0] ?? null,
      last: times.at(-1) ?? null,
      observations: times.length,
      cadence,
      providerFirst,
      gaps: annotateCoverageGaps(
        asset,
        id,
        times,
        cadence === 'settlement' ? null : cadence === '1h' ? 3600 : 86400,
        observationGaps(times, cadence === 'settlement' ? null : cadence === '1h' ? 3600 : 86400),
      ),
      status: states.find((s) => s.key === stateKey)?.error
        ? 'collection-error'
        : times.length
          ? 'available'
          : 'pending',
    });
  };
  for (const market of ['upbit', 'binance'] as const) {
    if (!supportsMarket(asset, market)) continue;
    for (const interval of ['1d', '1h'] as const) {
      const start = interval === '1h' ? now - 90 * 86400 : 0;
      const rows = await candleHistory(env, asset, market, interval, start, now, 25001);
      if (rows.length > 25000) throw new Error('Coverage bound exceeded');
      const times = rows.filter((r) => r.close_time <= now).map((r) => r.time);
      add(
        `${market}:${interval}`,
        interval === '1d' ? '일봉' : '시간봉 · 최근 90일',
        market === 'upbit' ? 'Upbit' : 'Binance',
        market === 'upbit' ? 'KRW' : 'USDT',
        times,
        interval,
        `${asset}:${market}:${interval}`,
      );
    }
  }
  const registry = assetDefinition(asset);
  if (referenceAssets.includes(asset)) {
    const points = (
      await env.DB.prepare(
        'SELECT time,value FROM reference_prices WHERE asset=? AND time+86400<=? ORDER BY time LIMIT 25001',
      )
        .bind(asset, now)
        .all<Point>()
    ).results;
    if (points.length > 25000) throw new Error('Coverage bound exceeded');
    add(
      'reference',
      'USD 참조 종가',
      'Coin Metrics',
      'USD',
      points.map((p) => p.time),
      '1d',
      `reference:${asset}`,
      Date.parse(registry!.network!.metrics.PriceUSD.first) / 1000,
    );
  }
  if (networkMetrics(asset).length) {
    const months = (
      await env.DB.prepare(
        'SELECT bucket,payload,fetched_at FROM network_months WHERE asset=? ORDER BY bucket LIMIT 601',
      )
        .bind(asset)
        .all<{ bucket: number; payload: string; fetched_at: number }>()
    ).results;
    if (months.length > 600) throw new Error('Coverage bound exceeded');
    const days = months.flatMap(decodeMonth).filter((d) => d.time + 86400 <= now);
    for (const metric of networkMetrics(asset)) {
      const first = metric.sourceMetric
        ? registry?.network?.metrics[metric.sourceMetric]?.first
        : undefined;
      add(
        `net:${metric.id}`,
        metric.title,
        'Coin Metrics',
        networkUnit(asset, metric.id),
        days.filter((d) => Number.isFinite(d.values[metric.id])).map((d) => d.time),
        '1d',
        `network:${asset}`,
        first ? Date.parse(first) / 1000 : null,
      );
    }
  }
  if (derivativeAsset(asset)) {
    for (const metric of DERIVATIVE_METRICS) {
      const rows = (
        await env.DB.prepare(
          'SELECT time FROM derivative_series WHERE asset=? AND metric=? AND time<=? ORDER BY time LIMIT 25001',
        )
          .bind(asset, metric, now)
          .all<{ time: number }>()
      ).results;
      if (rows.length > 25000) throw new Error('Coverage bound exceeded');
      add(
        `futures:${metric}`,
        metric,
        'Bybit USDT 무기한',
        metric.startsWith('open_interest') ? asset : '%',
        rows.map((r) => r.time),
        metric === 'funding' ? 'settlement' : metric.endsWith('_daily') ? '1d' : '1h',
        `derivatives:${asset}:${metric}`,
      );
    }
  }
  const quoteStates: DatasetCoverage['quoteStates'] = [];
  for (const market of ['upbit', 'binance'] as const) {
    if (!supportsMarket(asset, market)) continue;
    const snapshot = await env.DB.prepare('SELECT data FROM snapshots WHERE key=?')
      .bind(`quote:${asset}:${market}`)
      .first<{ data: string }>();
    const state = await env.DB.prepare('SELECT last_success,error FROM ingestion WHERE key=?')
      .bind(`quote:${asset}:${market}`)
      .first<{ last_success: number; error: string | null }>();
    let quote: Quote | null = null;
    let invalidSnapshot = false;
    if (snapshot) {
      try {
        quote = JSON.parse(snapshot.data);
        if (!quote || !Number.isSafeInteger(quote.time) || quote.time <= 0 || quote.time > now + 60)
          throw new Error('Invalid stored trade timestamp');
      } catch {
        quote = null;
        invalidSnapshot = true;
      }
    }
    quoteStates.push({
      source: market,
      tradedAt: quote?.time ?? null,
      checkedAt: state?.last_success ?? null,
      condition:
        invalidSnapshot || (state?.error && failureCode(state.error) !== 'TRADE_STALE')
          ? 'collection-error'
          : !quote
            ? 'pending'
            : now - quote.time > 300
              ? 'old-trade'
              : 'recent-trade',
    });
  }
  return {
    asset,
    checkedAt: now,
    sources,
    quoteStates,
    warning:
      '원천 응답을 확인한 공백과 미확인 공백을 구분합니다. 현재 원천에 값이 없어도 과거 제공·철회 여부나 거래 없음을 단정하지 않습니다. 최초 관측은 출시일이 아닙니다.',
  };
}
