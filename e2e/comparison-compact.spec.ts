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
    expect((await page.locator('.comparison-controls').boundingBox())!.height).toBeLessThan(200);
    geometry.push({
      width,
      chartTop: (await chart.boundingBox())!.y,
      controlsHeight: (await page.locator('.comparison-controls').boundingBox())!.height,
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
  await page.getByText('비교 코인 · BTC · DOGE · ETH', { exact: false }).click();
  await expect(page.locator('.comparison-selection')).toHaveAttribute('open', '');
  await page.locator('.comparison-selection summary').click();
  await expect(chart).toHaveAttribute('data-visible-from', range!);
  await expect(page.locator('.comparison-coverage')).not.toHaveAttribute('open', '');
  await page.getByText('비교 기간과 코인별 수집 이력', { exact: true }).click();
  await expect(page.getByText('실제로 비교하는 기간', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '비교 CSV', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'CSV 내려받기', exact: true })).toHaveCount(0);
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

test('narrow period selector and custom dates retain exchange and share context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/compare?assets=BTC,DOGE,ETH&market=binance&period=all');
  await expect(page.locator('.comparison-chart')).toHaveAttribute('data-points', /[1-9]\d*/);
  await page.getByRole('combobox', { name: '비교 기간', exact: true }).selectOption('3m');
  await expect(page).toHaveURL(/period=3m/);
  expect(new URL(page.url()).searchParams.get('market')).toBe('binance');
  await page.getByText('날짜 직접 선택', { exact: true }).click();
  const day = 86400000,
    today = Math.floor(Date.now() / day) * day;
  const start = new Date(today - 90 * day).toISOString().slice(0, 10);
  const end = new Date(today - 30 * day).toISOString().slice(0, 10);
  await page.getByLabel('시작일 (UTC)').fill(start);
  await page.getByLabel('종료일 (UTC)').fill(end);
  await page.getByRole('button', { name: '직접 기간 적용', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('from=' + start));
  await expect(page.locator('.comparison-result .panel-title')).toContainText(start);
  await page.getByRole('button', { name: '비교 링크 복사', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '비교 화면 공유 주소' })).toHaveValue(
    new RegExp('from=' + start),
  );
  await page.reload();
  await expect(page.getByLabel('시작일 (UTC)')).toHaveValue(start);
  await expect(page.getByRole('combobox', { name: '비교 기간', exact: true })).toHaveValue(
    'custom',
  );
  await page.getByRole('button', { name: '직접 기간 해제', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '비교 기간', exact: true })).toHaveValue('3m');
});
