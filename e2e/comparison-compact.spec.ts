import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('compact comparison keeps the chart first and settings preserve its range', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/compare?assets=BTC,DOGE,ETH&market=upbit&period=1y');
  const chart = page.locator('.comparison-chart');
  await expect(chart).toHaveAttribute('data-points', /[1-9]\d*/);
  const geometry: { width: number; chartTop: number; controlsHeight: number }[] = [];
  for (const width of [320, 390, 810, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.comparison-selection')).not.toHaveAttribute('open', '');
    // Even with a stale-source warning, show at least 200px of the comparison chart on entry.
    // Indicator-detail placement is covered by its separate acceptance test.
    await expect
      .poll(async () => (await chart.boundingBox())!.y)
      .toBeLessThan(page.viewportSize()!.height - 200);
    expect((await page.locator('.comparison-settings').boundingBox())!.height).toBeLessThan(200);
    geometry.push({
      width,
      chartTop: (await chart.boundingBox())!.y,
      controlsHeight: (await page.locator('.comparison-settings').boundingBox())!.height,
    });
    await page.screenshot({
      path: test.info().outputPath('comparison-' + width + '.png'),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await test
    .info()
    .attach('layout', { body: JSON.stringify(geometry), contentType: 'application/json' });
  const range = await chart.getAttribute('data-visible-from');
  await page.locator('.comparison-settings > summary').click();
  await page.getByText('비교 코인 · BTC · DOGE · ETH', { exact: false }).click();
  await expect(page.locator('.comparison-selection')).toHaveAttribute('open', '');
  await page.locator('.comparison-selection summary').click();
  await expect(chart).toHaveAttribute('data-visible-from', range!);
  await expect(
    page.locator('.comparison-coverage,.comparison-share,.comparison-share-result'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /비교 CSV|CSV 내려받기|비교 링크 복사/ }),
  ).toHaveCount(0);
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '어두운 테마로 변경' }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .include('.comparison-page')
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.screenshot({ path: test.info().outputPath('comparison-compact.png'), fullPage: true });
});

test('narrow period selection and legacy date URLs preserve the exchange without public date or share widgets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/compare?assets=BTC,DOGE,ETH&market=binance&period=all');
  await expect(page.locator('.comparison-chart')).toHaveAttribute('data-points', /[1-9]\d*/);
  await page.locator('.comparison-settings > summary').click();
  await page.getByRole('combobox', { name: '비교 기간', exact: true }).selectOption('3m');
  await expect(page).toHaveURL(/period=3m/);
  expect(new URL(page.url()).searchParams.get('market')).toBe('binance');
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '비교 링크 복사', exact: true })).toHaveCount(0);
  const day = 86400000,
    today = Math.floor(Date.now() / day) * day;
  const start = new Date(today - 90 * day).toISOString().slice(0, 10);
  const end = new Date(today - 30 * day).toISOString().slice(0, 10);
  await page.goto(`/compare?assets=BTC,DOGE,ETH&market=binance&period=3m&from=${start}&to=${end}`);
  const chart = page.locator('.comparison-chart');
  await expect(chart).toHaveAttribute('data-render-ready', '1');
  await expect(chart).toHaveAttribute('data-expected-from', String(Date.parse(start) / 1000));
  await expect(chart).toHaveAttribute('data-expected-to', String(Date.parse(end) / 1000));
  await page.reload();
  await expect(chart).toHaveAttribute('data-render-ready', '1');
  await expect(chart).toHaveAttribute('data-expected-from', String(Date.parse(start) / 1000));
  await page.locator('.comparison-settings > summary').click();
  await expect(page.getByRole('combobox', { name: '비교 기간', exact: true })).toHaveValue(
    'custom',
  );
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: '비교 기간', exact: true }).selectOption('3m');
  await expect(page).not.toHaveURL(/from=|to=/);
  expect(new URL(page.url()).searchParams.get('market')).toBe('binance');
  await expect(page.getByRole('combobox', { name: '비교 기간', exact: true })).toHaveValue('3m');
});
