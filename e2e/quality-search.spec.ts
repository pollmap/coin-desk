import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('market geometry and unified search remain compact at every width', async ({ page }) => {
  for (const width of [320, 390, 768, 1000, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const row = page.locator('.market-table tbody tr').first();
    await expect(row).toBeVisible();
    if (width === 390) expect((await row.boundingBox())!.y).toBeLessThanOrEqual(280);
    const position = (await row.boundingBox())!.y;
    const trigger = page.getByRole('button', { name: '시장 코인 검색', exact: true });
    await trigger.click();
    const input = page.getByRole('searchbox', { name: '코인·지표 검색' });
    await expect(input).toBeFocused();
    await input.fill('비트코인 고평가');
    await expect(page.locator('.search-hit').first()).toContainText('MVRV');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect.poll(async () => (await row.boundingBox())!.y).toBe(position);
  }
});

test('search preserves explicit viewing context and pending request cannot cross assets', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=rsi&price_source=upbit&period=1y');
  await page.getByRole('button', { name: '코인·지표 검색 열기' }).click();
  const input = page.getByRole('searchbox', { name: '코인·지표 검색' });
  await input.fill('펭귄 추세');
  await expect(page.locator('.search-hit').first()).toContainText('RSI');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/coins\/PENGU\?/);
  expect(new URL(page.url()).searchParams.get('period')).toBe('1y');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-asset', 'PENGU');
});

test('status loads a small summary before bounded source pages', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/status')) calls.push(r.url());
  });
  await page.goto('/status');
  await expect(page.locator('.automation-summary')).toContainText('데이터 원천 상태');
  expect(calls.some((u) => u.includes('/status/summary'))).toBe(true);
  expect(calls.some((u) => u.includes('/status/sources'))).toBe(false);
  expect(calls.some((u) => new URL(u).pathname === '/api/v1/status')).toBe(false);
  await page.getByRole('button', { name: '원천별 상태 보기' }).click();
  await expect.poll(() => calls.some((u) => u.includes('/status/sources'))).toBe(true);
  await expect(page.locator('.status-table tbody tr')).not.toHaveCount(0);
  expect(await page.locator('.status-table tbody tr').count()).toBeLessThanOrEqual(50);
});

test('search explanations preserve context and relation links open their evidence', async ({ page }) => {
  await page.goto('/coins/DOGE?metric=rsi&price_source=upbit&period=1y');
  await page.getByRole('button', { name: '코인·지표 검색 열기' }).click();
  await page.getByRole('searchbox', { name: '코인·지표 검색' }).fill('MVRV');
  const guide = page.locator('.search-hit[href^="/learn/"]').first();
  await expect(guide).toBeVisible();
  const href = new URL((await guide.getAttribute('href'))!, page.url());
  expect(href.searchParams.get('asset')).toBe('DOGE');
  expect(href.searchParams.get('period')).toBe('1y');
  expect(href.searchParams.get('price_source')).toBe('upbit');
  await page.keyboard.press('Escape');
  await page.goto('/coins/AAVE?metric=rsi&knowledge=1');
  await expect(page.getByRole('dialog', { name: 'AAVE 관계와 근거' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('발행 네트워크');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('search sheet supports dark/light contrast, keyboard and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '어두운 테마로 변경' }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '코인·지표 검색 열기' }).click();
    await page.getByRole('searchbox', { name: '코인·지표 검색' }).fill('MVRV');
    await expect(page.locator('.search-hit').first()).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
    await page.keyboard.press('Escape');
  }
});
