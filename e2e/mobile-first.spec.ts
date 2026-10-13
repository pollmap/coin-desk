import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function focused(page: Page) {
  await expect(
    page.locator('.analysis-reading-date,.analysis-tools,.indicator-data-info'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '날짜로 이동', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
}

for (const width of [320, 390, 430])
  test('mobile first-use chart, unobstructed controls and market ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/')) calls.push(r.url());
    });
    await page.goto('/');
    await expect(page.locator('.market-table tbody tr')).toHaveCount(20);
    await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
    const chart = page.locator('[data-chart-kind=analysis]');
    await expect(chart).toHaveAttribute('data-primary-metric', 'price');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    await focused(page);
    expect(calls.filter((u) => /\/overview|\/themes|\/knowledge/.test(u))).toEqual([]);
    expect(calls.filter((u) => /\/market\?/.test(u))).toHaveLength(2);
    const geometry = (await chart.boundingBox())!;
    expect(geometry.y).toBeLessThanOrEqual(280);
    expect(geometry.height).toBeGreaterThanOrEqual(320);
    const controls = await page
      .locator('.indicator-toolbar :is(button,select,input)')
      .evaluateAll((nodes) =>
        nodes
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width && r.height)
          .map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
      );
    for (let i = 0; i < controls.length; i++) {
      const a = controls[i];
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(width);
      for (const b of controls.slice(i + 1))
        expect(
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 &&
            Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1,
        ).toBe(false);
    }
    const originalRange = await chart.getAttribute('data-visible-from');
    await page.getByRole('button', { name: /지표 변경$/ }).click();
    const picker = page.getByRole('dialog', { name: '지표 선택' });
    await picker.getByRole('textbox', { name: '지표 검색' }).fill('MVRV');
    await expect(picker.getByRole('link', { name: 'MVRV 배', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /지표 변경$/ })).toBeFocused();
    await expect(chart).toHaveAttribute('data-visible-from', originalRange!);
    for (const dark of [false, true]) {
      if (dark) await page.getByRole('button', { name: '어두운 테마로 변경' }).click();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
    await page.screenshot({ path: test.info().outputPath('mobile-entry-' + width + '.png') });
    await page.getByRole('link', { name: '시장', exact: true }).click();
    await expect(page.locator('.market-table tbody tr')).toHaveCount(20);
    for (const row of await page.locator('.market-table tbody tr').all())
      expect((await row.boundingBox())!.height).toBeLessThanOrEqual(76);
    const entry = (await page
      .getByRole('link', { name: '비트코인 BTC', exact: true })
      .boundingBox())!;
    expect(entry.x).toBeGreaterThanOrEqual(0);
    expect(entry.x + entry.width).toBeLessThanOrEqual(width);
    expect(entry.y).toBeLessThan(440);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

test('mobile coin, indicator, explanation, save and reopen preserve the latest analysis', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: '코인 변경 · 비트코인 BTC' }).click();
  await page.getByRole('button', { name: '도지코인 DOGE', exact: true }).click();
  await expect(chart).toHaveAttribute('data-asset', 'DOGE');
  await expect(chart).toHaveAttribute('data-primary-metric', 'price');
  await page.getByRole('button', { name: '코인 변경 · 도지코인 DOGE' }).click();
  await page.getByRole('button', { name: '온도파이낸스 ONDO', exact: true }).click();
  await expect(chart).toHaveAttribute('data-primary-metric', 'price');
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택', exact: true });
  await picker.getByRole('textbox', { name: '지표 검색' }).fill('RSI');
  await picker.getByRole('link', { name: 'RSI 14 RSI', exact: true }).click();
  await expect(chart).toHaveAttribute('data-primary-metric', 'rsi');
  await expect(chart).toHaveAttribute('data-asset', 'ONDO');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const from = await chart.getAttribute('data-visible-from');
  const latest = await page.locator('.analysis-reading-value').innerText();
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await expect(page).not.toHaveURL(/reading_date=/);
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await expect(page.locator('.indicator-explanation')).toContainText('기준선을 읽는 법');
  await expect(chart).toHaveAttribute('data-visible-from', from!);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('모바일 ONDO 검토');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('button', { name: '분석 저장 닫기', exact: true }).click();
  await page.getByRole('link', { name: '내 저장', exact: true }).click();
  await page.reload();
  await page.locator('.saved-workspaces a').filter({ hasText: '모바일 ONDO 검토' }).click();
  await expect(chart).toHaveAttribute('data-asset', 'ONDO');
  await expect(chart).toHaveAttribute('data-primary-metric', 'rsi');
  await expect(chart).toHaveAttribute('data-visible-from', from!);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await focused(page);
});

test('mobile legacy links, theme bookmarks and keyboard search retain their target', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?sort=volume&view=themes&theme=rwa');
  await expect(page.locator('.theme-row')).toHaveCount(1);
  await page.goto('/?asset=ONDO&metric=net%3Amvrv&price_source=reference');
  await expect(page.locator('[data-availability]')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(page.getByText('지표 이력을 불러오고 있습니다…')).toHaveCount(0);
  await page.getByRole('button', { name: '코인·지표 검색 열기' }).click();
  const input = page.getByRole('searchbox', { name: '코인·지표 검색', exact: true });
  await expect(input).toBeFocused();
  await input.fill('이더리움');
  await input.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-asset', 'ETH');
  await expect(input).not.toBeVisible();
  await page.getByRole('button', { name: '코인·지표 검색 열기' }).click();
  await input.press('Escape');
  await expect(page.getByRole('button', { name: '코인·지표 검색 열기' })).toBeFocused();
});

test('USD indicator retains KRW quote and latest value through legacy dates, save and refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    '/coins/BTC?metric=net:mvrv&price_source=reference&market=upbit&period=5y&reading_date=1788220800',
  );
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.detail-quote')).toContainText('Upbit · KRW');
  const latest = await page.locator('.analysis-reading-value').innerText();
  await expect(page.locator('.analysis-reading-value')).toContainText('배');
  await focused(page);
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('BTC USD + KRW');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('button', { name: '분석 저장 닫기', exact: true }).click();
  await page.getByRole('link', { name: '내 저장', exact: true }).click();
  await page.locator('.saved-workspaces a').filter({ hasText: 'BTC USD + KRW' }).click();
  await expect(page.locator('.detail-quote')).toContainText('Upbit · KRW');
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('reference');
  await focused(page);
  await page.reload();
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await focused(page);
});
