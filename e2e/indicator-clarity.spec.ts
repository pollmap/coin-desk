import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { guideForMetric } from '../shared/learning-catalog';

async function noOperationalUi(page: Page) {
  await expect(
    page.locator('.analysis-reading-date,.indicator-provenance,.chart-readings-table'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '최근값 보기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CSV|내보내기|공유/ })).toHaveCount(0);
}
async function zoom(page: Page) {
  const chart = page.locator('[data-chart-kind="analysis"]');
  const before = await chart.getAttribute('data-visible-from');
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -320);
  await expect(chart).not.toHaveAttribute('data-visible-from', before!);
  return chart.getAttribute('data-visible-from');
}

test('latest summary stays stable while exploring and worked help preserves the visible window', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=net%3Amvrv&period=1y&price_source=upbit');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const latest = await page.locator('.analysis-reading-value').innerText();
  const window = await zoom(page);
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await expect(page.getByTestId('chart-tooltip')).toBeVisible();
  await expect(page.getByTestId('chart-tooltip')).toContainText('BTC');
  await expect(page.getByTestId('chart-tooltip')).not.toHaveText(/\d{4}-\d{2}-\d{2}/);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  await noOperationalUi(page);
  await expect(page.locator('.indicator-method')).toHaveCount(0);
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  const explanation = page.getByRole('dialog', { name: '지표 설명', exact: true });
  await expect(explanation.locator('.indicator-method').first()).toContainText(
    '150 / 실현시가총액 100 = 1.5배',
  );
  await explanation.getByText('계산식·기호', { exact: true }).click();
  await expect(
    explanation.locator('details').filter({ has: page.getByText('계산식·기호', { exact: true }) }),
  ).toContainText('실현시가총액');
  await expect(
    explanation.locator('dd').filter({ hasText: '실제 매수한 금액의 합계는 아닙니다' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(explanation).not.toBeVisible();
  await expect(chart).toHaveAttribute('data-visible-from', window!);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await explanation.getByText('주의할 점', { exact: true }).click();
  await expect(explanation).toContainText(guideForMetric('net:mvrv')!.caution);
  await page.screenshot({ path: test.info().outputPath('mvrv-method.png'), fullPage: true });
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MVRV', exact: true })).toBeVisible();
  await expect(page.locator('.guide-terms dt').filter({ hasText: /^실현시가총액$/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
});

test('manual zoom and an explicit legacy reading date survive chart resizing without changing the latest summary', async ({
  page,
}) => {
  await page.goto(
    '/coins/BTC?metric=net%3Amvrv&period=1y&price_source=upbit&reading_date=1700006400',
  );
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const latest = await page.locator('.analysis-reading-value').innerText();
  const window = await zoom(page);
  const canvas = chart.locator('canvas').first();
  const width = await canvas.getAttribute('width');
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(canvas).not.toHaveAttribute('width', width!);
  await expect(chart).toHaveAttribute('data-visible-from', window!);
  await chart.press('Home');
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe('1700006400');
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await noOperationalUi(page);
});

test('coin changes open the active purpose and empty purposes offer an alternative', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=net%3Amvrv&price_source=upbit');
  await expect(page.locator('[data-chart-kind="analysis"]')).toBeVisible();
  await page.getByRole('button', { name: '코인 변경 · 비트코인 BTC' }).click();
  await page.getByRole('button', { name: '온도파이낸스 ONDO', exact: true }).click();
  await expect(page.locator('[data-primary-metric="price"]')).toBeVisible();
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택' });
  await expect(picker.getByRole('combobox', { name: '지표 목적' })).toHaveValue('가격과 추세');
  await picker.getByRole('combobox', { name: '지표 목적' }).selectOption('네트워크 활동');
  await expect(picker.getByRole('status')).toContainText(
    'ONDO에 제공하는 네트워크 활동 지표가 없습니다',
  );
  await page.screenshot({ path: test.info().outputPath('unsupported-onchain.png') });
  await picker.getByRole('button', { name: '가격으로 계산하는 지표 보기' }).click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('link', { name: 'RSI 14 RSI', exact: true })).toBeVisible();
  await picker.getByRole('textbox', { name: '지표 검색' }).fill('not-a-metric');
  await expect(picker.getByRole('status')).toContainText('not-a-metric');
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(page.getByRole('button', { name: /지표 변경$/ })).toBeFocused();
});

test('source dates remain separate API metadata while narrow screens show only values', async ({
  page,
}) => {
  const inputs: { asset: string | null; observed: number; sourceDate: number }[] = [];
  await page.route('**/api/v1/candles?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.data?.length) {
      const observed = data.data.at(-1).time;
      data.meta.dataAsOf = observed + 86400;
      inputs.push({
        asset: new URL(route.request().url()).searchParams.get('asset'),
        observed,
        sourceDate: data.meta.dataAsOf,
      });
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto('/coins/ONDO?metric=rsi&price_source=upbit');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(chart).toHaveAttribute('data-primary-metric', 'rsi');
  expect(inputs.length).toBeGreaterThan(0);
  expect(inputs.every((i) => i.asset === 'ONDO' && i.sourceDate - i.observed === 86400)).toBe(true);
  const latest = await page.locator('.analysis-reading-value').innerText();
  for (const width of [320, 390, 768, 1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await chart.press('ArrowLeft');
    await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
    expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
    await noOperationalUi(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
