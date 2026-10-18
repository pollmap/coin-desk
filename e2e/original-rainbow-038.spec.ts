import { test, expect } from '@playwright/test';
import { ORIGINAL_RAINBOW_BASELINE } from '../shared/btc-rainbow-original';

const metric = 'view:btc_rainbow_original';
const card = '.coin-dashboard-card[data-metric="' + metric + '"]';
const chart = '[data-chart-kind="analysis"]';

test('Original is a lazy USD-only dashboard chart, with model and axis retained in focus and guide', async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?price_source=upbit');
  await expect(
    page.locator('.coin-dashboard-card[data-metric="view:price"] ' + chart),
  ).toHaveAttribute('data-range-ready', '1');
  expect(requests.filter((url) => url.includes('/rainbow/original-reference'))).toEqual([]);
  await page.locator(card).scrollIntoViewIfNeeded();
  await expect(page.locator(card + ' ' + chart)).toHaveAttribute('data-axis', 'log');
  await expect(page.locator(card + ' .coin-dashboard-card-reading')).toContainText('USD');
  await expect(
    page.locator(card).getByRole('link', { name: 'BTC 레인보우 · Original 크게 보기' }),
  ).toHaveAttribute('href', /rainbow_model=bc-original-/);
  await page
    .locator(card)
    .getByRole('button', { name: 'BTC 레인보우 · Original 축', exact: true })
    .click();
  await expect(page.locator(card + ' ' + chart)).toHaveAttribute('data-axis', 'linear');
  await page.locator(card).getByRole('link', { name: 'BTC 레인보우 · Original 크게 보기' }).click();
  await expect(page.locator('.coin-dashboard')).toHaveCount(0);
  await expect(page.locator(chart)).toHaveAttribute('data-axis', 'linear');
  await expect(page.getByText('아직 밴드를 표시할 수 없습니다.', { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('reference');
  expect(new URL(page.url()).searchParams.get('rainbow_model')).toBe(
    ORIGINAL_RAINBOW_BASELINE.modelVersion,
  );
  await page.getByRole('button', { name: '지표 설명 · 읽는 법' }).click();
  const dialog = page.getByRole('dialog', { name: '지표 설명', exact: true });
  await expect(dialog.getByText('숫자로 읽어보기', { exact: true })).toBeVisible();
  const guide = dialog.getByRole('link', { name: '현재 분석 설명' });
  await expect(guide).toHaveAttribute('href', /rainbow_model=bc-original-/);
  await expect(guide).toHaveAttribute('href', /log=0/);
  await guide.click();
  await expect(page).toHaveURL(/learn\/btc-rainbow-original/);
  await expect(
    page.getByRole('heading', { name: 'BTC 레인보우 · Original', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator(chart)).toHaveAttribute('data-axis', 'linear');
  expect(errors).toEqual([]);
});

test('an unknown saved Original model never substitutes the bundled model', async ({ page }) => {
  await page.goto(
    '/coins/BTC?metric=' +
      metric +
      '&price_source=reference&rainbow_model=bc-original-aaaaaaaaaaaa-bbbbbbbbbbbb',
  );
  await expect(page.getByText('레인보우를 불러오지 못했습니다.', { exact: true })).toBeVisible();
  await expect(page.locator(chart)).toHaveAttribute('data-range-ready', '1');
  expect(new URL(page.url()).searchParams.get('rainbow_model')).toBe(
    'bc-original-aaaaaaaaaaaa-bbbbbbbbbbbb',
  );
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  await expect(page.getByText('아직 밴드를 표시할 수 없습니다.', { exact: true })).toHaveCount(0);
});

test('DOGE keeps its own regression and rejects the BTC-only Original direct link', async ({
  page,
}) => {
  await page.goto('/coins/DOGE');
  await expect(page.locator(card)).toHaveCount(0);
  await expect(
    page.locator('.coin-dashboard-card[data-metric="view:asset_rainbow"] h2'),
  ).toHaveText('레인보우 · 자체 회귀');
  await page.goto('/coins/DOGE?metric=' + metric + '&price_source=reference');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(page.locator(chart)).toHaveCount(0);
});
