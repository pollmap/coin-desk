import { describe, expect, it } from 'vitest';
import { ASSET_REGISTRY } from '../shared/asset-registry';
import {
  chunkDocument,
  buildSearchIndex,
  rankSearch,
  searchDocuments,
  searchSelection,
  validateSearch,
} from '../shared/search';
import { assetKnowledge } from '../shared/knowledge';
const docs = searchDocuments();
const search = (q: string, asset = 'BTC') => rankSearch(new URLSearchParams({ q, asset }), docs);
describe('public search and provenance', () => {
  it('identifies all 150 exact tickers without substring confusion', () => {
    expect(ASSET_REGISTRY).toHaveLength(150);
    for (const a of ASSET_REGISTRY) expect(search(a.id)[0]?.asset, a.id).toBe(a.id);
  });
  it('connects Korean asset and purpose without claiming an investment judgement', () => {
    expect(search('비트코인 고평가')[0]).toMatchObject({ asset: 'BTC', metric: 'net:mvrv' });
    expect(search('펭귄 추세')[0]).toMatchObject({ asset: 'PENGU', metric: 'rsi' });
    expect(search('온도 고평가').some((h) => h.metric === 'net:mvrv')).toBe(false);
    expect(search('MVRV', 'AAVE')[0]?.asset).toBe('AAVE');
  });
  it('rejects unknown, excessive, duplicated and malformed input', () => {
    for (const input of [
      'q=x&limit=21',
      'q=x&asset=NOPE',
      'q=x&q=y',
      'q=x&kind=private',
      'q=' + '가'.repeat(101),
    ])
      expect(() => validateSearch(new URLSearchParams(input))).toThrow();
  });
  it('uses bounded deterministic chunks and excludes unreviewed relations', () => {
    for (const d of docs) {
      const chunks = chunkDocument(d);
      expect(chunks).toEqual(chunkDocument(d));
      expect(
        chunks.every(
          (c) => new TextEncoder().encode(c.text).length <= 384 && c.source === d.source,
        ),
      ).toBe(true);
      for (const section of d.sections.filter((s) => s.name === '공식'))
        expect(chunks.find((c) => c.section === '공식')?.text).toBe(section.text.normalize('NFKC'));
    }
    const index = buildSearchIndex();
    expect(buildSearchIndex(index).chunks[0]).toBe(index.chunks[0]);
    expect(docs.every((d) => d.kind !== 'relation' || d.review === 'reviewed')).toBe(true);
  });
  it('distinguishes issued tokens and native assets and keeps pending relationships pending', () => {
    for (const a of ['AAVE', 'SHIB'] as const)
      expect(assetKnowledge(a).edges.find((e) => e.target === 'network:Ethereum')).toMatchObject({
        relation: 'issued-on',
        label: '발행 네트워크',
      });
    expect(assetKnowledge('ETH').edges.find((e) => e.target === 'network:Ethereum')?.relation).toBe(
      'native-asset',
    );
    expect(assetKnowledge('TAO').nodes[0].evidence.review).toBe('pending');
    expect(searchSelection('펭귄 추세').asset).toBe('PENGU');
  });
});
