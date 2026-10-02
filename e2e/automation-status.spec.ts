import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('VPS status shows minute cadence and missing execution and backup honestly', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.route('**/api/v1/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.automation.runner = 'VPS minute scheduler';
    data.automation.stalled = false;
    data.automation.cadence.quoteSecondaryTargetSeconds = 60;
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/v1/runtime', (route) =>
    route.fulfill({
      json: {
        kind: 'vps',
        scheduler: ['quotes', 'background', 'recent', 'analysis'].map((lane) => ({
          lane,
          healthy: false,
          reason: 'no_execution_ledger',
        })),
        backup: { ok: false },
      },
    }),
  );
  await page.goto('/status');
  await expect(page.locator('.automation-summary').first()).toContainText('VPS 서버에서');
  await page.getByText('목표 주기와 운영 기준', { exact: true }).click();
  await expect(page.locator('.server-schedule')).toContainText('여덟 코인 시세 · 1분');
  const runtime = page.getByRole('region', { name: 'VPS 수집·백업 실행 기록' });
  await expect(runtime.getByText('실행 기록 없음', { exact: true })).toHaveCount(4);
  await expect(runtime).toContainText('검증된 백업 없음');
  await expect(runtime).not.toContainText('최근 실행 완료');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await runtime.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  }
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: '밝은 테마로 변경' }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .include('.automation-summary')
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.route('**/api/v1/runtime', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await runtime.getByRole('button', { name: '실행 기록 확인' }).click();
  await expect(runtime.getByRole('alert')).toContainText('실행 기록을 가져오지 못했습니다');
});

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
