import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('selects Supertrend from USD reference, opens actual DOGE weekly candles and keeps dates while reading help', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=net:mvrv&price_source=reference');
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택' });
  await picker.getByRole('textbox').fill('슈퍼트렌드');
  await picker.getByRole('link', { name: /슈퍼트렌드/ }).click();
  await expect(page).toHaveURL(/metric=view%3Asupertrend/);
  await expect(page).toHaveURL(/price_source=binance/);
  await expect(page).toHaveURL(/interval=1w/);
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.supertrend-context')).toContainText('ATR 10 · 3배 · 1w');
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.supertrend-context')).toContainText('계산 전');
  await page.keyboard.press('End');
  const from = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '지표 설명', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Wilder');
  await expect(page.getByRole('dialog')).toContainText('109.6');
  await page.keyboard.press('Escape');
  await expect(chart).toHaveAttribute('data-visible-from', from!);
});

test('rejects a closing-only source without loading another coin and offers a valid alternative', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/reference')) requests.push(r.url());
  });
  await page.goto('/coins/ONDO?metric=view:supertrend&price_source=reference');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole('link', { name: '지원되는 원천·분석으로 열기' }).click();
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute('data-asset', 'ONDO');
  await expect(page.locator('.supertrend-context')).toContainText('ATR 10');
});

test('saves and restores source, weekly interval and custom Supertrend settings', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=view:supertrend&price_source=upbit&interval=1w');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const before = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByRole('spinbutton', { name: '슈퍼트렌드 ATR 기간' }).fill('7');
  await page.getByRole('spinbutton', { name: '슈퍼트렌드 배수' }).fill('2.5');
  await page.getByRole('button', { name: '설정 적용', exact: true }).click();
  await expect(page.locator('.supertrend-context')).toContainText('ATR 7 · 2.5배');
  await expect(chart).toHaveAttribute('data-visible-from', before!);
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  const save = page.getByRole('dialog', { name: '분석 저장' });
  await save.getByRole('textbox', { name: '작업공간 이름' }).fill('DOGE 주봉 추세');
  await save.getByRole('button', { name: '현재 구성 저장' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '내 저장', exact: true }).first().click();
  await page.getByRole('link', { name: /DOGE 주봉 추세/ }).click();
  await expect(page).toHaveURL(/st_period=7/);
  await expect(page).toHaveURL(/st_multiplier=2.5/);
  await expect(page.locator('.supertrend-context')).toContainText('ATR 7 · 2.5배 · 1w');
  await expect(page.locator('.analysis-reading-value')).toContainText('₩');
});

test('uses the selected coin across supported markets and direct default entry', async ({
  page,
}) => {
  for (const [asset, source] of [
    ['BTC', 'binance'],
    ['ETH', 'upbit'],
    ['PEPE', 'binance'],
    ['PENGU', 'upbit'],
    ['AAVE', 'binance'],
  ]) {
    await page.goto(`/coins/${asset}?metric=view:supertrend&price_source=${source}&interval=1d`);
    await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute('data-asset', asset);
    await expect(page.locator('.supertrend-context')).toContainText('ATR 10 · 3배 · 1d');
    await expect(page.locator('.supertrend-context')).not.toContainText('계산 전');
  }
  await page.goto('/coins/DOGE?metric=view:supertrend');
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute('data-asset', 'DOGE');
  await expect(page.locator('.supertrend-context')).toContainText('1w');
});

test('keeps the weekly chart compact and accessible in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/coins/DOGE?metric=view:supertrend&price_source=binance&interval=1w');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(280);
  await page.screenshot({ path: testInfo.outputPath('supertrend-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await chart.boundingBox())!.height).toBeGreaterThanOrEqual(420);
  expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(240);
  await page.screenshot({ path: testInfo.outputPath('supertrend-pc.png'), fullPage: true });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '어두운 테마로 변경' }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
  }
});
