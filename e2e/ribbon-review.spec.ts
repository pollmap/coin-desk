import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('ribbon settings preserve the selected date window and survive reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?asset=BTC&price_source=reference&period=all&visual=ribbon');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const from = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '리본 설정', exact: true }).click();
  await page.getByRole('button', { name: /빠른 반응/ }).click();
  await page.getByRole('button', { name: '차트에 적용', exact: true }).click();
  await expect(page.locator('.analysis-legend')).toContainText('EMA 89봉');
  await expect(chart).toHaveAttribute('data-visible-from', from!);
  await page.reload();
  await expect(page.locator('.analysis-legend')).toContainText('EMA 8봉');
  await page.getByRole('button', { name: '리본 설정', exact: true }).click();
  await page.getByLabel('리본 기간').fill('7, 7');
  await page.getByRole('button', { name: '차트에 적용', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('중복');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '리본 설정', exact: true })).toBeFocused();
  for (const width of [320, 390, 768, 1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', { name: '리본 설정', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (width === 390)
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
          .violations,
      ).toEqual([]);
    await page.keyboard.press('Escape');
  }
});

test('private review queue supports multiword search, authors, virtual keyboard navigation and applicable image review', async ({
  page,
}) => {
  await page.goto('/workspace/library');
  const rows = Array.from({ length: 40 }, (_, i) => ({
    post_id: String(10000 + i),
    account: i % 2 ? 'beta' : 'alpha',
    text: `BTC moving average ${i}`,
    date_utc: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    images: i % 2 ? [{ url: 'https://pbs.twimg.com/media/fixture.jpg' }] : [],
  }));
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'review.jsonl',
      mimeType: 'application/x-ndjson',
      buffer: Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n')),
    });
  await expect(page.locator('.library-heading')).toContainText('40건');
  const list = page.getByRole('listbox', { name: '개인 자료 목록' });
  await list.focus();
  await page.keyboard.press('End');
  await expect(page.locator('.original-text')).toHaveText('BTC moving average 0');
  await expect(list.getByRole('option', { selected: true })).toHaveAttribute('aria-posinset', '40');
  await page.keyboard.press('Home');
  await expect(page.locator('.original-text')).toHaveText('BTC moving average 39');
  await page.getByLabel('자료 검토 상태').selectOption('images');
  await expect(page.locator('.library-search')).toContainText('20건');
  await page.getByLabel('자료 작성자').selectOption('alpha');
  await expect(page.locator('.library-search')).toContainText('0건');
  await page.getByLabel('자료 검토 상태').selectOption('text');
  await page.getByRole('searchbox', { name: '개인 자료 검색' }).fill('moving btc 38');
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.getByRole('option').click();
  await page.getByLabel('본문 확인', { exact: true }).check();
  await expect(list.getByRole('option')).toHaveCount(0);
  await expect(page.locator('.library-review-nav')).toContainText('현재 필터 밖의 자료');
  await page.getByRole('button', { name: '자료 닫기', exact: true }).click();
  await expect(page.getByLabel('선택 자료')).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('missing extension cannot appear connected and wrong handshake is ignored', async ({
  page,
}) => {
  await page.goto('/workspace/library');
  await page.getByRole('button', { name: 'Chrome 연결', exact: true }).click();
  await expect(page.locator('.library-status')).toContainText('응답 대기');
  await page.evaluate(() =>
    window.postMessage({ type: 'CD_LIBRARY_READY', nonce: 'wrong' }, location.origin),
  );
  await expect(page.getByRole('button', { name: 'Chrome 연결 종료' })).toHaveCount(0);
  await expect(page.locator('.library-status')).toContainText('확장 응답이 없습니다', {
    timeout: 15000,
  });
});
