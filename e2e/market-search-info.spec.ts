import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('market has shared keyboard styles before analysis code is loaded', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  const skip = page.getByRole('link', { name: '본문으로 바로가기', exact: true });
  expect((await skip.boundingBox())!.y).toBeLessThan(0);
  // Windows WebKit does not expose Safari's full keyboard access preference.
  // Verify focus/activation there; traverse the actual Tab order in Chromium.
  if (browserName === 'webkit') await skip.focus();
  else await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.locator('.topbar .product-search')).toHaveCount(0);
  const search = page.getByRole('button', { name: '시장 코인 검색', exact: true });
  await expect(search).toHaveCount(1);
  await search.focus();
  await page.keyboard.press('/');
  const dialog = page.getByRole('dialog', { name: '코인·지표 검색', exact: true });
  await expect(dialog).toHaveCount(1);
  const input = dialog.getByRole('searchbox', { name: '코인·지표 검색', exact: true });
  await expect(input).toBeFocused();
  await input.fill('비트코인');
  await expect(dialog.locator('.search-hit').first()).toContainText('BTC');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(search).toBeFocused();
  await page.goto('/coins?market=binance&sort=volume');
  await expect(page.locator('.topbar .product-search')).toHaveCount(0);
  await filterMarket(page, '펭귄');
  const filtered = new URL(page.url());
  expect(filtered.pathname).toBe('/coins');
  expect(filtered.searchParams.get('market')).toBe('binance');
  expect(filtered.searchParams.get('sort')).toBe('volume');
  expect(filtered.searchParams.get('q')).toBe('펭귄');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.market-table tbody tr')).toContainText('PENGU');
});

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
  await filterMarket(page, 'PENGU');
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
    (url) => url.pathname === '/api/v1/search',
    async (route) => {
      delayed++;
      await blocked;
      await route.continue();
    },
  );
  await page.getByRole('button', { name: '시장 코인 검색', exact: true }).click();
  const input = page.getByRole('searchbox', { name: '코인·지표 검색', exact: true });
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
    (url) => url.pathname === '/api/v1/search',
    async (route) => {
      requested = true;
      await blocked;
      await route.continue();
    },
  );
  await page.getByRole('button', { name: '시장 코인 검색', exact: true }).click();
  const input = page.getByRole('searchbox', { name: '코인·지표 검색', exact: true });
  await input.fill('MVRV');
  await expect.poll(() => requested).toBe(true);
  await input.press('Enter');
  await input.fill('');
  await expect(input).toHaveValue('');
  release();
  await page.waitForTimeout(900);
  await expect(page).toHaveURL(/\/$/);
});

test('market exact search filters, clears and opens a coin through the same search sheet', async ({
  page,
}) => {
  await page.goto('/');
  await filterMarket(page, 'ETH');
  await expect(page.locator('.market-table tbody tr').first()).toContainText('이더리움');
  await page.locator('.market-table tbody tr').first().locator('.market-coin-cell a').click();
  await expect(page).toHaveURL(/\/coins\/ETH\?/);
  await page.goBack();
  await expect(page.getByRole('button', { name: '시장 코인 검색', exact: true })).toContainText(
    'ETH',
  );
  await page.getByRole('button', { name: '시장 검색 지우기', exact: true }).click();
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  await page.getByRole('button', { name: '시장 코인 검색', exact: true }).click();
  const input = page.getByRole('searchbox', { name: '코인·지표 검색', exact: true });
  await input.fill('펭귄');
  await expect(page.locator('.search-hit').first()).toContainText('PENGU');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/coins\/PENGU/);
});

test('a delayed quote keeps its price and a noninteractive warning without timing metadata', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Explicit unavailable-stream fixture: no real new trade may overwrite the
  // old snapshot while testing its unchanged 300-second freshness policy.
  await page.addInitScript(() => {
    class UnavailableSource extends EventTarget {
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        super();
        queueMicrotask(() => this.onerror?.());
      }
      close() {}
    }
    Object.assign(window, { EventSource: UnavailableSource });
  });
  await page.route('**/api/v1/market?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const row of data.rows) {
      if (row.quote) {
        row.quote.time = Math.floor(Date.now() / 1000) - 900;
        if (row.quote.timestampKind === 'trade') row.quote.actualTradeAt = row.quote.time;
      }
      if (row.asset === 'BTC') row.status = 'delayed';
    }
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  const row = page
    .locator('.market-table tbody tr')
    .filter({ has: page.getByRole('link', { name: '비트코인 BTC', exact: true }) });
  await expect(row.locator('.market-quote-status')).toHaveText('지연');
  await expect(row.locator('.market-price-cell')).toContainText('₩84,000,000');
  await testInfo.attach('delayed-row-boxes.json', {
    body: Buffer.from(
      JSON.stringify(
        await row.evaluate((element) =>
          [
            element,
            ...element.querySelectorAll(
              '.market-price-cell,.market-price-cell > a,.market-quote-status,.market-change-cell',
            ),
          ].map((node) => {
            const box = node.getBoundingClientRect(),
              css = getComputedStyle(node);
            return {
              tag: node.tagName,
              class: node.className,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              display: css.display,
              minHeight: css.minHeight,
              lineHeight: css.lineHeight,
              fontSize: css.fontSize,
              paddingBlock: css.paddingBlock,
              marginTop: css.marginTop,
              gap: css.gap,
              cursor: css.cursor,
            };
          }),
        ),
      ),
    ),
    contentType: 'application/json',
  });
  await expect(row.locator('.market-price-cell > a')).toHaveCSS('display', 'block');
  await expect(row.locator('.market-quote-status')).toHaveCSS('margin-top', '0px');
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(76);
  await expect(page.getByRole('button', { name: '비트코인 시세 정보', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('dialog', { name: 'BTC 시세 정보' })).toHaveCount(0);
  await expect(row.locator('.market-quote-status')).not.toHaveAttribute('tabindex');
  await expect(row.locator('.market-quote-status')).toHaveCSS('cursor', 'default');
  await expect(row.locator('.market-quote-status')).toHaveCSS('text-decoration-line', 'none');
  await expect(
    page.locator('.market-feed-state,.market-runtime-notice,.market-data-note'),
  ).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function filterMarket(page: import('@playwright/test').Page, query: string) {
  await page.getByRole('button', { name: '시장 코인 검색', exact: true }).click();
  await page.getByRole('searchbox', { name: '코인·지표 검색', exact: true }).fill(query);
  await page.getByRole('link', { name: '목록에서 보기', exact: true }).click();
}
