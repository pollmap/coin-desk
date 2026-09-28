import type { AnalysisView } from './advanced-analysis';
import { validIndicators } from './indicators';
import { networkMetrics } from './network-catalog';
import { METRICS } from './catalog';
import type { Interval } from './types';
export type CoreAsset = 'BTC' | 'DOGE' | 'ETH';
export interface AnalysisRecipe {
  asset: CoreAsset;
  view: AnalysisView;
  source: 'reference' | 'upbit' | 'binance';
  interval?: Interval;
  from?: number;
  to?: number;
  indicators?: string[];
  verified: boolean;
  section?: 'price' | 'onchain' | 'futures';
  metric?: string;
}
export function recipeMetrics(asset: CoreAsset, section: AnalysisRecipe['section']) {
  if (section === 'futures')
    return [
      { id: 'futures:funding', title: '펀딩률 · Bybit' },
      { id: 'futures:open_interest_daily', title: '미결제약정 · Bybit' },
      { id: 'futures:long_account_ratio_daily', title: '롱 계정 비중 · Bybit' },
    ];
  if (section === 'onchain')
    return [
      ...networkMetrics(asset).map((m) => ({
        id: 'net:' + m.id,
        title: m.title + ' · Coin Metrics',
      })),
      ...(asset === 'BTC'
        ? METRICS.map((m) => ({ id: 'btc:' + m.id, title: m.title + ' · Bitview' }))
        : []),
    ];
  return [];
}
export interface ResearchMedia {
  key: string;
  url?: string;
  file?: string;
  mime?: string;
}
export interface ResearchItem {
  id: string;
  postId?: string;
  author: string;
  publishedAt: string;
  importedAt: string;
  url: string;
  text: string;
  media: ResearchMedia[];
  assets: CoreAsset[];
  methods: string[];
  origins: string[];
  review: { text: boolean; images: boolean; method: boolean };
  recipe?: AnalysisRecipe;
  revisions: { at: string; text: string; media: ResearchMedia[] }[];
  note?: string;
  captureNote?: string;
}
export interface ImportCheckpoint {
  source: string;
  lastId?: string;
  url?: string;
  offset: number;
  status: 'running' | 'paused' | 'complete' | 'access-limited' | 'failed';
  reason?: string;
}
export interface ImportBatch {
  id: string;
  startedAt: string;
  updatedAt: string;
  read: number;
  added: number;
  changed: number;
  duplicate: number;
  rejected: number;
  checkpoint: ImportCheckpoint;
}
export const METHOD_RULES: Record<string, RegExp> = {
  이동평균: /\b(?:sma|ema|ma|moving average)\b|이동평균|이평|리본/i,
  RSI: /\brsi\b|상대강도지수/i,
  도미넌스: /dominance|btc\.d|도미넌스|btcd om/i,
  사이클: /cycle|halving|사이클|반감기/i,
  계절성: /seasonal|seasonality|계절성/i,
  VWAP: /\b[r]?vwap\b/i,
  온체인: /on.?chain|mvrv|nupl|sopr|온체인|실현가격/i,
  상대강도: /eth.?btc|doge.?btc|상대강도|비율/i,
  '추세·채널': /channel|wedge|triangle|채널|추세|삼각/i,
  '미확인 모형': /bull score|pmi|power law|파워로|rainbow|레인보우/i,
};
export function classifyText(text: string) {
  const assets: CoreAsset[] = [];
  if (/\bBTC\b|bitcoin|비트코인|ethbtc|dogebtc/i.test(text)) assets.push('BTC');
  if (/\bDOGE\b|dogecoin|도지|dogebtc/i.test(text)) assets.push('DOGE');
  if (/\bETH\b|ethereum|이더리움|ethbtc/i.test(text)) assets.push('ETH');
  return {
    assets,
    methods: Object.entries(METHOD_RULES)
      .filter(([, re]) => re.test(text))
      .map(([label]) => label),
  };
}
export function safePublicUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
}
export function normalizeResearch(
  raw: unknown,
  origin: string,
  now = new Date().toISOString(),
): ResearchItem {
  if (!raw || typeof raw !== 'object') throw new Error('자료 객체가 아닙니다.');
  const r = raw as Record<string, unknown>,
    text = String(r.text ?? '').slice(0, 100000);
  const url = safePublicUrl(r.post_url ?? r.url);
  const id = String(r.post_id ?? r.postId ?? url.match(/\/status\/(\d+)/)?.[1] ?? '');
  const explicit =
    typeof r.id === 'string' && /^(x:\d{1,30}|attachment:[a-f0-9]{64})$/.test(r.id) ? r.id : '';
  if (!/^\d{1,30}$/.test(id) && !explicit) throw new Error('게시물 ID 또는 파일 해시가 없습니다.');
  const published = String(r.date_utc ?? r.publishedAt ?? '');
  if (published && !Number.isFinite(Date.parse(published)))
    throw new Error('게시일 형식이 올바르지 않습니다.');
  const author = String(r.account ?? r.author ?? '첨부 자료')
    .replace(/^@/, '')
    .slice(0, 80);
  const itemId = explicit || 'x:' + id;
  const media = (Array.isArray(r.images) ? r.images : Array.isArray(r.media) ? r.media : [])
    .slice(0, 40)
    .flatMap((m: unknown, i: number) => {
      if (!m || typeof m !== 'object') return [];
      const x = m as Record<string, unknown>;
      const file = typeof x.file === 'string' ? x.file.replaceAll('\\', '/') : undefined;
      if (file && (file.startsWith('/') || file.includes('..') || /^[A-Za-z]:/.test(file)))
        return [];
      return [{ key: itemId + ':' + i, url: safePublicUrl(x.url) || undefined, file }];
    });
  const classification = classifyText(text);
  const review =
    r.review && typeof r.review === 'object' ? (r.review as Record<string, unknown>) : {};
  // A transfer cannot inject executable URLs, HTML, or silently verify an unknown recipe.
  const recipe = validRecipe(r.recipe);
  return {
    id: itemId,
    postId: id || undefined,
    author,
    publishedAt: published,
    importedAt: now,
    url,
    text,
    media,
    ...classification,
    origins: [origin],
    review: {
      text: review.text === true,
      images: review.images === true,
      method: review.method === true,
    },
    recipe,
    revisions: [],
    note: typeof r.note === 'string' ? r.note.slice(0, 10000) : undefined,
    captureNote:
      r.text_truncated === true
        ? 'X 화면의 접힌 본문 · 원문에서 펼쳐 확인 필요'
        : typeof r.captureNote === 'string'
          ? r.captureNote.slice(0, 300)
          : undefined,
  };
}
export function validRecipe(raw: unknown): AnalysisRecipe | undefined {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as AnalysisRecipe;
  if (
    !['BTC', 'DOGE', 'ETH'].includes(r.asset) ||
    ![
      'price',
      'rainbow',
      'ribbon',
      'vwap',
      'relative',
      'cycles',
      'windows',
      'seasonality',
      'powerlaw',
    ].includes(r.view) ||
    !['reference', 'upbit', 'binance'].includes(r.source)
  )
    return;
  if (r.view === 'powerlaw' && (r.asset !== 'BTC' || r.source !== 'reference')) return;
  if (r.view === 'cycles' && r.asset !== 'BTC') return;
  if (r.view === 'vwap' && r.source === 'reference') return;
  if (
    r.interval &&
    !(r.source === 'reference' ? ['1d', '1w', '1M'] : ['1h', '4h', '1d', '1w', '1M']).includes(
      r.interval,
    )
  )
    return;
  return {
    asset: r.asset,
    view: r.view,
    source: r.source,
    ...(r.interval ? { interval: r.interval } : {}),
    verified: r.verified === true,
    ...(r.section === 'onchain' || r.section === 'futures'
      ? {
          section: r.section,
          metric: recipeMetrics(r.asset, r.section).some((m) => m.id === r.metric)
            ? r.metric
            : recipeMetrics(r.asset, r.section)[0]?.id,
        }
      : {}),
    ...(Array.isArray(r.indicators) ? { indicators: validIndicators(r.indicators) } : {}),
    ...(Number.isFinite(r.from) ? { from: r.from } : {}),
    ...(Number.isFinite(r.to) ? { to: r.to } : {}),
  };
}
export function mergeResearch(
  old: ResearchItem | undefined,
  incoming: ResearchItem,
): { item: ResearchItem; kind: 'added' | 'changed' | 'duplicate' } {
  if (!old) return { item: incoming, kind: 'added' };
  // A collapsed X preview is not an edit of a previously captured full body.
  const preview = incoming.text
    .replace(/[\s…]+$/, '')
    .replace(/\.{3}$/, '')
    .trimEnd();
  const preserveBody =
    !!incoming.captureNote?.includes('접힌 본문') &&
    !old.captureNote?.includes('접힌 본문') &&
    !!preview &&
    old.text.startsWith(preview);
  const text = preserveBody ? old.text : incoming.text || old.text;
  const media = incoming.media.length
    ? incoming.media.map((m) => {
        const previous = old.media.find((v) =>
          m.url ? v.url === m.url : !v.url && v.key === m.key,
        );
        return previous
          ? { ...previous, ...m, file: m.file ?? previous.file, url: m.url ?? previous.url }
          : m;
      })
    : old.media;
  const changed = text !== old.text || JSON.stringify(media) !== JSON.stringify(old.media);
  return {
    kind: changed ? 'changed' : 'duplicate',
    item: {
      ...old,
      ...(changed
        ? {
            text,
            ...classifyText(text),
            review: { text: false, images: false, method: false },
            recipe: old.recipe ? { ...old.recipe, verified: false } : undefined,
            captureNote: preserveBody ? old.captureNote : incoming.captureNote,
            media,
            revisions: [
              ...old.revisions,
              { at: incoming.importedAt, text: old.text, media: old.media },
            ],
          }
        : {}),
      origins: [...new Set([...old.origins, ...incoming.origins])],
    },
  };
}
export function recipeUrl(recipe: AnalysisRecipe, publishedAt?: string, after = false) {
  const params = new URLSearchParams({
    asset: recipe.asset,
    price_source: recipe.source,
    visual: recipe.view,
    period: 'all',
    log: '1',
  });
  const date = publishedAt ? Math.floor(Date.parse(publishedAt) / 86400000) * 86400 : undefined;
  if (recipe.interval) params.set('interval', recipe.interval);
  const to = after ? undefined : (recipe.to ?? (date === undefined ? undefined : date - 86400));
  if (recipe.indicators?.length)
    params.set('indicators', validIndicators(recipe.indicators).join(','));
  if (
    recipe.metric &&
    recipeMetrics(recipe.asset, recipe.section).some((m) => m.id === recipe.metric)
  )
    params.set('panels', recipe.metric);
  if (to !== undefined && Number.isFinite(to)) {
    params.set('chart_to', String(to));
    params.set('chart_from', String(recipe.from ?? Math.max(0, to - 365 * 86400)));
  }
  return (
    (recipe.section === 'onchain' || recipe.section === 'futures'
      ? '/' + recipe.section + '/' + recipe.asset
      : '/') +
    '?' +
    params
  );
}
/** RFC4180-style CSV reader including quoted newlines, without spreadsheet formula execution. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' && !quoted) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^\uFEFF/, ''), r[i] ?? ''])));
}
