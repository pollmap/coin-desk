import { ASSETS, METRICS } from './catalog';
import { isRangePeriod } from './ranges';
import { validIndicators } from './indicators';
import type { Asset, Interval, Market, Period } from './types';
import { ANALYSIS_VIEWS, analysisView } from './advanced-analysis';
import { validAnnotations, type Annotation } from './annotations';
import { parseUtcDate, type DateWindow } from './date-navigation';
import { validPatterns } from './candle-patterns';
import { indicatorDefinition } from './indicator-catalog';
import { validFavorites } from './personal-favorites';
import { validSupertrendOption } from './supertrend';

export interface ChartSettings {
  asset: Asset;
  market: Market;
  interval: Interval;
  period: Period;
  indicators: string[];
  log: boolean;
}
export interface Workspace extends ChartSettings {
  name: string;
  view: 'dashboard' | 'chart';
  cards: string[];
  priceSource?: 'reference' | 'upbit' | 'binance';
  visual?: string;
  metric?: string;
  panels?: string[];
  section?: 'price' | 'onchain' | 'futures';
  signal?: string;
  comparePrice?: boolean;
  dateWindow?: DateWindow;
  annotations?: Annotation[];
  normalization?: 'index' | 'percent' | 'ratio';
  comparisonWindows?: Record<string, string>;
  analysisOptions?: Record<string, string>;
}
export interface PersonalDesk {
  version: 1 | 2;
  favorites: Asset[];
  cards: string[];
  workspaces: Workspace[];
}
export const DEFAULT_CARDS = ['mvrv', 'realized_price', 'sopr_24h', 'nupl'];
export const DEFAULT_DESK: PersonalDesk = {
  version: 2,
  favorites: ['BTC', 'DOGE', 'ETH'],
  cards: DEFAULT_CARDS,
  workspaces: [],
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export function validCards(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_CARDS];
  return [
    ...new Set(
      value.filter(
        (id): id is string => typeof id === 'string' && METRICS.some((m) => m.id === id),
      ),
    ),
  ].slice(0, 8);
}
export function chartSettings(value: unknown): ChartSettings {
  const v = record(value);
  return {
    asset: ASSETS.some((a) => a.id === v.asset) ? (v.asset as Asset) : 'BTC',
    market: v.market === 'upbit' ? 'upbit' : 'binance',
    interval: ['1h', '4h', '1d', '1w', '1M'].includes(String(v.interval))
      ? (v.interval as Interval)
      : '1d',
    period: isRangePeriod(v.period) ? (v.period as Period) : 'all',
    indicators: Array.isArray(v.indicators) ? validIndicators(v.indicators) : ['sma200', 'sma200w'],
    log: typeof v.log === 'boolean' ? v.log : true,
  };
}
export function normalizeDesk(value: unknown): PersonalDesk {
  const v = record(value);
  if (v.version !== 1 && v.version !== 2) return structuredClone(DEFAULT_DESK);
  const favorites = validFavorites(v.favorites);
  const workspaces: Workspace[] = [];
  for (const raw of Array.isArray(v.workspaces) ? v.workspaces.slice(0, 12) : []) {
    const entry = record(raw);
    if (typeof entry.name !== 'string' || !entry.name.trim()) continue;
    const name = entry.name.trim().slice(0, 40);
    if (workspaces.some((w) => w.name === name)) continue;
    workspaces.push({
      ...chartSettings(entry),
      name,
      view: entry.view === 'chart' ? 'chart' : 'dashboard',
      cards: validCards(entry.cards),
      ...(['price', 'onchain', 'futures'].includes(String(entry.section))
        ? { section: entry.section as Workspace['section'] }
        : {}),
      ...(typeof entry.signal === 'string' &&
      /^[A-Za-z0-9:_.-]{1,400}$/.test(entry.signal) &&
      entry.signal.startsWith(String(entry.asset) + ':')
        ? { signal: entry.signal }
        : {}),
      ...(entry.priceSource === 'reference' ||
      entry.priceSource === 'upbit' ||
      entry.priceSource === 'binance'
        ? { priceSource: entry.priceSource }
        : {}),
      ...(entry.visual ? { visual: analysisView(entry.visual) } : {}),
      ...(typeof entry.metric === 'string' && indicatorDefinition(entry.metric)
        ? { metric: entry.metric }
        : {}),
      ...validExtras(entry),
      ...(typeof entry.comparePrice === 'boolean' ? { comparePrice: entry.comparePrice } : {}),
      ...(Array.isArray(entry.panels)
        ? {
            panels: entry.panels
              .filter((p): p is string => typeof p === 'string' && /^[a-z0-9_:]+$/i.test(p))
              .slice(0, 6),
          }
        : {}),
    });
  }
  return { version: 2, favorites, cards: validCards(v.cards), workspaces };
}
export function importDesk(text: string): PersonalDesk {
  if (new TextEncoder().encode(text).byteLength > 512000)
    throw new Error('설정 파일은 UTF-8 기준 512KB 이하여야 합니다.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('올바른 JSON 설정을 넣어 주세요.');
  }
  const v = record(parsed);
  if (
    ![1, 2].includes(Number(v.version)) ||
    !Array.isArray(v.workspaces) ||
    v.workspaces.length > 12 ||
    !Array.isArray(v.favorites) ||
    !Array.isArray(v.cards)
  ) {
    throw new Error('보리차트 버전 1·2 설정 형식이 아닙니다.');
  }
  for (const item of v.workspaces) {
    const w = record(item);
    if (
      typeof w.name !== 'string' ||
      !w.name.trim() ||
      w.name.length > 40 ||
      !ASSETS.some((a) => a.id === w.asset) ||
      !['binance', 'upbit'].includes(String(w.market)) ||
      !['1h', '4h', '1d', '1w', '1M'].includes(String(w.interval)) ||
      !isRangePeriod(w.period) ||
      !['dashboard', 'chart'].includes(String(w.view)) ||
      typeof w.log !== 'boolean' ||
      !Array.isArray(w.indicators) ||
      JSON.stringify(validIndicators(w.indicators)) !== JSON.stringify(w.indicators) ||
      (w.section !== undefined && !['price', 'onchain', 'futures'].includes(String(w.section))) ||
      (w.priceSource !== undefined &&
        !['reference', 'upbit', 'binance'].includes(String(w.priceSource))) ||
      (w.visual !== undefined &&
        !(ANALYSIS_VIEWS as readonly string[]).includes(String(w.visual))) ||
      (w.comparePrice !== undefined && typeof w.comparePrice !== 'boolean') ||
      (w.metric !== undefined &&
        (typeof w.metric !== 'string' || !indicatorDefinition(w.metric))) ||
      (w.signal !== undefined &&
        (typeof w.signal !== 'string' ||
          !/^[A-Za-z0-9:_.-]{1,400}$/.test(w.signal) ||
          !w.signal.startsWith(String(w.asset) + ':'))) ||
      !Array.isArray(w.cards) ||
      JSON.stringify(validCards(w.cards)) !== JSON.stringify(w.cards)
    ) {
      throw new Error('지원하지 않는 자산·지표·차트 설정이 포함되어 있습니다.');
    }
  }
  const normalized = normalizeDesk(v);
  if (
    normalized.favorites.length !== v.favorites.length ||
    normalized.cards.length !== v.cards.length ||
    normalized.workspaces.length !== v.workspaces.length
  ) {
    throw new Error('중복되거나 지원하지 않는 항목을 확인해 주세요.');
  }
  return normalized;
}
export function workspaceUrl(workspace: Workspace): string {
  const config = chartSettings(workspace);
  const params = new URLSearchParams({
    asset: config.asset,
    market: config.market,
    interval: config.interval,
    period: config.period,
    indicators: config.indicators.join(','),
    log: config.log ? '1' : '0',
    cards: validCards(workspace.cards).join(','),
  });
  if (workspace.priceSource) params.set('price_source', workspace.priceSource);
  if (workspace.visual) params.set('visual', workspace.visual);
  if (workspace.metric) params.set('metric', workspace.metric);
  if (workspace.panels) params.set('panels', workspace.panels.join(','));
  if (workspace.comparePrice) params.set('compare_price', '1');
  if (workspace.signal) params.set('signal', workspace.signal);
  if (workspace.dateWindow) {
    params.set('chart_from', String(workspace.dateWindow.from));
    params.set('chart_to', String(workspace.dateWindow.to));
  }
  if (workspace.normalization) params.set('normalization', workspace.normalization);
  for (const [key, value] of Object.entries(workspace.analysisOptions ?? {}))
    if (validAnalysisOption(key, value)) params.set(key, value);
  for (const [key, value] of Object.entries(workspace.comparisonWindows ?? {}))
    if (parseUtcDate(value) !== null) params.set('window_' + key, value);
  const path =
    workspace.section === 'onchain' || workspace.section === 'futures'
      ? '/' + workspace.section + '/' + config.asset
      : workspace.view === 'chart'
        ? '/chart/' + config.asset
        : '/';
  return path + '?' + params;
}
function validExtras(entry: Record<string, unknown>): Partial<Workspace> {
  const d = record(entry.dateWindow),
    result: Partial<Workspace> = { annotations: validAnnotations(entry.annotations) };
  if (
    Number.isSafeInteger(d.from) &&
    Number.isSafeInteger(d.to) &&
    Number(d.from) > 0 &&
    Number(d.to) > Number(d.from)
  )
    result.dateWindow = { from: Number(d.from), to: Number(d.to) };
  if (['index', 'percent', 'ratio'].includes(String(entry.normalization)))
    result.normalization = entry.normalization as Workspace['normalization'];
  const windows = record(entry.comparisonWindows);
  result.analysisOptions = Object.fromEntries(
    Object.entries(record(entry.analysisOptions)).filter(([k, v]) => validAnalysisOption(k, v)),
  ) as Record<string, string>;
  result.comparisonWindows = Object.fromEntries(
    Object.entries(windows).filter(
      ([k, v]) =>
        ['a_from', 'a_to', 'b_from', 'b_to'].includes(k) &&
        typeof v === 'string' &&
        parseUtcDate(v) !== null,
    ),
  ) as Record<string, string>;
  return result;
}
export function validAnalysisOption(key: string, value: unknown) {
  if (key === 'st_period' || key === 'st_multiplier') return validSupertrendOption(key, value);
  if (key === 'reading_date') return typeof value === 'string' && /^\d{9,10}$/.test(value);
  if (key === 'patterns')
    return (
      typeof value === 'string' &&
      (value === '' || validPatterns(value.split(',')).join(',') === value)
    );
  return (
    typeof value === 'string' &&
    (
      {
        correlation: ['30', '90', '365'],
        correlation_asset: ['DOGE', 'ETH'],
        benchmark_asset: ASSETS.map((a) => a.id),
        seasonality_method: ['log'],
        seasonality_years: ['1'],
        comparison_layout: ['side'],
        pattern_trend: ['none', 'sma50', 'sma50-200'],
      } as Record<string, string[]>
    )[key]?.includes(value)
  );
}
