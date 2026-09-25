import { describe, it, expect } from 'vitest';
import {
  chartSettings,
  DEFAULT_DESK,
  importDesk,
  normalizeDesk,
  workspaceUrl,
} from '../shared/workspace';
describe('personal desk untrusted settings', () => {
  it('normalizes broken storage and never accepts navigation URLs', () => {
    expect(normalizeDesk(null)).toEqual(DEFAULT_DESK);
    expect(
      chartSettings({ asset: '<script>', market: 'x', log: 'false', indicators: 'sma' }),
    ).toMatchObject({
      asset: 'BTC',
      market: 'binance',
      log: true,
      indicators: ['sma200', 'sma200w'],
    });
    const desk = normalizeDesk({
      version: 1,
      cards: [],
      favorites: ['DOGE', 'DOGE', 'FAKE'],
      workspaces: [{ name: '<script>', asset: 'DOGE', view: 'https://evil.test', cards: [] }],
    });
    expect(desk.favorites).toEqual(['DOGE']);
    expect(desk.cards).toEqual([]);
    expect(workspaceUrl(desk.workspaces[0])).toMatch(/^\/\?asset=DOGE/);
  });
  it('roundtrips named chart settings and empty cards', () => {
    const desk = normalizeDesk({
      ...DEFAULT_DESK,
      workspaces: [
        {
          name: 'DOGE 55',
          asset: 'DOGE',
          market: 'upbit',
          interval: '1w',
          period: '1y',
          indicators: ['sma:55:d'],
          log: false,
          view: 'chart',
          cards: [],
        },
      ],
    });
    expect(importDesk(JSON.stringify(desk))).toEqual(desk);
    expect(workspaceUrl(desk.workspaces[0])).toContain('indicators=sma%3A55%3Ad&log=0&cards=');
  });
  it('restores the focused metric and optional price comparison', () => {
    const desk = normalizeDesk({
      ...DEFAULT_DESK,
      workspaces: [
        {
          name: 'ETH onchain',
          asset: 'ETH',
          section: 'onchain',
          panels: ['net:active_addresses', 'net:mvrv'],
          comparePrice: true,
        },
      ],
    });
    expect(importDesk(JSON.stringify(desk))).toEqual(desk);
    const url = new URL(workspaceUrl(desk.workspaces[0]), 'https://example.test');
    expect(url.pathname).toBe('/onchain/ETH');
    expect(url.searchParams.get('panels')).toBe('net:active_addresses,net:mvrv');
    expect(url.searchParams.get('compare_price')).toBe('1');
    expect(() =>
      importDesk(
        JSON.stringify({ ...desk, workspaces: [{ ...desk.workspaces[0], comparePrice: 'false' }] }),
      ),
    ).toThrow();
  });
  it('rejects oversized, unsupported and duplicate imports before replacing settings', () => {
    expect(() => importDesk(' '.repeat(64001))).toThrow();
    expect(() => importDesk(JSON.stringify({ ...DEFAULT_DESK, note: '가'.repeat(22000) }))).toThrow(
      '64KB',
    );
    expect(() => importDesk('{')).toThrow();
    expect(() => importDesk(JSON.stringify({ ...DEFAULT_DESK, version: 2 }))).toThrow();
    expect(() =>
      importDesk(JSON.stringify({ ...DEFAULT_DESK, favorites: ['BTC', 'BTC'] })),
    ).toThrow();
    expect(() =>
      importDesk(JSON.stringify({ ...DEFAULT_DESK, workspaces: [{ name: 'bad', asset: 'FAKE' }] })),
    ).toThrow();
  });
});
