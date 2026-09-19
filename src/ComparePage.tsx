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
  COMPARISON_PERIOD_DAYS,
  COMPARISON_VERSION,
  type ComparisonResult,
} from '../shared/comparison';
import type { Asset, CandleResponse, Market, Period } from '../shared/types';
import { dateLabel, json, money, numeric, save, saved } from './lib';
import './comparison.css';

const DAY = 86400;
const DEFAULT_ASSETS: Asset[] = ['BTC', 'DOGE', 'ETH'];
const PERIODS: { id: Period; label: string }[] = [
  { id: '1m', label: '1개월' },
  { id: '3m', label: '3개월' },
  { id: '1y', label: '1년' },
  { id: '3y', label: '3년' },
  { id: 'all', label: '전체' },
];
const cache = new Map<string, { value: CandleResponse; at: number }>();
const utcDate = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
const percentage = (value: number | null, signed = false) =>
  value === null ? '—' : (signed && value > 0 ? '+' : '') + numeric(value) + '%';

function selectedAssets(value: unknown): Asset[] {
  const items = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const valid = ASSETS.filter((asset) => items.includes(asset.id)).map((asset) => asset.id);
  return valid.length >= 2 ? valid : DEFAULT_ASSETS;
}

/** Two assets at a time; each paginates sequentially against our stored daily API. */
async function dailyHistory(
  asset: Asset,
  market: Market,
  from: number,
  to: number,
  signal: AbortSignal,
  force: boolean,
) {
  const key = [asset, market, from, to].join(':');
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 15 * 60000) return hit.value;
  let result: CandleResponse | undefined;
  let cursor = from;
  for (let page = 0; page < 20; page++) {
    const response = await json<CandleResponse>(
      `/api/v1/candles?asset=${asset}&market=${market}&interval=1d&from=${cursor}&to=${to}&limit=1000`,
      signal,
    );
    if (
      !Array.isArray(response.data) ||
      response.data.length > 1000 ||
      !response.meta ||
      response.data.some((candle) => !candle || typeof candle !== 'object') ||
      (response.nextCursor !== null && !Number.isFinite(response.nextCursor))
    )
      throw new Error(asset + ' 일봉 응답 형식을 확인할 수 없습니다.');
    if (!result) result = { ...response, data: [...response.data], meta: { ...response.meta } };
    else {
      result.data.push(...response.data);
      result.meta.stale ||= response.meta.stale;
      result.meta.warning ||= response.meta.warning;
      result.meta.gapCount = (result.meta.gapCount || 0) + (response.meta.gapCount || 0);
    }
    if (response.nextCursor === null) {
      result.data = [...new Map(result.data.map((candle) => [candle.time, candle])).values()].sort(
        (a, b) => a.time - b.time,
      );
      result.nextCursor = null;
      if (cache.size >= 80) cache.delete(cache.keys().next().value!);
      if (!signal.aborted) cache.set(key, { value: result, at: Date.now() });
      return result;
    }
    if (
      !Number.isFinite(response.nextCursor) ||
      response.nextCursor <= cursor ||
      response.nextCursor >= to
    )
      throw new Error(asset + ' 데이터 페이지 경계를 확인할 수 없습니다.');
    cursor = response.nextCursor;
  }
  throw new Error(asset + ' 비교 데이터가 조회 한도를 초과했습니다.');
}

function ComparisonChart({ comparison }: { comparison: ComparisonResult }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<number | null>(null);
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
      timeScale: { borderColor: '#293345', lockVisibleTimeRangeOnResize: true },
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
    api.timeScale().fitContent();
    return () => {
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
          const value = row.points.find((point) => point.time === visibleTime)?.value;
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
  const rawPeriod = params.get('period') ?? initial.period;
  const period: Period = PERIODS.some((entry) => entry.id === rawPeriod)
    ? (rawPeriod as Period)
    : '1y';
  const assetKey = assets.join(',');
  const requestKey = [assetKey, market, period].join(':');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    data: Partial<Record<Asset, CandleResponse>>;
    errors: string[];
  }>({ key: '', loading: true, data: {}, errors: [] });
  const [shareUrl, setShareUrl] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [lastRefresh, setLastRefresh] = useState(0);
  const [cooldown, setCooldown] = useState(false);
  const forcedKey = useRef<string | null>(null);
  useEffect(() => {
    save('comparison', { assets: assetKey.split(','), market, period });
  }, [assetKey, market, period]);
  useEffect(() => {
    const controller = new AbortController();
    const to = Math.floor(Date.now() / 1000 / DAY) * DAY;
    const from = period === 'all' ? 0 : to - (COMPARISON_PERIOD_DAYS[period] + 7) * DAY;
    const selected = assetKey.split(',') as Asset[];
    setState({ key: requestKey, loading: true, data: {}, errors: [] });
    const timer = setTimeout(() => {
      const force = forcedKey.current === requestKey;
      forcedKey.current = null;
      let next = 0;
      const run = async () => {
        while (next < selected.length && !controller.signal.aborted) {
          const asset = selected[next++];
          try {
            const data = await dailyHistory(asset, market, from, to, controller.signal, force);
            if (!controller.signal.aborted)
              setState((previous) => ({ ...previous, data: { ...previous.data, [asset]: data } }));
          } catch (error) {
            if (!controller.signal.aborted)
              setState((previous) => ({
                ...previous,
                errors: [
                  ...previous.errors,
                  asset + ': ' + (error instanceof Error ? error.message : '조회 실패'),
                ],
              }));
          }
        }
      };
      void Promise.all([run(), run()]).then(() => {
        if (!controller.signal.aborted) {
          setState((previous) => ({ ...previous, loading: false }));
          setLastRefresh(Date.now());
        }
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [assetKey, market, period, revision, requestKey]);
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
    if (!active || state.loading || state.errors.length) return null;
    return compareCloses(
      (assetKey.split(',') as Asset[]).map((asset) => ({
        asset,
        candles: state.data[asset]?.data || [],
      })),
      period,
    );
  }, [active, state, assetKey, period]);
  function change(next: Partial<{ assets: Asset[]; market: Market; period: Period }>) {
    setShareUrl('');
    setShareNote('');
    setParams(
      {
        assets: (next.assets ?? assets).join(','),
        market: next.market ?? market,
        period: next.period ?? period,
      },
      { replace: true },
    );
  }
  async function share() {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ assets: assetKey, market, period }).toString();
    setShareUrl(url.href);
    try {
      await navigator.clipboard.writeText(url.href);
      setShareNote('같은 코인·시장·기간의 링크를 복사했습니다.');
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
  const shortened = comparison?.shortened;
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
            {PERIODS.map((entry) => (
              <button
                key={entry.id}
                aria-pressed={period === entry.id}
                className={period === entry.id ? 'selected' : ''}
                onClick={() => change({ period: entry.id })}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button className="comparison-share" onClick={() => void share()}>
            비교 링크 복사
          </button>
        </div>
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
          확정 일봉을 불러오고 있습니다… {active ? Object.keys(state.data).length : 0}/
          {assets.length} 코인
        </div>
      ) : null}
      {!loading && state.errors.length ? (
        <div className="error-notice" role="alert">
          <div>
            {state.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
            <p>선택한 코인이 모두 준비되면 비교를 표시합니다.</p>
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
            {shortened ? (
              <div className="comparison-notice amber">
                선택한 기간 전체를 함께 비교할 수 없어 {utcDate(comparison.start!)}부터 표시합니다.
                거래소 상장일·보유 이력의 차이를 반영한 실제 공통 기간입니다.
              </div>
            ) : null}
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
            <div
              className="comparison-table-scroll"
              tabIndex={0}
              aria-label="코인 성과 표. 좁은 화면에서는 가로로 이동할 수 있습니다."
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">코인</th>
                    <th scope="col">기간 수익률</th>
                    <th scope="col">최대 낙폭</th>
                    <th scope="col">연환산 변동성</th>
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
          disabled={loading || cooldown}
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
          <b>공통 날짜:</b> 모든 선택 코인의 값이 있는 UTC 확정 일봉을 사용합니다.
          1개월·3개월·1년·3년은 공통 최신일로부터 30·90·365·1,095일이며, 전체는 거래소에서 제공되는
          공통 이력입니다. 상장일 이전 가격은 만들지 않습니다.
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
