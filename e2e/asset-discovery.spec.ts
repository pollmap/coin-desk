import { test, expect } from '@playwright/test';

for (const width of [390, 1280])
  test(`150 asset discovery, aliases, watchlist and data panels ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) calls.push(request.url());
    });
    await page.goto('/');
    const initial = width < 768 ? 20 : 50;
    await expect(page.locator('.market-table tbody tr')).toHaveCount(initial);
    await expect(page.getByRole('heading', { name: '시장', exact: true })).toBeVisible();
    await expect(page.locator('[data-chart-kind=analysis]')).toHaveCount(0);
    expect(calls.filter((u) => u.includes('/api/v1/market?'))).toHaveLength(1);
    expect(calls.filter((u) => /\/overview|\/network|\/prices|\/knowledge/.test(u))).toHaveLength(
      0,
    );
    await page.getByRole('button', { name: '더 보기', exact: true }).click();
    await expect(page.locator('.market-table tbody tr')).toHaveCount(initial * 2);
    await page.getByRole('textbox', { name: '시장 코인 검색' }).fill('펭귄');
    await expect(page.locator('.market-table tbody tr')).toHaveCount(1);
    const row = page.locator('.market-table tbody tr');
    await expect(row).toContainText('PENGU');
    const star = row.getByRole('button', { name: /관심 코인/ });
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await row.locator('.market-coin-cell a').click();
    const chart = page.locator('[data-chart-kind=analysis]');
    await expect(chart).toHaveAttribute('data-asset', 'PENGU');
    await expect(chart).toHaveAttribute('data-primary-metric', 'rsi');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    const range = await chart.getAttribute('data-visible-from');
    await expect(page.locator('.indicator-provenance')).toHaveCount(0);
    await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '데이터 정보' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chart).toHaveAttribute('data-visible-from', range!);
    await page.goBack();
    await expect(page.getByRole('textbox', { name: '시장 코인 검색' })).toHaveValue('펭귄');
    await expect(page.locator('.market-table tbody tr')).toHaveCount(1);
    await page.getByRole('textbox', { name: '시장 코인 검색' }).fill('BNB');
    await expect(row).toContainText('Binance USDT');
    await row.locator('.market-coin-cell a').click();
    await expect(chart).toHaveAttribute('data-asset', 'BNB');
    expect(new URL(page.url()).searchParams.get('price_source')).toBe('binance');
    await page.getByRole('button', { name: '가격 거래소와 체결 시각' }).click();
    await expect(page.getByRole('combobox', { name: '현재 가격 거래소' })).toHaveValue('binance');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: test.info().outputPath(`discovery-${width}.png`) });
  });

test('exact ticker search wins over a longer token ticker', async ({ page }) => {
  await page.goto('/coins/BTC');
  await page.getByRole('button', { name: /코인 변경/ }).click();
  const input = page.getByRole('searchbox', { name: '코인 검색' });
  await input.fill('ETH');
  await input.press('Enter');
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-asset', 'ETH');
});
