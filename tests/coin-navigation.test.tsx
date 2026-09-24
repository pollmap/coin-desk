import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DeskNavigation } from '../src/DeskNavigation';

function navigation(at: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[at]}>
      <DeskNavigation onNavigate={() => undefined} />
    </MemoryRouter>,
  );
}

it('keeps DOGE navigation within DOGE instead of selecting three coin views', () => {
  const html = navigation('/?asset=DOGE&period=all#derivatives');
  expect(html).toContain('aria-label="DOGE 분석"');
  expect(html).not.toContain('aria-label="BTC 분석"');
  expect(html).not.toContain('aria-label="ETH 분석"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('선물 · 펀딩비 / 미결제약정');
});

it('selects the onchain view for the current asset only', () => {
  const html = navigation('/onchain/DOGE');
  expect(html).toContain('aria-label="DOGE 분석"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
});

it('selects only the current coin chart in the technical view', () => {
  const html = navigation('/chart/ETH?period=all');
  expect(html).toContain('aria-label="ETH 분석"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
});
