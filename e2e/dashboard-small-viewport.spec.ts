import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, isMobile: true });

test('short mobile viewport keeps the complete first chart above navigation without scroll resizing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('/coins/BTC');
  const price = page.locator(
    '.coin-dashboard-card[data-metric="view:price"] [data-chart-kind="analysis"]',
  );
  await expect(price).toHaveAttribute('data-range-ready', '1');
  const before = (await price.boundingBox())!;
  const nav = (await page.locator('.product-nav').boundingBox())!;
  expect(before.y).toBeLessThanOrEqual(280);
  expect(before.height).toBeGreaterThanOrEqual(240);
  expect(before.y + before.height).toBeLessThanOrEqual(nav.y - 4);
  await page.screenshot({ path: test.info().outputPath('dashboard-320x600-touch.png') });
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  expect((await price.boundingBox())!.height).toBe(before.height);
  // Browser chrome changing only height must not resize the chart while reading.
  await page.setViewportSize({ width: 320, height: 630 });
  expect((await price.boundingBox())!.height).toBe(before.height);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await price.boundingBox())!.height).toBe(300);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('/coins/WLFI?market=binance');
  await expect(price).toHaveAttribute('data-asset', 'WLFI');
  await expect(price).toHaveAttribute('data-range-ready', '1');
  const picker = (await page
    .getByRole('button', { name: '코인 선택', exact: true })
    .boundingBox())!;
  expect(picker.width).toBeGreaterThanOrEqual(44);
  expect(picker.height).toBeGreaterThanOrEqual(44);
  const longNameChart = (await price.boundingBox())!;
  expect(longNameChart.y).toBeLessThanOrEqual(280);
  expect(longNameChart.y + longNameChart.height).toBeLessThanOrEqual(
    (await page.locator('.product-nav').boundingBox())!.y - 4,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
