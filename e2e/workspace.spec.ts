import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const chart = (page: Page) => page.locator('[data-chart-kind="analysis"]');
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
});
test('core selection, Korean/ticker search, all-history and keyboard restoration', async ({
  page,
}) => {
  await page.goto('/');
  await expect(chart(page)).toHaveAttribute('data-asset', 'BTC');
  await expect(page.getByRole('button', { name: '전체', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const [query, asset] of [
    ['도지', 'DOGE'],
    ['ETH', 'ETH'],
    ['비트', 'BTC'],
  ]) {
    await page.getByRole('button', { name: /코인 변경/ }).click();
    const search = page.getByRole('searchbox', { name: '코인 검색' });
    await expect(search).toBeFocused();
    await search.fill(query);
    await search.press('Enter');
    await expect(chart(page)).toHaveAttribute('data-asset', asset);
  }
  const picker = page.getByRole('button', { name: /코인 변경/ });
  await picker.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(picker).toBeFocused();
  await page.getByRole('button', { name: '지표 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '지표 추가', exact: true })).toBeFocused();
});
test('price source survives sections, navigation, reload and shared URL', async ({ page }) => {
  await page.goto('/?asset=DOGE&period=all&price_source=reference');
  for (const basis of ['upbit', 'binance', 'reference']) {
    await page.getByLabel('가격 기준', { exact: true }).selectOption(basis);
    await expect(chart(page)).toBeVisible();
    await expect(page.getByLabel('가격 기준', { exact: true })).toHaveValue(basis);
    await page
      .getByRole('navigation', { name: 'DOGE 분석 화면' })
      .getByRole('link', { name: '온체인', exact: true })
      .click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /net:/);
    expect(new URL(page.url()).searchParams.get('price_source')).toBe(basis);
    await page
      .getByRole('navigation', { name: 'DOGE 분석 화면' })
      .getByRole('link', { name: '선물', exact: true })
      .click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /futures:/);
    await page.goBack();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /net:/);
    await page.reload();
    await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
    await page
      .getByRole('navigation', { name: 'DOGE 분석 화면' })
      .getByRole('link', { name: '가격·기술', exact: true })
      .click();
    await expect(page.getByLabel('가격 기준', { exact: true })).toHaveValue(basis);
  }
  await page.locator('summary').filter({ hasText: '내보내기 · 공유' }).click();
  await page.getByRole('button', { name: '링크 공유', exact: true }).click();
  const shared = await page.getByLabel('공유 주소', { exact: true }).inputValue();
  await page.goto(shared);
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
});
test('slow failed old asset and broken logo do not contaminate the next asset', async ({
  page,
}) => {
  await page.route('**/api/v1/reference?asset=BTC**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 503, json: { error: 'BTC fixture outage' } });
  });
  await page.route('**/coin-logos/btc.png', (route) => route.abort());
  await page.goto('/?asset=BTC');
  await expect(page.locator('.coin-picker .asset-logo.fallback')).toBeVisible();
  await page.getByRole('button', { name: /코인 변경/ }).click();
  await page.getByRole('searchbox', { name: '코인 검색' }).fill('DOGE');
  await page.keyboard.press('Enter');
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  await page.waitForTimeout(1700);
  await expect(page.getByText('BTC fixture outage')).toHaveCount(0);
  await expect(page.locator('.coin-picker img').first()).toBeVisible();
  expect(
    await page
      .locator('.coin-picker img')
      .first()
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
});
for (const width of [320, 390, 768, 1280, 1440]) {
  test(`responsive and axe at ${width}px in both themes`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/coins', '/?asset=BTC&period=all', '/onchain/ETH', '/futures/DOGE']) {
      await page.goto(path);
      if (path !== '/coins') await expect(chart(page)).toBeVisible();
      else await expect(page.getByRole('link', { name: '비트코인 차트 열기' })).toBeVisible();
      for (let theme = 0; theme < 2; theme++) {
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        ).toEqual([]);
        await page.getByRole('button', { name: /테마로 변경/ }).click();
      }
    }
  });
}
test('200 percent CSS zoom preserves controls and chart keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/?asset=ETH&period=all');
  await expect(chart(page)).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await chart(page).focus();
  await page.keyboard.press('Home');
  const first = await page.getByLabel('차트 탐색 날짜 (UTC)').inputValue();
  await page.keyboard.press('End');
  expect(await page.getByLabel('차트 탐색 날짜 (UTC)').inputValue()).not.toBe(first);
});

test('stale data is visible and an API failure remains isolated to its asset', async ({ page }) => {
  await page.route('**/api/v1/reference?asset=BTC**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.meta.stale = true;
    body.meta.warning = 'fixture stale observation';
    await route.fulfill({ json: body });
  });
  await page.goto('/?asset=BTC&period=all');
  await expect(chart(page)).toBeVisible();
  await expect(page.locator('.source-line').getByText('갱신 지연')).toBeVisible();
  await page.getByRole('link', { name: '이더리움 ETH', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'ETH');
  await expect(page.locator('.source-line').getByText('갱신 지연')).toHaveCount(0);
});
for (const asset of ['BTC', 'DOGE', 'ETH']) {
  test(`${asset} onchain and futures are the main chart without price requests`, async ({
    page,
  }) => {
    const priceRequests: string[] = [];
    page.on('request', (r) => {
      if (/api\/v1\/(reference|candles|overview)\?/.test(r.url())) priceRequests.push(r.url());
    });
    await page.goto('/onchain/' + asset);
    await expect(chart(page)).toHaveAttribute('data-asset', asset);
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /^(net|btc):/);
    await page
      .getByRole('navigation', { name: asset + ' 분석 화면' })
      .getByRole('link', { name: '선물', exact: true })
      .click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /^futures:/);
    expect(priceRequests).toEqual([]);
  });
}
