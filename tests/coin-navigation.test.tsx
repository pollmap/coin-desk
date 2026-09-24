import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AssetHeader } from '../src/AssetHeader';
import { AssetSections } from '../src/AssetSections';
import { DeskNavigation } from '../src/DeskNavigation';
import { NETWORK_ASSETS, NETWORK_GROUPS, networkMetrics } from '../shared/network-catalog';

function navigation(at: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[at]}>
      <DeskNavigation onNavigate={() => undefined} />
    </MemoryRouter>,
  );
}

it('assigns every supported onchain metric to exactly one group for every coin', () => {
  for (const asset of NETWORK_ASSETS)
    for (const metric of networkMetrics(asset))
      expect(NETWORK_GROUPS.filter((group) => group.ids.includes(metric.id))).toHaveLength(1);
});

it.each([
  '/futures/DOGE?metric=open_interest',
  '/onchain/DOGE',
  '/chart/ETH?period=all',
  '/?asset=DOGE&period=all#derivatives',
])('has exactly one global selection for %s', (path) => {
  const html = navigation(path);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('aria-label="코인 분석"');
  expect(html).not.toContain('coin-nav-group');
});

it('keeps all analysis section links scoped to DOGE and marks only futures current', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AssetHeader
        asset="DOGE"
        current="futures"
        subtitle="선물"
        assets={['BTC', 'DOGE', 'ETH']}
        href={(asset) => '/futures/' + asset}
      />
    </MemoryRouter>,
  );
  expect(html).toContain('aria-label="코인 변경 · 도지코인 DOGE"');
  expect(html).toContain('aria-label="코인 검색"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('href="/futures/DOGE?market=binance&amp;period=all"');
  expect(html).toContain('href="/onchain/DOGE?market=binance&amp;period=all"');
  const scoped = html.slice(html.indexOf('<nav class="asset-sections"'));
  expect(scoped).not.toContain('/futures/BTC');
  expect(html).not.toContain('value="SOL"');
});

it('keeps SOL context across futures and explicit onchain coverage', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AssetSections asset="SOL" current="chart" />
    </MemoryRouter>,
  );
  expect(html).toContain('/futures/SOL');
  expect(html).toContain('/onchain/SOL');
  expect(html).toContain('/chart/SOL');
});
