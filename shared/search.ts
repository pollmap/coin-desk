import { ASSET_REGISTRY, ASSET_REGISTRY_VERSION } from './asset-registry';
import { COIN_ALIASES, exactCoin } from './coin-search';
import { INDICATORS_CATALOG, navigationIndicators, indicatorUrl } from './indicator-catalog';
import { GUIDE_ARTICLES } from './learning-catalog';
import { assetKnowledge, KNOWLEDGE_VERSION } from './knowledge';
import type { Asset } from './types';

export const SEARCH_VERSION = '2.1.0';
export type SearchKind = 'asset' | 'indicator' | 'guide' | 'relation';
export interface SearchDocument {
  id: string;
  title: string;
  kind: SearchKind;
  assets: readonly Asset[];
  sections: { name: string; text: string }[];
  aliases: string;
  source: string;
  checkedAt: string | null;
  review: 'reviewed' | 'pending';
  metric?: string;
}
export interface SearchChunk {
  id: string;
  documentId: string;
  section: string;
  text: string;
  assets: readonly Asset[];
  source: string;
  checkedAt: string | null;
  review: SearchDocument['review'];
  contentHash: string;
  indexVersion: string;
}
export interface SearchHit {
  id: string;
  title: string;
  kind: SearchKind;
  asset: Asset;
  metric?: string;
  reason: string;
  source: string;
  href: string;
  indexVersion: string;
}
export const normalizeSearch = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-/$]+/g, '');
const purposes = [
  { terms: ['슈퍼트렌드', '슈퍼 트렌드', 'supertrend', 'atr'], metric: 'supertrend' },
  { terms: ['고평가', '저평가', '가치평가', '실현가치', '비싸', '싼', 'mvrv'], metric: 'mvrv' },
  { terms: ['추세', '모멘텀', '과열', 'rsi'], metric: 'rsi' },
  { terms: ['레인보우', 'rainbow'], metric: 'rainbow' },
  { terms: ['위치', '밴드위치', '가격범위'], metric: 'bands' },
  { terms: ['펀딩', 'funding'], metric: 'funding' },
  { terms: ['미결제', 'openinterest'], metric: 'open_interest' },
  { terms: ['활성주소', '주소활동'], metric: 'active_addresses' },
  { terms: ['비교', '상대강도', '상관'], metric: 'relative' },
];
function hash(text: string) {
  // Deterministic change detection, not a security signature.
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** A UTF-8 byte budget is an explicit conservative lexical token bound, not an
 * estimate of the model's SentencePiece count. The optional evaluator uses the
 * pinned model tokenizer separately (384 tokens, 32 overlap). */
export function chunkDocument(d: SearchDocument): SearchChunk[] {
  return d.sections.flatMap(({ name, text }) => {
    const characters = [...text.normalize('NFKC')];
    const sizes = characters.map((c) => new TextEncoder().encode(c).length);
    const chunks: SearchChunk[] = [];
    for (let start = 0; start < characters.length;) {
      let end = start,
        size = 0;
      while (end < characters.length && size + sizes[end] <= 384) size += sizes[end++];
      // Keep existing formulas intact (all are below this bound). Prefer a full
      // sentence/newline when long prose needs another chunk.
      if (end < characters.length && name !== '공식') {
        for (let boundary = end; boundary > start + (end - start) / 2; boundary--)
          if (/[.!?\n]/.test(characters[boundary - 1])) {
            end = boundary;
            break;
          }
      }
      const part = characters.slice(start, end).join('');
      chunks.push({
        id: `${d.id}:${name}:${start}`,
        documentId: d.id,
        section: name,
        text: part,
        assets: d.assets,
        source: d.source,
        checkedAt: d.checkedAt,
        review: d.review,
        contentHash: hash(part),
        indexVersion: SEARCH_VERSION,
      });
      if (end >= characters.length) break;
      let next = end,
        overlap = 0;
      while (next > start && overlap + sizes[next - 1] <= 32) overlap += sizes[--next];
      start = Math.max(start + 1, next);
    }
    return chunks;
  });
}
export function buildSearchIndex(previous?: {
  documents: SearchDocument[];
  chunks: SearchChunk[];
}) {
  const documents = searchDocuments();
  const old = new Map(previous?.documents.map((d) => [d.id, JSON.stringify(d)]));
  const chunks = documents.flatMap((d) =>
    old.get(d.id) === JSON.stringify(d)
      ? previous!.chunks.filter((c) => c.documentId === d.id)
      : chunkDocument(d),
  );
  return { indexVersion: SEARCH_CATALOG_VERSION, documents, chunks };
}
export function searchDocuments(): SearchDocument[] {
  return [
    ...ASSET_REGISTRY.map((a) => ({
      id: `asset:${a.id}`,
      title: `${a.name} · ${a.id}`,
      kind: 'asset' as const,
      assets: [a.id],
      aliases: [a.id, a.name, a.englishName, ...a.aliases].join(' '),
      sections: [{ name: '정의', text: `${a.name} ${a.englishName} ${a.id}` }],
      source: a.review.sources[0],
      checkedAt: null,
      review: 'reviewed' as const,
    })),
    ...INDICATORS_CATALOG.map((d) => ({
      id: `indicator:${d.id}`,
      title: d.title,
      kind: 'indicator' as const,
      assets: d.assets,
      aliases: `${d.id} ${d.group}`,
      metric: d.id,
      source: d.source,
      checkedAt: null,
      review: 'reviewed' as const,
      sections: [
        { name: '정의', text: d.shortMeaning },
        { name: '기준선', text: d.baselineMeaning },
        { name: '공식', text: d.formula },
        { name: '한계', text: d.measurementScope },
      ],
    })),
    ...GUIDE_ARTICLES.map((d) => ({
      id: `guide:${d.id}`,
      title: d.title,
      kind: 'guide' as const,
      assets: d.assets,
      aliases: `${d.english} ${d.aliases ?? ''}`,
      source: d.source ?? '',
      checkedAt: null,
      review: 'reviewed' as const,
      sections: [
        { name: '정의', text: d.summary },
        { name: '읽는 법', text: d.read },
        { name: '공식', text: d.formula },
        { name: '예시', text: d.steps.join('\n') },
        { name: '한계', text: d.caution },
      ],
    })),
    ...ASSET_REGISTRY.flatMap((a) =>
      assetKnowledge(a.id)
        .edges.filter((e) => e.evidence.review === 'reviewed')
        .map((e) => ({
          id: `relation:${a.id}:${e.id}`,
          title: `${a.name} · ${e.label}`,
          kind: 'relation' as const,
          assets: [a.id],
          aliases: e.target.replaceAll(':', ' '),
          source: e.evidence.url,
          checkedAt: e.evidence.checkedAt,
          review: 'reviewed' as const,
          sections: [{ name: '관계', text: e.evidence.note }],
        })),
    ),
  ];
}
export function searchSelection(q: string, context: Asset = 'BTC') {
  const normalized = normalizeSearch(q);
  const exact = ASSET_REGISTRY.find((a) => exactCoin(a.id, q));
  // Longest alias wins; short tickers require a word boundary to avoid ETH in unrelated words.
  const mention = ASSET_REGISTRY.flatMap((a) =>
    [a.id, a.name, a.englishName, ...a.aliases, ...(COIN_ALIASES[a.id] ?? [])].map((alias) => ({
      a,
      alias,
    })),
  )
    .filter(
      ({ alias }) =>
        alias.length >= 2 &&
        (/[가-힣]/.test(alias)
          ? normalized.includes(normalizeSearch(alias))
          : q
              .toLowerCase()
              .split(/[\s,/:]+/)
              .includes(alias.toLowerCase())),
    )
    .sort((a, b) => b.alias.length - a.alias.length)[0];
  return {
    asset: exact?.id ?? mention?.a.id ?? context,
    exact: exact?.id,
    explicit: !!exact || !!mention,
    purpose: purposes.find((p) => p.terms.some((t) => normalized.includes(normalizeSearch(t)))),
  };
}
export function validateSearch(params: URLSearchParams) {
  if (
    [...params.keys()].some((k) => !['q', 'asset', 'kind', 'limit'].includes(k)) ||
    [...params.keys()].some((k) => params.getAll(k).length !== 1)
  )
    throw new Error('Invalid search parameters');
  const q = (params.get('q') ?? '').trim();
  if (!q || [...q].length > 100) throw new Error('Search requires 1–100 characters');
  const asset = (params.get('asset') ?? 'BTC').toUpperCase() as Asset;
  if (!ASSET_REGISTRY.some((a) => a.id === asset)) throw new Error('Unknown asset');
  const kind = params.get('kind');
  if (kind && !['asset', 'indicator', 'guide', 'relation'].includes(kind))
    throw new Error('Unknown search kind');
  const raw = params.get('limit') ?? '20';
  if (!/^\d+$/.test(raw) || +raw < 1 || +raw > 20) throw new Error('Invalid search limit');
  return { q, asset, kind, limit: +raw };
}
export function rankSearch(
  params: URLSearchParams,
  documents = searchDocuments(),
  bodyMatches: string[] = [],
): SearchHit[] {
  const { q, asset: context, kind, limit } = validateSearch(params),
    selection = searchSelection(q, context);
  const asset = selection.asset,
    definitions = navigationIndicators(asset, '');
  const normalized = normalizeSearch(q),
    terms = q.split(/\s+/).map(normalizeSearch);
  const allowed = new Set(definitions.map((d) => d.id));
  const candidates = documents.filter(
    (d) =>
      (!kind || d.kind === kind) &&
      d.review === 'reviewed' &&
      (d.kind === 'asset'
        ? !selection.purpose && (!selection.explicit || d.assets.includes(asset))
        : d.assets.includes(asset)) &&
      (d.kind !== 'indicator' || allowed.has(d.metric!)),
  );
  return candidates
    .map((d) => {
      const text = normalizeSearch(
        `${d.title} ${d.aliases} ${d.sections.map((s) => s.text).join(' ')}`,
      );
      let score = bodyMatches.includes(d.id) ? 20 - bodyMatches.indexOf(d.id) / 100 : 0;
      if (terms.every((t) => text.includes(t))) score += 50;
      if (normalizeSearch(d.title).startsWith(normalized)) score += 25;
      if (d.kind === 'asset' && selection.exact && d.assets.includes(selection.exact)) score += 200;
      if (
        selection.purpose &&
        d.kind === 'indicator' &&
        d.metric!.includes(selection.purpose.metric)
      )
        score += d.metric!.split(':').at(-1) === selection.purpose.metric ? 180 : 150;
      // Explicit asset alone opens that asset, never an unrelated indicator from a partial ticker.
      if (selection.explicit && !selection.purpose && d.kind === 'asset') score += 100;
      const href =
        d.kind === 'indicator'
          ? indicatorUrl(asset, d.metric!)
          : d.kind === 'guide'
            ? `/learn/${d.id.slice(6)}?asset=${asset}`
            : d.kind === 'relation'
              ? `/coins/${asset}?asset=${asset}&knowledge=1`
              : `/coins/${d.assets[0]}`;
      return {
        score,
        hit: {
          id: d.id,
          title: d.title,
          kind: d.kind,
          asset: d.kind === 'asset' ? d.assets[0] : asset,
          metric: d.metric,
          reason:
            d.kind === 'indicator'
              ? `${asset} · ${d.sections[0].text}`
              : d.sections[0].text.slice(0, 100),
          source: d.source,
          href,
          indexVersion: SEARCH_VERSION,
        },
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.hit.id.localeCompare(b.hit.id))
    .slice(0, limit)
    .map((r) => r.hit);
}
export const SEARCH_CATALOG_VERSION = `${SEARCH_VERSION}:${ASSET_REGISTRY_VERSION}:${KNOWLEDGE_VERSION}`;
export const supportedSearchIndicators = (asset: Asset) =>
  navigationIndicators(asset, '').map((d) => 'indicator:' + d.id);
