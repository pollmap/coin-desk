import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('all eight relative views use the selected pair, unit, and export name', async ({ page }) => {
  test.setTimeout(90000);
  for (const asset of ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE']) {
    const benchmark = asset === 'BTC' ? 'ETH' : 'BTC';
    await page.goto(
      `/coins/${asset}?metric=view:relative&price_source=binance&normalization=ratio`,
    );
    const lab = page.locator('[data-relative-asset]');
    await page.getByLabel('비교 설정', { exact: true }).click();
    await expect(lab).toHaveAttribute('data-relative-asset', asset);
    await expect(lab).toHaveAttribute('data-relative-benchmark', benchmark);
    await expect(page.getByRole('combobox', { name: '비교 코인', exact: true })).toHaveValue(
      benchmark,
    );
    await expect(
      page
        .getByRole('combobox', { name: '비교 코인', exact: true })
        .locator(`option[value="${asset}"]`),
    ).toHaveCount(0);
    await expect(lab.locator('.analysis-legend')).toContainText(`${benchmark}/${asset}`);
    await expect(lab.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
      'data-range-ready',
      '1',
    );
  }
  await page.getByRole('combobox', { name: '비교 코인', exact: true }).selectOption('LINK');
  await expect(page.locator('.analysis-legend')).toContainText('LINK/PEPE');
  await page.reload();
  await page.getByLabel('비교 설정', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '비교 코인', exact: true })).toHaveValue('LINK');
  await page.locator('.analysis-tools > summary').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '지표 CSV', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('borichart-PEPE-LINK-ratio-indicators.csv');
  const stream = await file.createReadStream();
  let csv = '';
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain('PEPE/LINK');
  expect(csv).toContain('LINK/PEPE');
  expect(csv).toContain('Binance');
});

test('legacy target migrates explicitly; saved pair, overwrite cancel, delete undo remain intact', async ({
  page,
}) => {
  await page.goto('/coins/ONDO?metric=view:relative&price_source=binance&correlation_asset=DOGE');
  await expect(page).toHaveURL(/coins\/DOGE\?/);
  await expect(page.locator('.indicator-notice').filter({ hasText: '이전 링크' })).toContainText(
    'DOGE·BTC',
  );
  await expect(page.locator('[data-relative-asset]')).toHaveAttribute(
    'data-relative-asset',
    'DOGE',
  );
  await page.getByLabel('비교 설정', { exact: true }).click();
  await page.getByRole('combobox', { name: '비교 코인', exact: true }).selectOption('LINK');
  await page.getByRole('button', { name: '작업공간 저장·불러오기' }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('두 코인 검토');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByLabel('비교 설정', { exact: true }).click();
  await page.getByRole('combobox', { name: '비교 코인', exact: true }).selectOption('ETH');
  await page.getByRole('button', { name: '같은 이름 덮어쓰기', exact: true }).click();
  await page.getByRole('link', { name: '내 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 저장', exact: true })).toBeVisible();
  await expect(page.locator('.saved-workspaces')).toContainText('두 코인 검토');
  await expect(page.locator('.saved-workspaces')).toContainText('Binance USDT');
  await page.getByRole('button', { name: '두 코인 검토 삭제' }).click();
  await expect(page.getByText('저장한 분석이 없습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '삭제 취소', exact: true }).click();
  await page.locator('.saved-workspaces a').filter({ hasText: '두 코인 검토' }).click();
  await page.getByLabel('비교 설정', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '비교 코인', exact: true })).toHaveValue('LINK');
});

test('brand, market timestamps and core layouts meet the compact white design', async ({
  page,
}) => {
  test.setTimeout(120000);
  for (const width of [320, 390, 768, 1000, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '주요 8코인', exact: true })).toBeVisible();
    await expect(page.locator('.market-leaders')).toHaveCount(0);
    await expect(page.locator('.market-table tbody tr')).toHaveCount(8);
    await expect(page.locator('.market-table a').filter({ hasText: /MVRV|RSI 14/ })).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto('/coins/BTC?metric=net:mvrv&price_source=upbit');
    const chart = page.locator('[data-chart-kind="analysis"]');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    expect(
      await page
        .locator('.analysis-reading-date')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    console.log(
      'geometry',
      width,
      await page.evaluate(() =>
        [
          '.topbar',
          '.asset-header',
          '.coin-context',
          '.indicator-heading',
          '.indicator-toolbar',
          '.analysis-legend',
          '[data-chart-kind="analysis"]',
        ].map((s) => {
          const e = document.querySelector(s)!;
          const r = e.getBoundingClientRect();
          return [s, r.y, r.height, getComputedStyle(e).marginBottom];
        }),
      ),
    );
    expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(width < 768 ? 300 : 240);
    if (width >= 1280) expect((await chart.boundingBox())!.height).toBeGreaterThanOrEqual(420);
    await page.screenshot({ path: test.info().outputPath(`detail-${width}.png`) });
  }
  await page.goto('/workspace');
  await expect(page.getByText('저장한 분석이 없습니다.', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '어두운 테마로 변경' }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
  }
});

test('comparison refresh keeps the actual canvas and zoom; narrow chart starts by 320px', async ({
  page,
}) => {
  await page.goto('/compare?assets=BTC,DOGE,ETH&market=upbit&period=1y');
  const chart = page.locator('.comparison-chart');
  await expect(chart).toHaveAttribute('data-render-ready', '1');
  await expect
    .poll(async () => Number(await chart.getAttribute('data-visible-from')))
    .toBeGreaterThan(0);
  for (const width of [768, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(320);
  }
  await page.evaluate(() => {
    document.querySelector('.comparison-chart canvas')!.setAttribute('data-identity', 'kept');
  });
  const before = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '데이터 다시 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '잠시 후 갱신 가능', exact: true })).toBeDisabled();
  await expect(page.getByText(/확정 일봉을 불러오고 있습니다/)).toHaveCount(0);
  await expect(chart.locator('canvas').first()).toHaveAttribute('data-identity', 'kept');
  await expect(chart).toHaveAttribute('data-visible-from', before!);
  await page.screenshot({ path: test.info().outputPath('comparison-1000.png') });
});

test('relative settings preserve chart position, focus, and guide context', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/coins/ONDO?metric=view:relative&price_source=binance&benchmark_asset=LINK');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  for (const width of [320, 390, 768, 1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const before = (await chart.boundingBox())!;
    console.log(
      'relative geometry',
      width,
      before.y,
      await page.evaluate(() =>
        [
          '.topbar',
          '.asset-header',
          '.indicator-heading',
          '.indicator-toolbar',
          '.analysis-legend',
        ].map((selector) => {
          const el = document.querySelector(selector)!;
          const box = el.getBoundingClientRect();
          return [selector, box.y, box.height];
        }),
      ),
    );
    expect(before.y).toBeLessThanOrEqual(width < 768 ? 300 : 240);
    await page.getByLabel('비교 설정', { exact: true }).click();
    await expect(page.getByLabel('비교 코인', { exact: true })).toBeVisible();
    const menu = (await page.locator('.relative-control-fields').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    expect((await chart.boundingBox())!.y).toBe(before.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('비교 설정', { exact: true })).toBeFocused();
    await expect(page.getByLabel('비교 코인', { exact: true })).not.toBeVisible();
  }
  await page.getByLabel('비교 설정', { exact: true }).click();
  await page.getByLabel('비교 기준', { exact: true }).selectOption('ratio');
  await page.getByLabel('상관 기간', { exact: true }).selectOption('365');
  await expect(page).toHaveURL(/normalization=ratio/);
  await expect(page).toHaveURL(/correlation=365/);
  await page.keyboard.press('Escape');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(300);
    expect(
      await page
        .locator('.analysis-reading-date')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await expect(page).toHaveURL(/benchmark_asset=LINK/);
  await expect(page).toHaveURL(/normalization=ratio/);
  await expect(page).toHaveURL(/correlation=365/);
});
