import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bookmark, SlidersHorizontal } from 'lucide-react';
import { ASSETS } from '../shared/catalog';
import { indicatorDefinition, indicatorUrl } from '../shared/indicator-catalog';
import {
  COMPARISON_METRICS,
  comparisonSelection,
  type IndicatorComparison,
} from '../shared/indicator-comparison';
import { PERIOD_OPTIONS, isRangePeriod } from '../shared/ranges';
import { guideHref } from '../shared/learning-catalog';
import type { Asset } from '../shared/types';
import type { DateWindow } from '../shared/date-navigation';
import { AnalysisChart, type AnalysisLine } from './AnalysisChart';
import { ComparisonModes } from './ComparisonModes';
import { DeskDialog } from './DeskDialog';
import { WorkspaceBar } from './PersonalDesk';
import { json, numeric } from './lib';
import './comparison.css';

const colors = ['#b56e13', '#3868ad', '#9b4f97'];
const noSignals: never[] = [];
export function IndicatorComparisonPage() {
  const [params, setParams] = useSearchParams();
  const metric = params.get('metric') ?? 'net:mvrv';
  const definition = indicatorDefinition(metric);
  const assets = params.get('assets') ?? 'BTC,ETH';
  const source =
    params.get('source') ??
    (definition?.comparison?.source === 'price'
      ? (params.get('market') ?? 'binance')
      : (definition?.comparison?.source ?? 'coinmetrics'));
  const period = params.get('period') ?? definition?.defaultPeriod ?? '5y';
  const query = new URLSearchParams({ assets, metric, source, period });
  for (const key of ['from', 'to']) if (params.has(key)) query.set(key, params.get(key)!);
  const requestKey = query.toString();
  const [response, setResponse] = useState<{
    key: string;
    data?: IndicatorComparison;
    error?: string;
    loading: boolean;
  }>({ key: '', loading: true });
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState(false),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState('');
  const [draftMetric, setDraftMetric] = useState(metric);
  const settingsButton = useRef<HTMLButtonElement>(null),
    saveButton = useRef<HTMLButtonElement>(null);
  const visible = useRef<DateWindow | null>(null),
    pinned = useRef<number | null>(null);
  const initialDate = /^\d{9,10}$/.test(params.get('reading_date') ?? '')
    ? Number(params.get('reading_date'))
    : undefined;
  const window = useMemo(() => {
    const from = Number(params.get('chart_from')),
      to = Number(params.get('chart_to'));
    return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from > 0 && to > from
      ? { from, to }
      : null;
  }, [params.get('chart_from'), params.get('chart_to')]);
  const onReading = useCallback((time: number | null, fixed = false) => {
    pinned.current = fixed ? time : null;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    pinned.current = null;
    visible.current = null;
    setResponse({ key: requestKey, loading: true });
    try {
      comparisonSelection(new URLSearchParams(requestKey));
    } catch (e) {
      setResponse({ key: requestKey, loading: false, error: (e as Error).message });
      return () => controller.abort();
    }
    const load = async () => {
      // Skip a superseded mount before opening its network request. In development
      // StrictMode mounts twice; immediate abort/reopen needlessly duplicates reads.
      await Promise.resolve();
      if (!active) return;
      try {
        const data = await json<IndicatorComparison>(
          '/api/v1/indicator-comparison?' + requestKey,
          controller.signal,
        );
        if (active) setResponse({ key: requestKey, data, loading: false });
      } catch (e) {
        if (active)
          setResponse((old) => ({
            ...old,
            key: requestKey,
            error: (e as Error).message,
            loading: false,
          }));
      }
    };
    void load();
    const timer = globalThis.setInterval(() => void load(), 60000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [requestKey, revision]);
  const current: typeof response =
    response.key === requestKey ? response : { key: requestKey, loading: true };
  const result = current.data;
  const chartRows = useMemo(() => result?.rows.filter((r) => r.data.length) ?? [], [result]);
  const primary = useMemo(
    () =>
      chartRows[0]
        ? ({
            id: metric,
            title: `${chartRows[0].asset} · ${definition?.title}`,
            unit: result!.unit,
            source: source,
            data: chartRows[0].data,
            color: colors[0],
            thresholds: definition?.thresholds,
          } as AnalysisLine)
        : undefined,
    [chartRows, metric, definition, result, source],
  );
  const lines = useMemo(
    () =>
      chartRows.slice(1).map((r, i) => ({
        id: r.asset,
        title: r.asset,
        unit: result!.unit,
        source,
        data: r.data,
        color: colors[i + 1],
        overlay: result!.mode === 'shared-axis',
        step: metric === 'futures:funding' ? 3600 : 86400,
        warning: r.state === 'delayed' ? '갱신 지연' : undefined,
      })),
    [chartRows, result, source, metric],
  );
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    next.set('mode', 'indicator');
    for (const key of ['reading_date', 'chart_from', 'chart_to']) next.delete(key);
    for (const [key, value] of Object.entries(patch))
      value === null ? next.delete(key) : next.set(key, value);
    setParams(next);
    setNotice('');
  };
  const saveAsset = ASSETS.find((a) => a.id === assets.split(',')[0])?.id ?? 'BTC';
  return (
    <section
      aria-label="지표 비교"
      className="indicator-comparison"
      data-comparison-metric={metric}
    >
      <header className="indicator-comparison-heading">
        <h1>코인 비교</h1>
        <ComparisonModes mode="indicator" />
      </header>
      <div className="indicator-comparison-toolbar">
        <button
          ref={settingsButton}
          onClick={() => {
            setDraftMetric(metric);
            setSettings(true);
          }}
          aria-label="비교 설정 변경"
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          {assets.replaceAll(',', ' · ')} · {definition?.title ?? metric}
        </button>
        <select
          aria-label="비교 기간"
          value={period}
          onChange={(e) => update({ period: e.target.value, from: null, to: null })}
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button aria-label="비교 분석 저장" ref={saveButton} onClick={() => setSaving(true)}>
          <Bookmark size={18} aria-hidden="true" />
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {current.loading ? (
        <p role="status">지표를 불러오는 중…</p>
      ) : current.error && !result ? (
        <div role="alert">
          <p>비교 차트를 불러오지 못했습니다.</p>
          <button onClick={() => setRevision((r) => r + 1)}>다시 시도</button>
        </div>
      ) : null}
      {primary && (
        <AnalysisChart
          asset={chartRows[0].asset}
          unit={result!.unit}
          source={source}
          points={primary.data}
          lines={lines}
          primary={primary}
          readingLabel={chartRows[0].asset}
          period="all"
          log={false}
          signals={noSignals}
          onSignal={() => {}}
          onAll={() => update({ period: 'all', from: null, to: null })}
          step={metric === 'futures:funding' ? 3600 : 86400}
          publicFocus
          advancedTools={false}
          initialWindow={window}
          initialReadingDate={initialDate}
          onReadingDate={onReading}
          onVisibleRange={(range) => {
            visible.current = range;
          }}
        />
      )}
      {result && (
        <>
          <div className="indicator-comparison-results" role="region" aria-label="코인별 지표값">
            <table>
              <thead>
                <tr>
                  <th>코인</th>
                  <th>지표값</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const point = r.data.at(-1);
                  return (
                    <tr key={r.asset}>
                      <td>
                        <Link
                          to={indicatorUrl(
                            r.asset,
                            metric,
                            new URLSearchParams({
                              period,
                              price_source: ['upbit', 'binance', 'reference'].includes(source)
                                ? source
                                : 'reference',
                            }),
                          )}
                        >
                          {r.asset}
                        </Link>
                      </td>
                      <td>
                        {point
                          ? numeric(point.value, metric === 'futures:funding' ? 5 : 2) +
                            ' ' +
                            result.unit
                          : r.state === 'unsupported'
                            ? '미지원'
                            : r.state === 'error'
                              ? '연결 실패'
                              : '—'}
                        {point && r.state === 'delayed' && <small>값 확인 지연</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {current.error && <p role="status">일부 값을 확인하지 못했습니다.</p>}
          <details className="indicator-comparison-info">
            <summary>읽는 법</summary>
            {result.mode === 'separate-panels' && <p>계산 방식이 달라 따로 표시합니다.</p>}
            <p>{definition?.formula}</p>
            <Link
              to={guideHref(
                definition?.guide,
                new URLSearchParams({
                  asset: saveAsset,
                  period,
                  price_source: ['upbit', 'binance', 'reference'].includes(source)
                    ? source
                    : 'reference',
                }),
              )}
            >
              지표 설명
            </Link>
          </details>
        </>
      )}
      <DeskDialog
        open={settings}
        onOpenChange={setSettings}
        title="비교 설정"
        returnFocus={settingsButton}
        sheet
      >
        <form
          key={requestKey}
          className="indicator-comparison-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const ids = ['asset1', 'asset2', 'asset3']
              .map((k) => String(form.get(k) ?? ''))
              .filter(Boolean);
            const selectedMetric = String(form.get('metric'));
            const def = indicatorDefinition(selectedMetric)!;
            const patch = {
              assets: ids.join(','),
              metric: selectedMetric,
              source:
                def.comparison!.source === 'price'
                  ? String(
                      form.get('source') ??
                        (['upbit', 'binance', 'reference'].includes(source) ? source : 'binance'),
                    )
                  : def.comparison!.source,
              period: selectedMetric === metric ? period : def.defaultPeriod,
              from: null,
              to: null,
            };
            try {
              comparisonSelection(
                new URLSearchParams(
                  Object.entries(patch).filter(([, v]) => v !== null) as [string, string][],
                ),
              );
              update(patch);
              setSettings(false);
            } catch {
              setNotice('코인과 지표 선택을 확인해 주세요.');
            }
          }}
        >
          {[1, 2, 3].map((n) => (
            <label key={n}>
              코인 {n}
              {n === 3 ? ' · 선택' : ''}
              <select
                name={'asset' + n}
                defaultValue={assets.split(',')[n - 1] ?? ''}
                required={n < 3}
              >
                {n === 3 && <option value="">추가하지 않음</option>}
                {ASSETS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.id}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            지표
            <select
              name="metric"
              aria-label="지표"
              defaultValue={metric}
              onChange={(event) => setDraftMetric(event.target.value)}
            >
              {COMPARISON_METRICS.map((id) => (
                <option key={id} value={id}>
                  {indicatorDefinition(id)!.title}
                </option>
              ))}
            </select>
          </label>
          {indicatorDefinition(draftMetric)?.comparison?.source === 'price' && (
            <label>
              거래소·통화
              <select
                name="source"
                aria-label="비교 거래소·통화"
                defaultValue={
                  ['binance', 'upbit', 'reference'].includes(source) ? source : 'binance'
                }
              >
                <option value="binance">Binance USDT</option>
                <option value="upbit">Upbit KRW</option>
                <option value="reference">USD 참조</option>
              </select>
            </label>
          )}
          {notice && <p role="alert">{notice}</p>}
          <button type="submit">적용</button>
        </form>
      </DeskDialog>
      <DeskDialog open={saving} onOpenChange={setSaving} title="분석 저장" returnFocus={saveButton}>
        <WorkspaceBar
          embedded
          onOpenWorkspace={() => setSaving(false)}
          current={{
            asset: saveAsset as Asset,
            market: source === 'upbit' ? 'upbit' : 'binance',
            interval: '1d',
            period: isRangePeriod(period) ? period : '5y',
            indicators: [],
            log: false,
            view: 'dashboard',
            cards: [],
            metric,
            analysisOptions: {
              comparison_mode: 'indicator',
              comparison_assets: assets,
              comparison_source: source,
              ...(params.has('from') ? { comparison_from: params.get('from')! } : {}),
              ...(params.has('to') ? { comparison_to: params.get('to')! } : {}),
            },
          }}
          resolveCurrent={(c) => ({
            ...c,
            dateWindow: visible.current ?? undefined,
            analysisOptions: {
              ...c.analysisOptions,
              ...(initialDate !== undefined
                ? { reading_date: String(initialDate) }
                : pinned.current === null ? {} : { reading_date: String(pinned.current) }),
            },
          })}
        />
      </DeskDialog>
    </section>
  );
}
