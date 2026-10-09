import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [320, 390, 430])
  test(`mobile first-use chart, unobstructed controls and market ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/')) calls.push(r.url());
    });
    await page.goto('/');
    await expect(page.locator('.market-table tbody tr')).toHaveCount(20);
    await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
    const chart = page.locator('[data-chart-kind=analysis]');
    await expect(chart).toHaveAttribute('data-primary-metric', 'net:mvrv');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    await page.mouse.move(0, 0);
    await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
    expect(calls.filter((u) => /\/overview|\/themes|\/knowledge/.test(u))).toEqual([]);
    expect(calls.filter((u) => /\/market\?/.test(u))).toHaveLength(2);
    const geometry = (await chart.boundingBox())!;
    expect(geometry.y).toBeLessThanOrEqual(280);
    expect(geometry.height).toBeGreaterThanOrEqual(320);
    // A control fitting the viewport is insufficient: it must also not overlap another control.
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
    await page.getByRole('button', { name: '날짜로 이동', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '차트 날짜 탐색' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '차트 날짜 탐색' })).not.toBeVisible();
    await expect(page.locator('.date-jump')).toBeFocused();
    await expect(chart).toHaveAttribute('data-visible-from', originalRange!);
    await page.getByRole('button', { name: /지표 변경$/ }).click();
    const picker = page.getByRole('dialog', { name: '지표 선택' });
    await expect(picker.getByRole('group', { name: '확인하고 싶은 내용' })).toHaveCount(0);
    await expect(picker.getByRole('link', { name: 'MVRV 배', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /지표 변경$/ })).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`mobile-entry-${width}.png`) });
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
    await page.getByRole('link', { name: '시장', exact: true }).click();
    await expect(page.locator('.market-table tbody tr')).toHaveCount(20);
    // Desktop cell heights must not double the mobile two-line row height.
    for (const row of await page.locator('.market-table tbody tr').all())
      expect((await row.boundingBox())!.height).toBeLessThanOrEqual(76);
    const analysis = page.getByRole('link', { name: '비트코인 BTC', exact: true });
    const entry = (await analysis.boundingBox())!;
    expect(entry.x).toBeGreaterThanOrEqual(0);
    expect(entry.x + entry.width).toBeLessThanOrEqual(width);
    expect(entry.y).toBeLessThan(440);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await analysis.click();
    await expect(chart).toHaveAttribute('data-primary-metric', 'net:mvrv');
  });

test('mobile coin, indicator, date, explanation, save and reopen keep the same analysis', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(20);
  await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: '코인 변경 · 비트코인 BTC' }).click();
  await page.getByRole('button', { name: '도지코인 DOGE', exact: true }).click();
  await expect(chart).toHaveAttribute('data-asset', 'DOGE');
  await expect(chart).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await page.getByRole('button', { name: '코인 변경 · 도지코인 DOGE' }).click();
  await page.getByRole('button', { name: '온도파이낸스 ONDO', exact: true }).click();
  await expect(chart).toHaveAttribute('data-primary-metric', 'rsi');
  await expect(chart).toHaveAttribute('data-asset', 'ONDO');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: '날짜로 이동', exact: true }).click();
  await page.getByLabel('이동할 날짜 (UTC)', { exact: true }).fill('2026-09-01');
  await page.getByRole('button', { name: '이동', exact: true }).click();
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  const from = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '지표 설명', exact: true }).click();
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
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  await expect(page.locator('.analysis-reading-date')).toContainText('2026-09-01');
  await page.reload();
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
});

test('mobile explicit legacy links, market bookmarks and search retain their intent', async ({
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
  const input = page.getByRole('textbox', { name: '코인·지표 검색', exact: true });
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

test('USD indicator keeps its KRW quote and pinned date through save, share and refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(20);
  await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.detail-quote')).toContainText('Upbit · KRW');
  await page.getByRole('button', { name: '날짜로 이동', exact: true }).click();
  await page.getByLabel('이동할 날짜 (UTC)', { exact: true }).fill('2026-09-01');
  await page.getByRole('button', { name: '이동', exact: true }).click();
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  const selectedValue = await page.locator('.analysis-reading-value').innerText();
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('BTC USD + KRW');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('button', { name: '분석 저장 닫기', exact: true }).click();
  await page.getByRole('link', { name: '내 저장', exact: true }).click();
  await page.locator('.saved-workspaces a').filter({ hasText: 'BTC USD + KRW' }).click();
  await expect(page.locator('.detail-quote')).toContainText('Upbit · KRW');
  await expect(page.locator('.analysis-reading-date')).toContainText('2026-09-01');
  await expect(page.locator('.analysis-reading-value')).toHaveText(selectedValue);
  await page.locator('details.analysis-tools > summary').click();
  await page.getByRole('button', { name: '링크 공유', exact: true }).click();
  const shared = await page.getByLabel('공유 주소', { exact: true }).inputValue();
  expect(new URL(shared).searchParams.get('reading_date')).toBe('1788220800');
  await page.goto(shared);
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  await expect(page.locator('.analysis-reading-value')).toHaveText(selectedValue);
  await page.reload();
  await expect(page.locator('.detail-quote')).toContainText('Upbit · KRW');
  await expect(page.locator('.analysis-reading-date')).toContainText('2026-09-01');
  await page.getByRole('button', { name: '최근값 보기', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
  await page.locator('details.analysis-tools > summary').click();
  await page.getByRole('button', { name: '링크 공유', exact: true }).click();
  expect(
    new URL(await page.getByLabel('공유 주소', { exact: true }).inputValue()).searchParams.has(
      'reading_date',
    ),
  ).toBe(false);
});
