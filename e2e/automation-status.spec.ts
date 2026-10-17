import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('legacy status opens the market without requesting or displaying operating diagnostics', async ({
  page,
}) => {
  const diagnostics: string[] = [];
  await page.route('**/api/v1/{status,status/**,runtime,health}', (route) => {
    diagnostics.push(route.request().url());
    return route.fulfill({
      status: 503,
      json: { error: 'Explicit failure fixture: public UI must not request this endpoint' },
    });
  });
  page.on('request', (request) => {
    if (/\/api\/v1\/(status(?:\/|\?|$)|runtime(?:\?|$)|health(?:\?|$))/.test(request.url()))
      diagnostics.push(request.url());
  });
  await page.goto('/status');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.market-home')).toBeVisible();
  await expect(page.getByRole('heading', { name: '시장', exact: true })).toBeVisible();
  await expect(page.locator('.market-coin-cell a').first()).toBeVisible();
  await expect(page.locator('.automation-summary,.server-schedule,.runtime-status')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'VPS 수집·백업 실행 기록' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '데이터 상태', exact: true })).toHaveCount(0);
  await expect(page.getByText(/48시간 기록|최장 공백|예약 기록 간격/)).toHaveCount(0);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
      ).toEqual([]);
    }
  }
  expect(diagnostics).toEqual([]);
});

test('unavailable internal runtime does not block market navigation or manufacture a health claim', async ({
  page,
}) => {
  const diagnostics: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/(status(?:\/|\?|$)|runtime(?:\?|$)|health(?:\?|$))/.test(request.url()))
      diagnostics.push(request.url());
  });
  await page.route('**/api/v1/runtime', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.route('**/api/v1/status/summary', (route) =>
    route.fulfill({
      json: {
        automation: {
          observation48h: {
            ready: false,
            recordingRate: 2876 / 2880,
            longestGapSeconds: 353,
            longestStartGapSeconds: 353,
            longestScheduledGapSeconds: 180,
          },
        },
      },
    }),
  );
  await page.goto('/status');
  await expect(page).toHaveURL(/\/$/);
  const coin = page.getByRole('link', { name: '비트코인 BTC', exact: true });
  await expect(coin).toBeVisible();
  await coin.click();
  await expect(page).toHaveURL(/\/coins\/BTC/);
  await expect(
    page.locator('.coin-dashboard-card[data-metric="view:price"] [data-chart-kind="analysis"]'),
  ).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.automation-summary')).toHaveCount(0);
  await expect(page.getByText(/운영 기준 충족|실행 기록 없음|최장 공백/)).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.market-home')).toBeVisible();
  expect(diagnostics).toEqual([]);
});
