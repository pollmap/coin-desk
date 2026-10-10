import { describe, it, expect } from 'vitest';
import { ASSETS } from '../shared/catalog';
import { toggleFavorite, validFavorites } from '../shared/personal-favorites';
import { normalizeDesk, importDesk, DEFAULT_DESK } from '../shared/workspace';

describe('expanded favorites preserve personal data', () => {
  it('retains all 150 valid favorites through normalization, backup and restore', () => {
    const desk = { ...DEFAULT_DESK, favorites: ASSETS.map((a) => a.id) };
    expect(normalizeDesk(desk).favorites).toHaveLength(150);
    expect(importDesk(JSON.stringify(desk)).favorites).toEqual(desk.favorites);
  });
  it('adding a ninth favorite preserves saved analysis, notes, unknown fields and version 1', () => {
    const desk = {
      version: 1,
      favorites: ASSETS.slice(0, 8).map((a) => a.id),
      workspaces: [{ name: 'my analysis', annotations: [{ text: 'personal note' }] }],
      extra: { future: 'keep' },
    };
    const before = structuredClone(desk),
      next = toggleFavorite(desk, ASSETS[8].id);
    expect(next.favorites).toHaveLength(9);
    expect(next.workspaces).toEqual(before.workspaces);
    expect(next.extra).toEqual(before.extra);
    expect(next.version).toBe(1);
    expect(desk).toEqual(before);
  });
  it('does not replace malformed or future-version storage and rejects unsupported assets', () => {
    expect(() => toggleFavorite({ version: 3 }, 'BTC')).toThrow();
    expect(() => toggleFavorite({ version: '1' }, 'BTC')).toThrow();
    expect(() => toggleFavorite('broken', 'BTC')).toThrow();
    expect(() => toggleFavorite(null, 'UNKNOWN' as never)).toThrow();
    expect(validFavorites(['BTC', 'BTC', 'UNKNOWN', 'ETH'])).toEqual(['BTC', 'ETH']);
  });
});
