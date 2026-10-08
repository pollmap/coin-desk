import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function waitForSelectedDateInView(page: Page) {
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect
    .poll(async () => {
      const label = await page.locator('.analysis-reading-date').innerText();
      const date = label.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC/);
      if (!date) return false;
      const selected = Date.parse(date[1] + 'T' + date[2] + ':00Z') / 1000;
      const from = Number(await chart.getAttribute('data-visible-from'));
      const to = Number(await chart.getAttribute('data-visible-to'));
      return selected >= from && selected <= to;
    })
    .toBe(true);
}

test('historical readings can return to latest without changing the chart window; help has a worked example', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=net%3Amvrv&period=1y&price_source=upbit');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
  const initial = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '구간·확대', exact: true }).click();
  await page.getByRole('button', { name: '차트 확대', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(chart).not.toHaveAttribute('data-visible-from', initial!);
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  // Keyboard selection may pan to bring the chosen observation into view.
  // Resetting the reading must preserve that actual user-visible window.
  // The reading label updates before Lightweight Charts publishes its new range.
  // Wait for that actual pan, rather than comparing against the preceding frame.
  await waitForSelectedDateInView(page);
  const window = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '최근값 보기', exact: true }).click();
  await expect(chart).toBeFocused();
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
  await expect(chart).toHaveAttribute('data-visible-from', window!);
  await expect(page.locator('.indicator-method')).toHaveCount(0);
  await page.getByText('읽는 법 · 계산식 · 데이터 범위', { exact: true }).click();
  await expect(page.locator('.indicator-method')).toContainText('실현시가총액');
  await expect(page.locator('.indicator-method')).toContainText('150 / 실현시가총액 100 = 1.5배');
  await expect(page.locator('.indicator-method')).toContainText(
    '실제 매수한 금액의 합계는 아닙니다',
  );
  await page.screenshot({ path: test.info().outputPath('mvrv-method.png'), fullPage: true });
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MVRV', exact: true })).toBeVisible();
  await expect(page.getByText('실현시가총액', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
});

test('keyboard panning before a manual zoom survives a chart resize', async ({ page }) => {
  await page.goto('/coins/BTC?metric=net%3Amvrv&period=1y&price_source=upbit');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  await waitForSelectedDateInView(page);
  const window = await chart.getAttribute('data-visible-from');
  const canvas = chart.locator('canvas').first();
  const width = await canvas.getAttribute('width');
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(canvas).not.toHaveAttribute('width', width!);
  await waitForSelectedDateInView(page);
  await expect(chart).toHaveAttribute('data-visible-from', window!);
});

test('coin changes open the active indicator group and empty categories offer an alternative', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=net%3Amvrv&price_source=upbit');
  await expect(page.locator('[data-chart-kind="analysis"]')).toBeVisible();
  await page.getByRole('button', { name: '코인 변경 · 비트코인 BTC' }).click();
  await page.getByRole('button', { name: '온도파이낸스 ONDO', exact: true }).click();
  await expect(page.locator('[data-primary-metric="rsi"]')).toBeVisible();
  await page.getByRole('button', { name: '지표 변경', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택' });
  await expect(picker.getByRole('button', { name: '기술·성과', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: '온체인', exact: true }).click();
  await expect(picker.getByRole('status')).toContainText(
    'ONDO의 온체인 지표는 현재 확보한 원천이 없습니다',
  );
  await page.screenshot({ path: test.info().outputPath('unsupported-onchain.png') });
  await picker.getByRole('button', { name: '가격으로 계산하는 지표 보기' }).click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('link', { name: 'RSI 14 RSI', exact: true })).toBeVisible();
  await picker.getByRole('textbox', { name: '지표 검색' }).fill('not-a-metric');
  await expect(picker.getByRole('status')).toContainText('not-a-metric');
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(page.getByRole('button', { name: '지표 변경', exact: true })).toBeFocused();
});

test('source date and chart observation date are distinct; the reading toolbar fits narrow screens', async ({
  page,
}) => {
  await page.route('**/api/v1/candles?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.data?.length) data.meta.dataAsOf = data.data.at(-1).time + 86400;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/coins/ONDO?metric=rsi&price_source=upbit');
  await expect(page.locator('[data-primary-metric="rsi"]')).toBeVisible();
  await expect(page.locator('.indicator-provenance')).toContainText('원천 기준');
  await expect(page.locator('.indicator-provenance')).toContainText('차트 최근 관측');
  for (const width of [320, 390, 768, 1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-chart-kind="analysis"]').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('button', { name: '최근값 보기', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '최근값 보기', exact: true }).click();
  }
});
