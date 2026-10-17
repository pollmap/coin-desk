import { useMarket } from './useMarket';
import { ComparisonModes } from './ComparisonModes';
import { MarketNavigation } from './MarketNavigation';
import { createDeskChart as createChart } from './chart-theme';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ColorType,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ASSETS } from '../shared/catalog';
import { AssetLogo } from './AssetLogo';
import { compareCloses, parseComparisonRange, type ComparisonResult } from '../shared/comparison';
import type { Asset, CandleResponse, Market } from '../shared/types';
import { PERIOD_OPTIONS, isRangePeriod, periodStart, type RangePeriod } from '../shared/ranges';
import { createComparisonLoader } from './comparison-data';
import { json, money, numeric, save, saved } from './lib';
import './comparison.css';

const DAY = 86400;
const DEFAULT_ASSETS: Asset[] = ['BTC', 'DOGE', 'ETH'];
const dailyHistory = createComparisonLoader((url, signal) => json<CandleResponse>(url, signal));
const utcDate = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
const percentage = (value: number | null, signed = false) =>
  value === null ? '—' : (signed && value > 0 ? '+' : '') + numeric(value) + '%';

/** Read the controls at submission time, including native date picker/autofill edits. */
export function comparisonDateSubmission(
  form: Pick<FormData, 'get'>,
  now = Date.now() / 1000,
): { from: string; to: string; error?: never } | { error: string } {
  const from = form.get('from'),
    to = form.get('to');
  const checked = parseComparisonRange(from, to, now);
  if (checked.error || !checked.range)
    return { error: checked.error || '시작일과 종료일을 실제 날짜로 함께 입력해 주세요.' };
  return { from: from as string, to: to as string };
}

function selectedAssets(value: unknown): Asset[] {
  const items = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const valid = ASSETS.filter((asset) => items.includes(asset.id)).map((asset) => asset.id);
  return valid.length >= 2 ? valid : DEFAULT_ASSETS;
}

function ComparisonChart({
  comparison,
  resetKey,
}: {
  resetKey: string;
  comparison: ComparisonResult;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef(new Map<string, ISeriesApi<'Line'>>());
  const previousKey = useRef('');
  const [hover, setHover] = useState<number | null>(null);
  const values = useMemo(
    () =>
      new Map(
        comparison.rows.map((row) => [
          row.asset,
          new Map(row.points.map((point) => [point.time, point.value])),
        ]),
      ),
    [comparison],
  );
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, {
      autoSize: true,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: '#111721' },
        textColor: '#a1aec0',
        attributionLogo: true,
      },
      grid: { vertLines: { color: '#1b2431' }, horzLines: { color: '#1b2431' } },
      rightPriceScale: { borderColor: '#293345', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: '#293345',
        lockVisibleTimeRangeOnResize: true,
        minBarSpacing: 0.01,
      },
      localization: {
        timeFormatter: (time: number) => utcDate(Number(time)) + ' UTC',
        priceFormatter: (value: number) => numeric(value),
      },
    });
    chart.current = api;
    api.subscribeCrosshairMove((event) =>
      setHover(typeof event.time === 'number' ? event.time : null),
    );
    const node = container.current;
    const publishRange = () => {
      const visible = api.timeScale().getVisibleRange();
      const logical = api.timeScale().getVisibleLogicalRange();
      node.dataset.visibleFrom = String(visible?.from ?? '');
      node.dataset.visibleTo = String(visible?.to ?? '');
      node.dataset.logicalFrom = String(logical?.from ?? '');
      node.dataset.logicalTo = String(logical?.to ?? '');
    };
    api.timeScale().subscribeVisibleLogicalRangeChange(publishRange);
    const frame = requestAnimationFrame(publishRange);
    return () => {
      cancelAnimationFrame(frame);
      api.timeScale().unsubscribeVisibleLogicalRangeChange(publishRange);
      chart.current = null;
      series.current.clear();
      previousKey.current = '';
      api.remove();
    };
  }, []);
  useEffect(() => {
    const api = chart.current;
    const node = container.current;
    if (!api || !node) return;
    const visible = api.timeScale().getVisibleLogicalRange();
    for (const [asset, line] of series.current) {
      if (!comparison.rows.some((row) => row.asset === asset)) {
        api.removeSeries(line);
        series.current.delete(asset);
      }
    }
    if (previousKey.current !== resetKey) setHover(null);
    comparison.rows.forEach((row, index) => {
      let line = series.current.get(row.asset);
      const isNew = !line;
      if (!line)
        line = api.addSeries(LineSeries, {
          color: ASSETS.find((asset) => asset.id === row.asset)!.color,
          lineWidth: 2,
          title: row.asset,
          lastValueVisible: false,
          priceLineVisible: false,
        });
      series.current.set(row.asset, line);
      const points = new Map(row.points.map((point) => [point.time, point.value]));
      const data = [];
      for (let time = comparison.start!; time <= comparison.end!; time += DAY) {
        const value = points.get(time);
        data.push(
          value === undefined
            ? { time: time as UTCTimestamp }
            : { time: time as UTCTimestamp, value },
        );
      }
      line.setData(data);
      if (index === 0 && isNew)
        line.createPriceLine({
          price: 100,
          color: '#6a7688',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '시작 100',
        });
    });
    node.dataset.points = String(comparison.observations);
    node.dataset.expectedFrom = String(comparison.start);
    node.dataset.expectedTo = String(comparison.end);

    if (previousKey.current !== resetKey || !visible) api.timeScale().fitContent();
    else api.timeScale().setVisibleLogicalRange(visible);
    const reset = previousKey.current !== resetKey || !visible;
    previousKey.current = resetKey;
    const frame = requestAnimationFrame(() => {
      if (reset) api.timeScale().fitContent();
      node.dataset.renderReady = '1';
    });
    return () => cancelAnimationFrame(frame);
  }, [comparison, resetKey]);
  const visibleTime = comparison.end;
  return (
    <>
      <div className="comparison-chart-toolbar">
        <span>시작값 100</span>
        <button onClick={() => chart.current?.timeScale().fitContent()}>차트 범위 초기화</button>
      </div>
      <div className="comparison-readout" aria-live="off">
        {comparison.rows.map((row) => {
          const value = values.get(row.asset)?.get(visibleTime ?? 0);
          return (
            <span key={row.asset}>
              <AssetLogo asset={row.asset} size={16} />
              <b>{row.asset}</b> <span>{value === undefined ? '관측 없음' : numeric(value)}</span>
              {value !== undefined ? (
                <small className={value >= 100 ? 'up' : 'down'}>
                  {' '}
                  {percentage(value - 100, true)}
                </small>
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="comparison-chart-surface">
        {hover !== null && (
          <span className="comparison-hover-reading" data-testid="chart-tooltip">
            {comparison.rows.map((row) => {
              const value = values.get(row.asset)?.get(hover);
              return value === undefined ? null : (
                <span key={row.asset}>
                  {row.asset} {numeric(value)}{' '}
                </span>
              );
            })}
          </span>
        )}
        <div
          className="comparison-chart"
          ref={container}
          role="group"
          aria-label="시작값 100으로 맞춘 코인 성과 비교 차트"
        />
      </div>
    </>
  );
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const initial = useMemo(() => saved<Record<string, unknown>>('comparison', {}), []);
  const assets = selectedAssets(params.get('assets') ?? initial.assets);
  const { market } = useMarket();
  const rawPeriod = params.get('period') ?? (initial.version === 2 ? initial.period : 'all');
  const period: RangePeriod = isRangePeriod(rawPeriod) ? rawPeriod : 'all';
  const hasUrlRange = params.has('from') || params.has('to');
  const restoreRange = !hasUrlRange && !params.has('period') && initial.version === 2;
  const fromValue =
    params.get('from') ?? (restoreRange && typeof initial.from === 'string' ? initial.from : null);
  const toValue =
    params.get('to') ?? (restoreRange && typeof initial.to === 'string' ? initial.to : null);
  const hasCustom = fromValue !== null || toValue !== null;
  const parsed = useMemo(() => parseComparisonRange(fromValue, toValue), [fromValue, toValue]);
  const assetKey = assets.join(',');
  const requestKey = [assetKey, market, period, fromValue ?? '', toValue ?? ''].join(':');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    loaded: number;
    data: Partial<Record<Asset, CandleResponse>>;
    errors: string[];
  }>({ key: '', loading: true, loaded: 0, data: {}, errors: [] });
  const [cooldown, setCooldown] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const forcedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!parsed.error)
      save('comparison', {
        version: 2,
        assets: assetKey.split(','),
        market,
        period,
        from: fromValue,
        to: toValue,
      });
  }, [assetKey, market, period, fromValue, toValue, parsed.error]);
  useEffect(() => {
    const controller = new AbortController();
    if (parsed.error) {
      setState({ key: requestKey, loading: false, loaded: 0, data: {}, errors: [] });
      return () => controller.abort();
    }
    const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
    const to = Math.min(today, parsed.range ? parsed.range.to + DAY : today);
    const from =
      parsed.range?.from ??
      Math.max(0, period === 'all' ? 0 : periodStart(period, today - DAY) - 7 * DAY);
    if (from >= to) {
      setState({
        key: requestKey,
        loading: false,
        loaded: 0,
        data: {},
        errors: [
          '선택한 날짜에는 아직 확정된 일봉이 없습니다. 종료일을 포함해 두 개 이상의 확정 일봉이 필요합니다.',
        ],
      });
      return () => controller.abort();
    }
    const selected = assetKey.split(',') as Asset[];
    setState((previous) => ({
      key: requestKey,
      loading: true,
      loaded: 0,
      data: previous.key === requestKey ? previous.data : {},
      errors: [],
    }));
    const timer = setTimeout(() => {
      const force = forcedKey.current === requestKey;
      forcedKey.current = null;
      const incoming: Partial<Record<Asset, CandleResponse>> = {};
      const errors: string[] = [];
      let next = 0,
        loaded = 0;
      const run = async () => {
        while (next < selected.length && !controller.signal.aborted) {
          const asset = selected[next++];
          try {
            incoming[asset] = await dailyHistory(asset, market, from, to, controller.signal, force);
            loaded++;
            if (!controller.signal.aborted) setState((previous) => ({ ...previous, loaded }));
          } catch (error) {
            errors.push(asset + ': ' + (error instanceof Error ? error.message : '조회 실패'));
          }
        }
      };
      void Promise.all([run(), run(), run(), run()]).then(() => {
        if (!controller.signal.aborted) {
          setState((previous) => ({
            ...previous,
            data: errors.length ? previous.data : incoming,
            errors,
            loading: false,
          }));
        }
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [assetKey, market, period, revision, requestKey, parsed]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 15 * 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), 30000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const active = state.key === requestKey;
  const loading = !active || state.loading;
  const comparison = useMemo(() => {
    const selected = assetKey.split(',') as Asset[];
    if (!active || parsed.error || selected.some((asset) => !state.data[asset])) return null;
    return compareCloses(
      selected.map((asset) => ({
        asset,
        candles: state.data[asset]!.data,
        historyStart: state.data[asset]!.meta.historyStart,
      })),
      period,
      Date.now() / 1000,
      parsed.range,
    );
  }, [active, state.data, assetKey, period, parsed]);
  function change(
    next: Partial<{
      assets: Asset[];
      market: Market;
      period: RangePeriod;
      from: string | null;
      to: string | null;
    }>,
  ) {
    const from = next.from !== undefined ? next.from : next.period !== undefined ? null : fromValue;
    const to = next.to !== undefined ? next.to : next.period !== undefined ? null : toValue;
    setParams(
      {
        assets: (next.assets ?? assets).join(','),
        market: next.market ?? market,
        period: next.period ?? period,
        ...(from !== null ? { from } : {}),
        ...(to !== null ? { to } : {}),
      },
      { replace: true },
    );
  }
  const responses = active ? Object.values(state.data) : [];
  const hasStale = responses.some((response) => response.meta.stale);
  return (
    <div className="comparison-page">
      <div className="page-heading">
        <div>
          <h1>가격 성과 비교</h1>
          <ComparisonModes mode="performance" />
        </div>
      </div>
      <details className="comparison-settings" open={!!parsed.error || undefined}>
        <summary>
          {assets.join(' · ')} · {market === 'upbit' ? 'Upbit KRW' : 'Binance USDT'} ·{' '}
          {hasCustom ? '직접 지정' : PERIOD_OPTIONS.find((p) => p.id === period)?.label}{' '}
          <span>설정 변경</span>
        </summary>
        <section className="panel comparison-controls" aria-label="비교 설정">
          <details className="comparison-selection">
            <summary>
              비교 코인 · {assets.join(' · ')} <span>변경</span>
            </summary>
            <div className="comparison-control-heading">
              <h2>비교할 코인</h2>
              <button onClick={() => change({ assets: DEFAULT_ASSETS })}>BTC · DOGE · ETH</button>
            </div>
            <div className="comparison-assets">
              {ASSETS.map((asset) => (
                <button
                  key={asset.id}
                  aria-pressed={assets.includes(asset.id)}
                  disabled={assets.length === 2 && assets.includes(asset.id)}
                  title={asset.name}
                  onClick={() =>
                    change({
                      assets: assets.includes(asset.id)
                        ? assets.filter((id) => id !== asset.id)
                        : [...assets, asset.id],
                    })
                  }
                >
                  <AssetLogo asset={asset.id} size={19} />
                  <b>{asset.id}</b>
                  <span>{asset.name}</span>
                </button>
              ))}
            </div>
          </details>
          <div className="comparison-options">
            <label>
              거래소 · 기준 통화{' '}
              <select
                value={market}
                onChange={(event) => change({ market: event.target.value as Market })}
              >
                <option value="binance">Binance · USDT</option>
                <option value="upbit">Upbit · KRW</option>
              </select>
            </label>
            <label className="comparison-period-compact">
              비교 기간
              <select
                aria-label="비교 기간"
                value={hasCustom ? 'custom' : period}
                onChange={(event) => {
                  change({ period: event.target.value as RangePeriod });
                }}
              >
                {hasCustom && (
                  <option value="custom" disabled>
                    직접 지정
                  </option>
                )}
                {PERIOD_OPTIONS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="segments comparison-period-wide" aria-label="비교 기간">
              {PERIOD_OPTIONS.map((entry) => (
                <button
                  key={entry.id}
                  aria-pressed={!hasCustom && period === entry.id}
                  className={!hasCustom && period === entry.id ? 'selected' : ''}
                  onClick={() => {
                    change({ period: entry.id });
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </details>
      {loading && <p role="status">비교 차트를 불러오는 중…</p>}
      {!loading && (state.errors.length > 0 || comparison?.error || parsed.error) && (
        <p role="alert">선택한 조건으로 비교하지 못했습니다.</p>
      )}
      {comparison?.rows.length ? (
        <>
          <section className="panel comparison-result">
            <div className="panel-title">
              <div>
                <h2>시작값 100</h2>
              </div>
            </div>
            <ComparisonChart comparison={comparison} resetKey={requestKey} />
            {!loading && hasStale && <p role="status">일부 가격 확인이 지연되고 있습니다.</p>}
            {comparison.shortened || comparison.endShortened ? (
              <p className="comparison-notice">두 코인 모두 값이 있는 구간을 비교합니다.</p>
            ) : null}
            {comparison.missingCommonDays > 0 && (
              <p className="comparison-notice">값이 없는 구간은 연결하지 않습니다.</p>
            )}
          </section>
          <section className="panel comparison-statistics">
            <div className="panel-title">
              <h2>같은 기간의 수익과 변동</h2>
              <span>확정 일봉 종가 · {market === 'upbit' ? 'KRW' : 'USDT'}</span>
            </div>
            <details
              className="comparison-reading"
              open={helpOpen}
              onToggle={(event) => setHelpOpen(event.currentTarget.open)}
            >
              <summary>수익률·낙폭·변동성, 어떤 차이가 있나요?</summary>
              <div>
                <p>
                  <b>수익률</b>시작에서 끝까지 얼마나 변했는지 봅니다. +20%라면 시작값 100이
                  마지막에 120이 된 것입니다.
                </p>
                <p>
                  <b>최대 낙폭</b>그 사이 얼마나 깊이 하락했는지 봅니다. −40%라면 기간 중 종가 고점
                  100에서 이후 종가 60까지 내려간 적이 있다는 뜻입니다.
                </p>
                <p>
                  <b>연환산 변동성</b>하루하루 가격 변화의 흔들림입니다. 높을수록 일간 움직임이
                  컸으며, 미래 수익률이나 최대 손실 예상치는 아닙니다.
                </p>
              </div>
            </details>
            <div
              className="comparison-table-scroll"
              tabIndex={0}
              aria-label="코인 성과 표. 좁은 화면에서는 가로로 이동할 수 있습니다."
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">코인</th>
                    <th scope="col">
                      <button aria-label="기간 수익률 의미 보기" onClick={() => setHelpOpen(true)}>
                        기간 수익률 ⓘ
                      </button>
                    </th>
                    <th scope="col">
                      <button aria-label="최대 낙폭 의미 보기" onClick={() => setHelpOpen(true)}>
                        최대 낙폭 ⓘ
                      </button>
                    </th>
                    <th scope="col">
                      <button
                        aria-label="연환산 변동성 의미 보기"
                        onClick={() => setHelpOpen(true)}
                      >
                        연환산 변동성 ⓘ
                      </button>
                    </th>
                    <th scope="col">시작 → 마지막 종가</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((row) => (
                    <tr key={row.asset}>
                      <th scope="row">
                        <Link to={`/chart/${row.asset}?market=${market}&period=${period}`}>
                          <i
                            style={{
                              background: ASSETS.find((asset) => asset.id === row.asset)!.color,
                            }}
                          />
                          {row.asset} ↗
                        </Link>
                      </th>
                      <td className={row.returnPct >= 0 ? 'up' : 'down'}>
                        {percentage(row.returnPct, true)}
                      </td>
                      <td className={row.maxDrawdownPct < 0 ? 'down' : ''}>
                        {percentage(row.maxDrawdownPct)}
                      </td>
                      <td
                        title={
                          row.annualVolatilityPct === null
                            ? comparison.missingCommonDays
                              ? '공통 일별 관측에 결측이 있어 계산하지 않음'
                              : '최소 20개의 연속 일간 수익률이 필요함'
                            : '일간 로그수익률의 표본 표준편차 × √365'
                        }
                      >
                        {percentage(row.annualVolatilityPct)}
                      </td>
                      <td>
                        {money(row.startPrice, market === 'upbit' ? 'KRW' : 'USDT')} <span>→</span>{' '}
                        {money(row.endPrice, market === 'upbit' ? 'KRW' : 'USDT')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="comparison-caption">
              변동성은 최소 20개의 연속 일간 수익률이 필요합니다. 최대 낙폭은 이 기간의 종가
              고점에서 이후 종가 저점까지의 하락률이며 장중 낙폭은 포함하지 않습니다.
            </p>
          </section>
        </>
      ) : null}
      {!loading && (state.errors.length > 0 || comparison?.error || parsed.error) && (
        <div className="comparison-refresh">
          <button
            disabled={cooldown}
            onClick={() => {
              if (parsed.error) change({ period });
              forcedKey.current = requestKey;
              setRevision((value) => value + 1);
              setCooldown(true);
            }}
          >
            다시 시도
          </button>
        </div>
      )}
      <MarketNavigation current="compare" market={market} assets={assets} />
      <details className="panel comparison-method">
        <summary>읽는 법</summary>
        <p>
          <b>기준 100:</b> 해당일 종가 ÷ 공통 시작일 종가 × 100. 120은 시작 대비 +20%입니다.{' '}
          <b>기간 수익률:</b> (마지막 종가 ÷ 시작 종가 − 1) × 100.
        </p>
        <p>
          <b>최대 낙폭:</b> min(해당일 종가 ÷ 그날까지의 최고 종가 − 1) × 100. <b>연환산 변동성:</b>{' '}
          일간 로그수익률 ln(Pₜ/Pₜ₋₁)의 표본 표준편차 × √365 × 100. 결측일이 있으면 계산하지
          않습니다. 연환산은 예측 수익률이 아닙니다.
        </p>
      </details>
    </div>
  );
}
