import { expect, test } from '@playwright/test';

test('status explains delayed execution without declaring stable operation', async ({ page }) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
  await page.route('**/api/v1/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.automation.observation48h = {
      ...data.automation.observation48h,
      windowSatisfied: true,
      recordingRate: 2876 / 2880,
      missingRuns: 4,
      successRate: 2876 / 2880,
      failures: 0,
      unresolvedErrors: [],
      longestGapSeconds: 353,
      longestStartGapSeconds: 353,
      longestScheduledGapSeconds: 180,
      healthy: false,
      ready: false,
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto('/status');
  const summary = page.locator('.automation-summary');
  await expect(summary).toContainText('기간 충족 · 운영 확인 필요');
  await expect(summary).toContainText('기록률 99.86%');
  await expect(summary).toContainText('최장 공백 353초');
  await expect(summary).toContainText('실제 실행 간격 353초 · 예약 기록 간격 180초');
  await expect(summary).not.toContainText('운영 기준 충족');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await summary.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  }
});
