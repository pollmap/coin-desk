import { describe, expect, it } from 'vitest';
import { ASSET_REGISTRY } from '../shared/asset-registry';
import { assetKnowledge, THEMES } from '../shared/knowledge';
import {
  assetThemeClassification,
  CLASSIFIED_THEMES,
  THEME_CLASSIFICATIONS,
} from '../shared/theme-catalog';

describe('Frozen editorial theme catalog', () => {
  it('covers all 150 exact registry identities with at least one evidenced theme', () => {
    const assets = new Set(ASSET_REGISTRY.map((a) => a.id));
    expect(THEME_CLASSIFICATIONS).toHaveLength(150);
    expect(new Set(THEME_CLASSIFICATIONS.map((r) => r.asset))).toEqual(assets);
    const themes = new Set(CLASSIFIED_THEMES.map((t) => t.id));
    for (const record of THEME_CLASSIFICATIONS) {
      expect(record.themes.length).toBeGreaterThan(0);
      expect(new Set(record.themes).size).toBe(record.themes.length);
      expect(record.themes.every((id) => themes.has(id))).toBe(true);
      expect(record.evidence.basis).toBe('editorial');
      expect(record.evidence.review).toBe('reviewed');
      expect(new URL(record.evidence.url).protocol).toBe('https:');
      expect(record.evidence.checkedAt).toBe('2026-10-14');
    }
    expect(THEME_CLASSIFICATIONS.filter((r) => r.providerClassification)).toHaveLength(102);
  });

  it('preserves legacy IDs, multi-membership and bounded maps', () => {
    for (const id of ['payments', 'platforms', 'memes', 'oracles', 'rwa', 'defi'])
      expect(THEMES.some((t) => t.id === id)).toBe(true);
    expect(
      THEMES.filter((t) => t.members.some((m) => m.asset === 'DOGE')).map((t) => t.id),
    ).toEqual(['payments', 'memes']);
    for (const theme of THEMES)
      expect(new Set(theme.members.map((m) => m.asset)).size).toBe(theme.members.length);
    for (const { id } of ASSET_REGISTRY)
      expect(assetKnowledge(id).nodes.length).toBeLessThanOrEqual(12);
  });

  it('keeps supplied classifications separate from independently reviewed project facts', () => {
    const beam = assetThemeClassification('BEAM')!;
    expect(beam.providerClassification?.level3Name).toBe('NFT/게임');
    expect(beam.themes).toContain('nft-gaming');
    expect(beam.themes).not.toContain('privacy');
    const graph = assetKnowledge('BEAM');
    expect(graph.nodes.find((n) => n.kind === 'asset')!.evidence.review).toBe('pending');
    expect(graph.nodes.some((n) => n.kind === 'project' || n.kind === 'network')).toBe(false);
    expect(
      graph.edges
        .filter((e) => e.relation === 'theme')
        .every((e) => e.evidence.basis === 'editorial'),
    ).toBe(true);
  });

  it('does not confuse custody, gas tokens, stablecoin connections and token rights', () => {
    expect(assetThemeClassification('NEXO')!.themes).toContain('cefi');
    expect(assetThemeClassification('NEXO')!.themes).not.toContain('defi');
    expect(assetThemeClassification('PAXG')!.evidence.note).toContain(
      'ONDO 거버넌스와 권리가 다릅니다',
    );
    expect(assetThemeClassification('GNO')!.evidence.note).toContain('xDAI와 다릅니다');
    expect(assetThemeClassification('RSR')!.evidence.note).toContain(
      '자체를 스테이블 코인으로 보지 않습니다',
    );
    expect(assetThemeClassification('FTT')!.evidence.note).toContain('과거 관계');
    expect(assetThemeClassification('ZEN')!.evidence.note).toContain('이전 PoW');
    expect(THEMES.find((t) => t.id === 'platforms')!.description).not.toContain(
      '수수료에 사용하는',
    );
  });
});
