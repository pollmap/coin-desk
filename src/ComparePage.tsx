import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ASSETS } from '../shared/catalog';
import {
  compareCloses,
  parseComparisonRange,
  COMPARISON_VERSION,
  type ComparisonResult,
} from '../shared/comparison';
import type { Asset, CandleResponse, Market } from '../shared/types';
import { PERIOD_OPTIONS, isRangePeriod, periodStart, type RangePeriod } from '../shared/ranges';
import { createComparisonLoader } from './comparison-data';
import { dateLabel, json, money, numeric, save, saved } from './lib';
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

function ComparisonChart({ comparison }: { comparison: ComparisonResult }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
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
    if (!container.current || !comparison.rows.length) return;
    const api = createChart(container.current, {
      autoSize: true,
      height: 390,
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
    setHover(null);
    comparison.rows.forEach((row, index) => {
      const line = api.addSeries(LineSeries, {
        color: ASSETS.find((asset) => asset.id === row.asset)!.color,
        lineWidth: 2,
        title: row.asset,
        lastValueVisible: false,
        priceLineVisible: false,
      });
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
      if (index === 0)
        line.createPriceLine({
          price: 100,
          color: '#6a7688',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '시작 100',
        });
    });
    api.subscribeCrosshairMove((event) =>
      setHover(typeof event.time === 'number' ? event.time : null),
    );
    const node = container.current;
    node.dataset.points = String(comparison.observations);
    node.dataset.expectedFrom = String(comparison.start);
    node.dataset.expectedTo = String(comparison.end);
    const publishRange = () => {
      const visible = api.timeScale().getVisibleRange();
      const logical = api.timeScale().getVisibleLogicalRange();
      node.dataset.visibleFrom = String(visible?.from ?? '');
      node.dataset.visibleTo = String(visible?.to ?? '');
      node.dataset.logicalFrom = String(logical?.from ?? '');
      node.dataset.logicalTo = String(logical?.to ?? '');
    };
    api.timeScale().subscribeVisibleLogicalRangeChange(publishRange);
    api.timeScale().fitContent();
    const frame = requestAnimationFrame(publishRange);
    return () => {
      cancelAnimationFrame(frame);
      api.timeScale().unsubscribeVisibleLogicalRangeChange(publishRange);
      chart.current = null;
      api.remove();
    };
  }, [comparison]);
  const visibleTime = hover ?? comparison.end;
  return (
    <>
      <div className="comparison-chart-toolbar">
        <span>관측일 {visibleTime !== null ? utcDate(visibleTime) + ' UTC' : ''} · 시작값 100</span>
        <button onClick={() => chart.current?.timeScale().fitContent()}>차트 범위 초기화</button>
      </div>
      <div className="comparison-readout" aria-live="off">
        {comparison.rows.map((row) => {
          const value = values.get(row.asset)?.get(visibleTime ?? 0);
          return (
            <span key={row.asset}>
              <i style={{ background: ASSETS.find((asset) => asset.id === row.asset)!.color }} />
              <b>{row.asset}</b> {value === undefined ? '관측 없음' : numeric(value)}
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
      <div
        className="comparison-chart"
        ref={container}
        role="img"
        aria-label="같은 날짜를 100으로 맞춘 코인 성과 비교 차트. 정확한 수치는 아래 표에서 확인할 수 있습니다."
      />
      <p className="comparison-caption">
        확대·이동해도 기준일과 아래 표의 분석 기간은 고정됩니다. 차트의 십자선으로 같은 날짜를
        비교하세요.
      </p>
    </>
  );
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const initial = useMemo(() => saved<Record<string, unknown>>('comparison', {}), []);
  const assets = selectedAssets(params.get('assets') ?? initial.assets);
  const market: Market = (params.get('market') ?? initial.market) === 'upbit' ? 'upbit' : 'binance';
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
  const [shareUrl, setShareUrl] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [lastRefresh, setLastRefresh] = useState(0);
  const [cooldown, setCooldown] = useState(false);
  const [draftError, setDraftError] = useState('');
  const dateForm = useRef<HTMLFormElement>(null);
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
    setDraftError('');
  }, [fromValue, toValue, period]);
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
          setLastRefresh(Date.now());
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
    setShareUrl('');
    setShareNote('');
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
  async function share() {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({
      assets: assetKey,
      market,
      period,
      ...(fromValue !== null ? { from: fromValue } : {}),
      ...(toValue !== null ? { to: toValue } : {}),
    }).toString();
    setShareUrl(url.href);
    try {
      await navigator.clipboard.writeText(url.href);
      setShareNote('코인·시장·기간과 직접 선택한 날짜를 링크에 담았습니다.');
    } catch {
      setShareNote('아래 주소를 선택해 복사해 주세요.');
    }
  }
  function download() {
    if (!comparison?.rows.length) return;
    const rows = [
      'date_utc,asset,market,close,index_100,return_from_start_pct,calculation_version',
    ];
    for (const row of comparison.rows) {
      const closes = new Map(
        state.data[row.asset]!.data.map((candle) => [candle.time, candle.close]),
      );
      for (const point of row.points)
        rows.push(
          [
            utcDate(point.time),
            row.asset,
            market,
            closes.get(point.time),
            point.value,
            point.value - 100,
            COMPARISON_VERSION,
          ].join(','),
        );
    }
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `coin-desk-comparison-${market}-${utcDate(comparison.end!)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const responses = active ? Object.values(state.data) : [];
  const hasStale = responses.some((response) => response.meta.stale);
  return (
    <div className="comparison-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMPARE COINS</div>
          <h1>코인 성과 비교</h1>
          <p>
            같은 날 출발했다면 어떻게 달라졌을까요? 가격 변화와 하락 폭을 한 화면에서 비교합니다.
          </p>
        </div>
      </div>
      <section className="panel comparison-controls" aria-label="비교 설정">
        <div className="comparison-control-heading">
          <h2>
            비교할 코인 <small>{assets.length}/8</small>
          </h2>
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
              <i style={{ background: asset.color }} />
              <b>{asset.id}</b>
              <span>{asset.name}</span>
            </button>
          ))}
        </div>
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
          <div className="segments" aria-label="비교 기간">
            {PERIOD_OPTIONS.map((entry) => (
              <button
                key={entry.id}
                aria-pressed={!hasCustom && period === entry.id}
                className={!hasCustom && period === entry.id ? 'selected' : ''}
                onClick={() => {
                  dateForm.current?.reset();
                  setDraftError('');
                  change({ period: entry.id });
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button
            className="comparison-share"
            disabled={!!parsed.error}
            onClick={() => void share()}
          >
            비교 링크 복사
          </button>
        </div>
        <form
          key={[period, fromValue ?? '', toValue ?? ''].join(':')}
          ref={dateForm}
          className="comparison-date-range"
          onSubmit={(event) => {
            event.preventDefault();
            const checked = comparisonDateSubmission(new FormData(event.currentTarget));
            if (checked.error !== undefined) {
              setDraftError(checked.error);
              return;
            }
            setDraftError('');
            change({ from: checked.from, to: checked.to });
          }}
        >
          <label>
            시작일 (UTC)
            <input
              type="date"
              name="from"
              defaultValue={fromValue || ''}
              max={utcDate(Math.floor(Date.now() / 1000 / DAY) * DAY)}
              onChange={() => setDraftError('')}
              required
            />
          </label>
          <label>
            종료일 (UTC)
            <input
              type="date"
              name="to"
              defaultValue={toValue || ''}
              max={utcDate(Math.floor(Date.now() / 1000 / DAY) * DAY)}
              onChange={() => setDraftError('')}
              required
            />
          </label>
          <button type="submit" className={hasCustom ? 'selected' : ''}>
            직접 기간 적용
          </button>
          {hasCustom ? (
            <button type="button" onClick={() => change({ period })}>
              직접 기간 해제
            </button>
          ) : (
            <span>날짜를 지정하면 위 프리셋 대신 적용합니다.</span>
          )}
        </form>
        {draftError || parsed.error ? (
          <p className="comparison-date-error" role="alert">
            {draftError || parsed.error}
            {parsed.error ? (
              <button onClick={() => change({ period })}>기본 기간으로 복원</button>
            ) : null}
          </p>
        ) : null}
        {shareUrl ? (
          <div className="comparison-share-result">
            <span role="status">{shareNote}</span>
            <input
              aria-label="비교 화면 공유 주소"
              value={shareUrl}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </div>
        ) : null}
      </section>
      {loading ? (
        <div className="comparison-notice" role="status">
          확정 일봉을 불러오고 있습니다… {active ? state.loaded : 0}/{assets.length} 코인
          {comparison?.rows.length ? ' · 마지막으로 완료된 비교를 유지합니다.' : ''}
        </div>
      ) : null}
      {!loading && state.errors.length ? (
        <div className="error-notice" role="alert">
          <div>
            {state.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
            <p>
              {comparison?.rows.length
                ? '갱신에 실패해 마지막으로 완료된 비교를 유지합니다.'
                : '선택한 코인이 모두 준비되면 비교를 표시합니다.'}
            </p>
          </div>
        </div>
      ) : null}
      {comparison?.error ? (
        <div className="comparison-notice amber" role="status">
          {comparison.error}
        </div>
      ) : null}
      {!loading && hasStale ? (
        <div className="comparison-notice amber" role="status">
          갱신이 지연된 원천이 있습니다. 마지막 정상 수집 일봉으로 비교하며 아래 원천별 수집 시각을
          확인해 주세요.
        </div>
      ) : null}
      {comparison ? (
        <section className="comparison-coverage" aria-label="요청 기간과 실제 비교 범위">
          <div>
            <span>요청한 기간</span>
            <strong>
              {comparison.requestedStart !== null
                ? utcDate(comparison.requestedStart)
                : '거래소 공통 이력 시작'}{' '}
              →{' '}
              {comparison.requestedEnd !== null
                ? utcDate(comparison.requestedEnd)
                : '확정 일봉 마지막 날'}
            </strong>
          </div>
          <div>
            <span>실제로 비교하는 기간</span>
            <strong>
              {comparison.start !== null && comparison.end !== null
                ? `${utcDate(comparison.start)} → ${utcDate(comparison.end)} UTC`
                : '겹치는 확정 이력 부족'}
            </strong>
          </div>
          {period === 'all' && !parsed.range && comparison.rows.length > 0 ? (
            <p>
              전체 비교는 선택한 모든 코인에 값이 있는 구간입니다.{' '}
              {comparison.coverage.some((source) => source.first === comparison.start)
                ? `${comparison.coverage
                    .filter((source) => source.first === comparison.start)
                    .map((source) => source.asset)
                    .join(
                      '·',
                    )} 수집 이력이 ${utcDate(comparison.start!)}부터여서 이 날짜에서 함께 출발합니다.`
                : `확정 종가가 처음 겹치는 ${utcDate(comparison.start!)}에서 함께 출발합니다.`}{' '}
              코인 선택에 따라 비교 시작일이 달라집니다.
            </p>
          ) : null}
          {comparison.shortened ? (
            <p className="amber">
              {comparison.coverage
                .filter(
                  (source) =>
                    source.first !== null && source.first > (comparison.requestedStart ?? 0),
                )
                .map((source) => `${source.asset} 수집 이력은 ${utcDate(source.first!)}부터`)
                .join(' · ') || '시작일에 모든 코인의 관측이 함께 존재하지 않습니다.'}
              . 공통 관측이 시작되는 날을 100으로 맞췄습니다.
            </p>
          ) : null}
          {comparison.endShortened ? (
            <p className="amber">
              요청한 종료일까지 확정 일봉이 모두 갖춰지지 않아 {utcDate(comparison.end!)}에서
              마칩니다. 오늘 진행 중인 봉과 아직 확보하지 못한 날짜를 채워 넣지 않습니다.
            </p>
          ) : null}
          <details>
            <summary>코인별 수집 이력 보기</summary>
            <ul>
              {comparison.coverage.map((source) => (
                <li key={source.asset}>
                  <b>{source.asset}</b> 수집 시작{' '}
                  {source.first === null ? '미확인' : utcDate(source.first)} · 이 조회의 마지막
                  확정일 {source.last === null ? '없음' : utcDate(source.last)}
                </li>
              ))}
            </ul>
            <p>
              거래소 제공·수집 이력이며 코인의 탄생일부터 확보한 가격이 아닙니다. Binance BTC 일봉은
              2017년 8월부터입니다.
            </p>
          </details>
        </section>
      ) : null}
      {comparison?.rows.length ? (
        <>
          <section className="panel comparison-result">
            <div className="panel-title">
              <div>
                <h2>상대 성과 · 시작점 100</h2>
                <p>
                  {utcDate(comparison.start!)} → {utcDate(comparison.end!)} UTC · 공통 관측{' '}
                  {comparison.observations.toLocaleString()}일
                </p>
              </div>
              <button onClick={download}>CSV 내려받기</button>
            </div>
            {comparison.missingCommonDays > 0 ? (
              <div className="comparison-notice amber">
                공통 기간 중 {comparison.missingCommonDays}일은 한 개 이상의 코인에 관측값이
                없습니다. 해당 날짜는 보간하지 않으며, 변동성은 계산하지 않습니다. 최대 낙폭은
                관측된 공통 종가 기준입니다.
              </div>
            ) : null}
            {comparison.rows.some((row) => row.latestAvailable > comparison.end!) ? (
              <div className="comparison-notice">
                코인별 최신 일봉 시점이 달라, 모든 코인에 값이 있는 {utcDate(comparison.end!)}에서
                비교를 마칩니다.
              </div>
            ) : null}
            <ComparisonChart comparison={comparison} />
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
      <div className="comparison-refresh">
        <span>
          화면 조회 {lastRefresh ? dateLabel(lastRefresh / 1000, true) : '대기'} · 확정 일봉 ·
          수수료·세금·스테이킹 보상 제외
        </span>
        <button
          disabled={loading || cooldown || !!parsed.error}
          onClick={() => {
            forcedKey.current = requestKey;
            setRevision((value) => value + 1);
            setCooldown(true);
          }}
        >
          {cooldown ? '잠시 후 갱신 가능' : '데이터 다시 확인'}
        </button>
      </div>
      <details className="panel comparison-method">
        <summary>비교 산식 · 데이터 원천 · 읽는 방법</summary>
        <p>
          <b>공통 날짜:</b> 모든 선택 코인의 값이 있는 UTC 확정 일봉을 사용합니다. 1·3·6개월과
          1·3·5년은 공통 최신 확정일에서 UTC 달력으로 역산하며 월말은 해당 월의 마지막 날로
          맞춥니다. 올해는 해당 연도 1월 1일부터, 전체는 거래소의 공통 수집 이력입니다. 직접 지정한
          시작·종료일은 UTC 날짜이며 두 날짜 모두 포함합니다. 상장일 이전 가격은 만들지 않습니다.
        </p>
        <p>
          <b>기준 100:</b> 해당일 종가 ÷ 공통 시작일 종가 × 100. 120은 시작 대비 +20%입니다.{' '}
          <b>기간 수익률:</b> (마지막 종가 ÷ 시작 종가 − 1) × 100.
        </p>
        <p>
          <b>최대 낙폭:</b> min(해당일 종가 ÷ 그날까지의 최고 종가 − 1) × 100. <b>연환산 변동성:</b>{' '}
          일간 로그수익률 ln(Pₜ/Pₜ₋₁)의 표본 표준편차 × √365 × 100. 결측일이 있으면 계산하지
          않습니다. 연환산은 예측 수익률이 아닙니다.
        </p>
        <p>
          <b>원천:</b>{' '}
          {market === 'binance' ? (
            <a
              href="https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints"
              target="_blank"
              rel="noreferrer"
            >
              Binance BTC 등 USDT 거래쌍
            </a>
          ) : (
            <a
              href="https://docs.upbit.com/kr/reference/list-candles-days"
              target="_blank"
              rel="noreferrer"
            >
              Upbit BTC 등 KRW 거래쌍
            </a>
          )}
          . 다른 거래소의 가격이나 환율로 대체하지 않습니다. {COMPARISON_VERSION}
        </p>
        {responses.length ? (
          <ul>
            {assets.map((asset) => {
              const response = state.data[asset];
              return response ? (
                <li key={asset}>
                  {asset} · 수집 {dateLabel(response.meta.fetchedAt, true)}
                  {response.meta.stale ? ' · 갱신 지연' : ''}
                  {response.meta.warning ? ' · ' + response.meta.warning : ''}
                </li>
              ) : null;
            })}
          </ul>
        ) : null}
        {comparison?.rows.some((row) => row.ignoredRows > 0) ? (
          <p>
            계산에서 제외한 미확정·형식 오류·중복 행:{' '}
            {comparison.rows
              .filter((row) => row.ignoredRows > 0)
              .map((row) => `${row.asset} ${row.ignoredRows}개`)
              .join(' · ')}
            . 값을 보간하지 않았습니다.
          </p>
        ) : null}
        <p>
          같은 기간이라도 코인을 추가하면 상장일과 관측 일자에 따라 공통 분석 기간이 바뀔 수
          있습니다. 분석 기간은 차트와 표 위에 표시합니다. 공유 링크는 코인·거래소·기간을 담으며,
          방문 시 확보된 최신 확정 일봉으로 다시 계산됩니다.
        </p>
      </details>
    </div>
  );
}
