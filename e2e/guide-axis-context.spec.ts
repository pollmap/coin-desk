import { expect, test } from '@playwright/test';

for (const [asset, source] of [
  ['TAO', 'binance'],
  ['DRV', 'upbit'],
] as const) {
  test(`legacy ${asset} price guide retains its explicit axis on the actual default ${source} source`, async ({
    page,
  }) => {
    await page.goto(`/learn/candles?asset=${asset}&log=0`);
    await page.locator('.guide-use > summary').click();
    const link = page.locator('.guide-primary');
    await expect(link).toHaveAttribute('href', new RegExp('price_source=' + source));
    await expect(link).toHaveAttribute('href', /log=0/);
    await link.click();
    const chart = page.locator('[data-chart-kind="analysis"]');
    await expect(chart).toHaveAttribute('data-asset', asset);
    await expect(chart).toHaveAttribute('data-primary-metric', 'price');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    await expect(chart).toHaveAttribute('data-axis', 'linear');
  });
}

for (const [preset, metric, axis] of [
  ['MVRV 1배 이해하기', 'net:mvrv', 'linear'],
  ['캔들부터 읽기', 'price', 'log'],
] as const) {
  test(`fresh DOGE dictionary ${preset} opens its own default axis`, async ({ page }) => {
    await page.goto('/learn?asset=DOGE');
    await page
      .locator('.learn-presets')
      .getByRole('link', { name: new RegExp(preset) })
      .click();
    await page.locator('.guide-use > summary').click();
    await page.locator('.guide-primary').click();
    const chart = page.locator('[data-chart-kind="analysis"]');
    await expect(chart).toHaveAttribute('data-asset', 'DOGE');
    await expect(chart).toHaveAttribute('data-primary-metric', metric);
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    await expect(chart).toHaveAttribute('data-axis', axis);
    expect(new URL(page.url()).searchParams.has('log')).toBe(false);
  });
}

for (const control of ['사전 코인', '사전 가격 기준']) {
  test(`legacy direct dictionary link clears chart-owned settings when changing ${control}`, async ({
    page,
  }) => {
    await page.goto(
      '/learn/asset-rainbow?asset=BTC&metric=view:asset_rainbow&price_source=reference&log=0&rainbow_model=old-model&rainbow_origin=coinmetrics-BTC&rainbow_unit=USD',
    );
    await page.locator('.guide-use > summary').click();
    await page
      .getByRole('combobox', { name: control, exact: true })
      .selectOption(control === '사전 코인' ? 'DOGE' : 'upbit');
    await expect(page).toHaveURL(control === '사전 코인' ? /asset=DOGE/ : /price_source=upbit/);
    const link = page.locator('.guide-primary');
    await expect(link).toHaveAttribute(
      'href',
      control === '사전 코인' ? /asset=DOGE/ : /price_source=upbit/,
    );
    const query = new URL((await link.getAttribute('href'))!, 'https://bori.test').searchParams;
    expect(query.has('log')).toBe(false);
    expect(
      [...query.keys()].some(
        (key) => key.startsWith('rainbow_') || key.startsWith('guide_context_'),
      ),
    ).toBe(false);
    await link.click();
    const chart = page.locator('[data-chart-kind="analysis"]');
    await expect(chart).toHaveAttribute('data-asset', control === '사전 코인' ? 'DOGE' : 'BTC');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    await expect(chart).toHaveAttribute('data-axis', 'log');
    await expect(page).toHaveURL(
      control === '사전 코인' ? /price_source=reference/ : /price_source=upbit/,
    );
  });
}

test('a metric-free legacy axis is kept for its coin but cleared after a source change', async ({
  page,
}) => {
  await page.goto('/learn/net-mvrv?asset=DOGE&log=1');
  await page.locator('.guide-use > summary').click();
  const link = page.locator('.guide-primary');
  await expect(link).toHaveAttribute('href', /log=1/);
  await page.getByRole('combobox', { name: '사전 가격 기준', exact: true }).selectOption('upbit');
  await expect(page).toHaveURL(/price_source=upbit/);
  await expect(link).toHaveAttribute('href', /price_source=upbit/);
  expect(
    new URL((await link.getAttribute('href'))!, 'https://bori.test').searchParams.has('log'),
  ).toBe(false);
  await link.click();
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(chart).toHaveAttribute('data-axis', 'linear');
});

test('same MVRV help returns to the explicit log axis and actual visible window', async ({
  page,
}) => {
  await page.goto(
    '/coins/DOGE?asset=DOGE&metric=net:mvrv&price_source=reference&period=5y&log=1&chart_from=1704067200&chart_to=1725148800&reading_date=1711929600',
  );
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(chart).toHaveAttribute('data-axis', 'log');
  const from = await chart.getAttribute('data-visible-from');
  const to = await chart.getAttribute('data-visible-to');
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await page.locator('.guide-use > summary').click();
  await page.locator('.guide-primary').click();
  await expect(chart).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(chart).toHaveAttribute('data-axis', 'log');
  await expect(chart).toHaveAttribute('data-visible-from', from!);
  await expect(chart).toHaveAttribute('data-visible-to', to!);
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe('1711929600');
});
