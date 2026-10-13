import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('market only loads themes on demand and restores theme/exchange after analysis', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/')) calls.push(r.url());
  });
  await page.goto('/?market=binance&sort=volume');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  expect(calls.filter((u) => /\/themes|\/knowledge|\/overview|\/network/.test(u))).toEqual([]);
  await page.getByRole('button', { name: '테마', exact: true }).click();
  await expect(page.getByLabel('정렬', { exact: true })).toHaveCount(0);
  await page
    .locator('.theme-list')
    .getByRole('button', { name: /^RWA 관련/ })
    .click();
  await expect(page.locator('.theme-row')).toHaveCount(1);
  await expect(page.locator('.theme-members').getByRole('link', { name: /온도/ })).toBeVisible();
  await expect(page.locator('.theme-row')).not.toContainText(/확인일|검토 상태|분류 근거/);
  await page.locator('.theme-row').getByRole('link', { name: /온도/ }).click();
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-asset', 'ONDO');
  await expect(page).toHaveURL(/metric=view%3Aprice/);
  await page.goBack();
  await expect(page).toHaveURL(/theme=rwa/);
  await expect(page.getByRole('button', { name: 'Binance · USDT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.theme-row')).toHaveCount(1);
  expect(calls.filter((u) => u.includes('/api/v1/themes'))).toHaveLength(1);
});

for (const width of [320, 390, 768, 1440])
  test(`legacy relationship requests preserve analysis without reopening metadata ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const calls: string[] = [];
    page.on('request', (request) => calls.push(request.url()));
    await page.goto('/coins/ONDO?metric=rsi&price_source=binance&period=1y&knowledge=1');
    const canvas = page.locator('[data-chart-kind=analysis]');
    await expect(canvas).toHaveAttribute('data-range-ready', '1');
    await expect(canvas).toHaveAttribute('data-asset', 'ONDO');
    await expect(canvas).toHaveAttribute('data-primary-metric', 'rsi');
    await expect(page).not.toHaveURL(/knowledge=1/);
    await expect(page.getByRole('button', { name: '코인·프로젝트 관계 보기' })).toHaveCount(0);
    await expect(page.locator('.knowledge-list,.react-flow')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.filter((url) => url.includes('/api/v1/knowledge'))).toEqual([]);
    const before = await canvas.getAttribute('data-visible-from');
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: /테마로 변경/ }).click();
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        scan.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) })),
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await expect(canvas).toHaveAttribute('data-visible-from', before!);
    }
    expect(new URL(page.url()).searchParams.get('price_source')).toBe('binance');
  });

test('purpose search, hover tooltip, explanation and save preserve the latest chart', async ({
  page,
}) => {
  await page.goto('/coins/BTC');
  const canvas = page.locator('[data-chart-kind=analysis]');
  await expect(canvas).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택' });
  await expect(picker.locator('a[href="/status"]')).toHaveCount(0);
  await picker.getByLabel('지표 검색').fill('시장가격 온체인');
  await expect(picker.getByRole('link', { name: 'MVRV 배', exact: true })).toBeVisible();
  await picker.getByRole('link', { name: 'MVRV 배', exact: true }).click();
  await expect(picker).not.toBeVisible();
  const hoverRect = (await canvas.boundingBox())!;
  await page.mouse.move(hoverRect.x + hoverRect.width * 0.7, hoverRect.y + 100);
  const latest = await page.locator('.analysis-reading-value').innerText();
  await expect(page.locator('.analysis-reading-date')).toHaveCount(0);
  await expect(page.getByTestId('chart-tooltip')).toContainText('배');
  await expect(page.getByRole('button', { name: '최근값 보기', exact: true })).not.toBeVisible();
  expect((await canvas.boundingBox())!.y).toBe(hoverRect.y);
  await canvas.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(page).not.toHaveURL(/reading_date=/);
  const rect = (await canvas.boundingBox())!;
  await page.mouse.click(rect.x + rect.width * 0.7, rect.y + 100);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await expect(page.locator('.analysis-reading-date,.analysis-reading-reset')).toHaveCount(0);
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await expect(page.locator('.indicator-selected-context,.indicator-provenance')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '지표 설명' })).toContainText('시가총액');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '지표 설명', exact: true })).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '지표 설명 · 읽는 법', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름').fill('가치 확인');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('link', { name: /가치 확인/ }).click();
  await expect(page.getByRole('dialog', { name: '분석 저장' })).not.toBeVisible();
  await expect(canvas).toHaveAttribute('data-primary-metric', 'net:mvrv');
});
