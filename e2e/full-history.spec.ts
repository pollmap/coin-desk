import { test, expect } from '@playwright/test';

test('DOGE band entry chooses the oldest source and includes pre-calculation prices', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=net:mvrv&price_source=upbit');
  await expect(page.locator('[data-chart-kind="analysis"]')).toBeVisible();
  await page
    .getByRole('navigation', { name: '자주 보는 지표' })
    .getByRole('link', { name: '가격 위치', exact: true })
    .click();
  await expect(page).toHaveURL(/price_source=reference/);
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const data = await (await page.request.get('/api/v1/reference?asset=DOGE&limit=2')).json();
  await expect(chart).toHaveAttribute('data-visible-from', String(data.data[0].time));
  await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('밴드 시작');
  await page.keyboard.press('Escape');
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.band-context')).toContainText('밴드 계산 전');
  await expect(page.locator('.analysis-reading-value')).not.toContainText('—');
});

test('an explicit KRW band retains its source and displays its whole traded history', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=view:rainbow&price_source=upbit&period=all');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const data = await (
    await page.request.get('/api/v1/candles?asset=DOGE&market=upbit&interval=1d&limit=2')
  ).json();
  await expect(chart).toHaveAttribute('data-visible-from', String(data.data[0].time));
  await expect(page.locator('.analysis-reading-value')).toContainText('₩');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
});

test('a young coin shows real price history while its 730-day band is pending', async ({
  page,
}) => {
  await page.goto('/coins/PENGU?metric=view:rainbow&price_source=reference&period=all');
  await expect(page.locator('[data-chart-kind="analysis"]')).toBeVisible();
  await expect(page.locator('.band-context')).toContainText('밴드 계산 전');
  await expect(page.locator('.analysis-reading-value')).not.toContainText('—');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'insufficient-history',
  );
});
