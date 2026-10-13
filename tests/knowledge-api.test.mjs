import { it, expect, vi } from 'vitest';
import worker from '../worker/index';
import { ASSET_REGISTRY } from '../shared/asset-registry';
import { openDatabase, memoryCache } from '../scripts/local-db.mjs';
it('themes and relationships are read-only, asset isolated and reject unsupported input', async () => {
  const DB = openDatabase(':memory:');
  vi.stubGlobal('caches', { default: memoryCache() });
  const pending = [];
  const call = (path) =>
    worker.fetch(
      new Request('https://local/api/v1/' + path),
      { DB, ENABLED_ASSETS: 'BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE' },
      { waitUntil: (task) => pending.push(task) },
    );
  try {
    const before = DB.sqlite.prepare('SELECT total_changes() n').get().n;
    const themes = await (await call('themes')).json();
    expect(themes.version).toBe('1.2.0');
    expect(themes.editorial).toBe(true);
    expect(themes.themes).toHaveLength(31);
    expect(
      new Set(themes.themes.flatMap((theme) => theme.members.map((member) => member.asset))),
    ).toEqual(new Set(ASSET_REGISTRY.map((asset) => asset.id)));
    expect(
      themes.themes
        .find((theme) => theme.id === 'nft-gaming')
        .members.some((member) => member.asset === 'BEAM'),
    ).toBe(true);
    expect(
      themes.themes
        .find((theme) => theme.id === 'privacy')
        .members.some((member) => member.asset === 'BEAM'),
    ).toBe(false);
    const ondo = await (await call('knowledge?asset=ONDO')).json();
    const btc = await (await call('knowledge?asset=BTC')).json();
    expect(ondo.asset).toBe('ONDO');
    expect(btc.asset).toBe('BTC');
    expect((await call('knowledge?asset=unknown')).status).toBe(400);
    expect((await call('themes?private=1')).status).toBe(400);
    expect(DB.sqlite.prepare('SELECT total_changes() n').get().n).toBe(before);
  } finally {
    await Promise.all(pending);
    DB.sqlite.close();
    vi.unstubAllGlobals();
  }
});
