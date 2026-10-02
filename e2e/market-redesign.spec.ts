import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('stale cache never claims live or minute collection when no collector has run', async ({ page }) => {
  await page.route('**/api/v1/market?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.collection = { healthy: false, reason: 'no_execution_ledger' };
    for (const row of data.rows) {
      if (row.quote) row.quote.time = Math.floor(Date.now() / 1000) - 600;
      row.status = 'delayed';
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(8);
  await expect(page.locator('.market-feed-state')).toContainText('시세 갱신 지연');
  await expect(page.locator('.market-runtime-notice')).toContainText('수집기 실행 기록이 없습니다');
  await expect(page.locator('.market-feed-state')).not.toContainText('초 단위');
});

test('market root requests one bounded snapshot, eight assets, and preserves source through detail/back', async ({
  page,
}) => {
  const api: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) api.push(r.url());
  });
  await page.goto('/');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Upbit · 원화' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.market-table')).toContainText('₩84,000,000');
  expect(api.filter((u) => u.includes('/overview'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Binance · USDT' }).click();
  await expect(page.locator('.market-table')).toContainText('$60,000.00');
  await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
    'data-primary-metric',
    'net:mvrv',
  );
  expect(new URL(page.url()).pathname).toBe('/coins/BTC');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('binance');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Binance · USDT' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(page.locator('.market-table tbody tr')).toHaveCount(8);
});
test('legacy date links and unsupported coins remain explicit; keyboard search works', async ({
  page,
}) => {
  await page.goto(
    '/?asset=BTC&metric=net%3Amvrv&period=all&chart_from=1609459200&chart_to=1704067200',
  );
  await expect(page.locator('[data-chart-kind="analysis"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('chart_from')).toBe('1609459200');
  await page.getByLabel('코인·지표 검색', { exact: true }).fill('온도');
  await page.getByLabel('코인·지표 검색', { exact: true }).press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
    'data-primary-metric',
    'rsi',
  );
  await page.goto('/coins/ONDO?metric=net%3Amvrv&price_source=reference');
  await expect(page.locator('[data-availability]')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(page.getByText('지표 이력을 불러오고 있습니다…')).toHaveCount(0);
});
for (const width of [1280, 1440, 1920])
  test(`PC layout and accessibility ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 1280 ? 800 : width === 1920 ? 1080 : 900 });
    await page.goto('/');
    await expect(page.locator('.market-table tbody tr')).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
    await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
    const chart = page.locator('[data-chart-kind="analysis"]');
    await expect(chart).toBeVisible();
    const box = (await chart.boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(240);
    expect(box.height).toBeGreaterThanOrEqual(420);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
    await page.getByRole('button', { name: '밝은 테마로 변경' }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
  });
