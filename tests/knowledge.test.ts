import { describe, expect, it } from 'vitest';
import { ASSETS } from '../shared/catalog';
import { assetKnowledge, themesResponse } from '../shared/knowledge';
import { indicatorDefinition } from '../shared/indicator-catalog';
import { matchesIndicator } from '../shared/indicator-search';

describe('Evidence-backed bounded relationships', () => {
  for (const { id: asset } of ASSETS)
    it(asset + ' preserves entities and routes to supported analysis', () => {
      const graph = assetKnowledge(asset);
      expect(graph.nodes.length).toBeLessThanOrEqual(12);
      const ids = new Set(graph.nodes.map((n) => n.id));
      expect(ids.size).toBe(graph.nodes.length);
      for (const edge of graph.edges) {
        expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
        expect(edge.evidence.review).toBe('reviewed');
        expect(new URL(edge.evidence.url).protocol).toBe('https:');
        expect(edge.evidence.checkedAt).toMatch(/^2026-10-09$/);
      }
      for (const node of graph.nodes.filter((n) => ['project', 'network'].includes(n.kind))) {
        expect(node.description).not.toBe(graph.nodes[0].description);
      }
      for (const node of graph.nodes.filter((n) => n.metric)) {
        expect(indicatorDefinition(node.metric!)?.assets).toContain(asset);
      }
    });
  it('does not turn ONDO governance into a treasury claim or create an unsupported MVRV', () => {
    const ondo = assetKnowledge('ONDO');
    expect(ondo.nodes[0].description).toContain('수익청구권이 아닙니다');
    expect(ondo.nodes.find((n) => n.kind === 'indicator')?.metric).toBe('rsi');
    const themes = themesResponse();
    expect(themes.editorial).toBe(true);
    expect(themes.themes.filter((t) => t.members.some((m) => m.asset === 'DOGE'))).toHaveLength(2);
  });
  it('finds metrics by purpose without introducing a semantic search service', () => {
    expect(matchesIndicator(indicatorDefinition('net:mvrv')!, '가치평가')).toBe(true);
    expect(matchesIndicator(indicatorDefinition('rsi')!, '추세')).toBe(true);
    expect(matchesIndicator(indicatorDefinition('rsi')!, '존재하지않는검색')).toBe(false);
  });
});
