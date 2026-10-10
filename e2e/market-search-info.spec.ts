import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('a ninth favorite survives reload without altering saved private analysis', async ({
  page,
}) => {
  const stored = {
    version: 1,
    favorites: ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP', 'LINK', 'ONDO', 'PEPE'],
    workspaces: [{ name: 'saved analysis', annotations: [{ text: 'private note' }] }],
    extra: 'preserve',
  };
  await page.addInitScript((value) => {
    if (!localStorage.getItem('coin-desk.personal.v1'))
      localStorage.setItem('coin-desk.personal.v1', JSON.stringify(value));
  }, stored);
  await page.goto('/');
  await page.getByRole('textbox', { name: '시장 코인 검색' }).fill('PENGU');
  const star = page.locator('.market-table .favorite-button').first();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('coin-desk.personal.v1')!),
  );
  expect(restored).toEqual({ ...stored, favorites: [...stored.favorites, 'PENGU'] });
});

test('market defers indicator code and Enter survives slow first-time indicator search', async ({
  page,
}) => {
  const scriptCalls: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scriptCalls.push(r.url());
  });
  await page.goto('/');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  expect(
    scriptCalls.some((u) => /\/shared\/indicator-catalog\.ts|indicator-catalog-/.test(u)),
  ).toBe(false);
  let delayed = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) =>
      /\/shared\/indicator-catalog\.ts|\/assets\/indicator-catalog-[^/]+\.js/.test(url.pathname),
    async (route) => {
      delayed++;
      await blocked;
      await route.continue();
    },
  );
  const input = page.getByRole('textbox', { name: '코인·지표 검색', exact: true });
  await input.fill('MVRV');
  await expect.poll(() => delayed).toBe(1);
  await input.press('Enter');
  release();
  await expect(page).toHaveURL(/\/coins\/BTC\?.*metric=net%3Amvrv/);
  expect(delayed).toBe(1);
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute(
    'data-primary-metric',
    'net:mvrv',
  );
});

test('late indicator search does not navigate after the query is cleared', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  let release!: () => void;
  let requested = false;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) =>
      /\/shared\/indicator-catalog\.ts|\/assets\/indicator-catalog-[^/]+\.js/.test(url.pathname),
    async (route) => {
      requested = true;
      await blocked;
      await route.continue();
    },
  );
  const input = page.getByRole('textbox', { name: '코인·지표 검색', exact: true });
  await input.fill('MVRV');
  await expect.poll(() => requested).toBe(true);
  await input.press('Enter');
  await page.getByRole('button', { name: '검색 지우기', exact: true }).click();
  await expect(input).toHaveValue('');
  release();
  await page.waitForTimeout(900);
  await expect(page).toHaveURL(/\/$/);
});

test('market search prioritizes an exact ticker, Enter opens it, and clear restores the list', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '시장 코인 검색' });
  await input.fill('ETH');
  await expect(page.locator('.market-table tbody tr').first()).toContainText('이더리움');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/coins\/ETH\?/);
  await page.goBack();
  await expect(input).toHaveValue('ETH');
  await page.getByRole('button', { name: '시장 검색 지우기', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  await input.fill('펭귄');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/coins\/PENGU\?/);
  await page.getByRole('textbox', { name: '코인·지표 검색', exact: true }).fill('ETH');
  await page.getByRole('textbox', { name: '코인·지표 검색', exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/coins\/ETH\?/);
});

test('a delayed quote opens accessible timing details and returns keyboard focus without changing the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/market?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const row of data.rows) {
      if (row.quote) row.quote.time = Math.floor(Date.now() / 1000) - 900;
      if (row.asset === 'BTC') row.status = 'delayed';
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  const button = page.getByRole('button', { name: '비트코인 시세 정보', exact: true });
  await expect(button).toBeVisible();
  expect(
    (await page.locator('.market-table tbody tr').first().boundingBox())!.height,
  ).toBeLessThanOrEqual(76);
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'BTC 시세 정보' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('마지막 체결');
  await expect(dialog).toContainText('실제 거래가 있어야');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
