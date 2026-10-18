import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('beginner routes use horizontal rows and concrete teaching diagrams', async ({ page }) => {
  await page.goto('/learn?asset=DOGE&price_source=upbit&period=5y');
  const rows = page.locator('.learn-presets a');
  await expect(rows).toHaveCount(6);
  const bounds = await rows.evaluateAll((elements) =>
    elements.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  for (let i = 1; i < bounds.length; i++) {
    expect(bounds[i].x).toBe(bounds[0].x);
    expect(bounds[i].y).toBeGreaterThanOrEqual(bounds[i - 1].y + bounds[i - 1].height - 1);
  }
  await expect(page.locator('.learn-presets')).not.toContainText('BTC 평가');
  await rows.first().click();
  await expect(page.locator('[data-concept="candles"]')).toBeVisible();
  await expect(page.locator('.reading-meaning')).toContainText('시작 가격·끝 가격');
  await expect(page.locator('.guide-method li').first()).not.toBeVisible();
  await expect(page.locator('.guide-example li').first()).toBeVisible();
  await page.getByRole('link', { name: '계산식·조건', exact: true }).click();
  await expect(page.locator('.guide-method li').first()).toBeVisible();
  await expect(page.locator('#method')).toBeFocused();
  await page.goto('/learn/log-scale?asset=DOGE');
  await expect(page.locator('[data-concept="scale"]')).toBeVisible();
  await expect(page.locator('.reading-meaning')).toContainText('같은 상승·하락 비율');
  await page.goto('/learn/asset-rainbow?asset=DOGE');
  await expect(page.locator('[data-concept="bands"]')).toBeVisible();
  await expect(page.locator('.reading-distinction')).toContainText('복사한 모델이 아닙니다');
  await page.goto('/learn/btc-rainbow-original?asset=DOGE');
  await expect(page.locator('.guide-asset-note')).toContainText('DOGE에는 적용되지 않습니다');
  await expect(page.locator('.reading-distinction')).toContainText('2022년 V2');
  await expect(page.locator('[data-concept="bands"]')).toContainText('고정된 Original');
});

for (const width of [320, 390, 768, 1000, 1280, 1440, 1920]) {
  test(`beginner explanations reflow and remain accessible at ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/learn?asset=DOGE',
      '/learn/candles?asset=DOGE',
      '/learn/net-mvrv?asset=DOGE',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
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
      }
    }
    if (width === 390 || width === 1280) {
      await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
      await page.screenshot({
        path: info.outputPath(`beginner-mvrv-${width}.png`),
        fullPage: true,
      });
      await page.goto('/learn?asset=DOGE');
      await page.screenshot({
        path: info.outputPath(`beginner-list-${width}.png`),
        fullPage: true,
      });
    }
  });
}

test('application failure offers one state without a false chart action', async ({ page }) => {
  await page.route('**/api/v1/network-catalog?asset=DOGE', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.goto('/learn/net-mvrv?asset=DOGE');
  await page.locator('.guide-use > summary').click();
  await expect(page.locator('.guide-apply [role="alert"]')).toContainText('확인하지 못했습니다');
  await expect(page.locator('.guide-primary')).toHaveCount(0);
  await expect(page.locator('.guide-apply')).not.toContainText('불러오는 중');
});

test('chart help preserves the pinned date, source, visible range and explicit general axis', async ({
  page,
}) => {
  await page.goto(
    '/coins/DOGE?asset=DOGE&metric=view%3Asupertrend&price_source=upbit&period=5y&interval=1d&log=0&reading_date=1711929600&chart_from=1704067200&chart_to=1725148800',
  );
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const range = [
    await chart.getAttribute('data-visible-from'),
    await chart.getAttribute('data-visible-to'),
  ];
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  const dictionary = page.getByRole('link', { name: '현재 분석 설명', exact: true });
  await expect(dictionary).toBeVisible();
  await dictionary.click();
  const context = new URL(page.url()).searchParams;
  expect(context.get('asset')).toBe('DOGE');
  expect(context.get('log')).toBe('0');
  expect(context.get('reading_date')).toBe('1711929600');
  expect(context.get('chart_from')).toBe(range[0]);
  expect(context.get('chart_to')).toBe(range[1]);
  expect(context.get('price_source')).toBe('upbit');
  await page.locator('.guide-use > summary').click();
  await page.locator('.guide-primary').click();
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(chart).toHaveAttribute('data-visible-from', range[0]!);
  await expect(chart).toHaveAttribute('data-visible-to', range[1]!);
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe('1711929600');
  expect(new URL(page.url()).searchParams.get('log')).toBe('0');
});
