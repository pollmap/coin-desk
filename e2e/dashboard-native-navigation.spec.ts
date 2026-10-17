import { test as base, expect } from '@playwright/test';

// Native background-tab navigation needs the real Chromium implementation.
// Headless shell can load the new document without exposing its Page object.
// Keep all other tests and the WebKit project on their existing browser setup.
const test = base.extend({
  channel: [
    async ({ browserName }, use) => {
      await use(browserName === 'chromium' ? 'chromium' : undefined);
    },
    { scope: 'worker' },
  ],
});

const mvrvCard = '.coin-dashboard-card[data-metric="net:mvrv"]';
const chart = '[data-chart-kind="analysis"]';

for (const restored of [false, true])
  test(`comparison links carry the current zoom through native navigation, restored=${restored}`, async ({
    page,
    context,
  }) => {
    const params = new URLSearchParams({ dashboard_cards: 'net:mvrv', period: 'all' });
    if (restored) {
      const today = Math.floor(Date.now() / 86400000) * 86400;
      params.set(
        'dashboard_ranges',
        JSON.stringify({ 'net:mvrv': { from: today - 240 * 86400, to: today - 60 * 86400 } }),
      );
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/coins/BTC?' + params);
    const plot = page.locator(`${mvrvCard} ${chart}`);
    await expect(plot).toHaveAttribute('data-range-ready', '1');
    const canvas = await plot.locator('canvas').first().elementHandle();
    const before = await plot.getAttribute('data-visible-from');
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.65, box.y + 120);
    await page.mouse.wheel(0, -350);
    await expect(plot).not.toHaveAttribute('data-visible-from', before!);
    const from = await plot.getAttribute('data-visible-from');
    const to = await plot.getAttribute('data-visible-to');
    const link = page.locator(mvrvCard).getByRole('link', { name: '같은 지표 비교', exact: true });
    const hrefWindow = async () => {
      const url = new URL((await link.getAttribute('href'))!, page.url());
      return [url.searchParams.get('chart_from'), url.searchParams.get('chart_to')];
    };
    await expect.poll(hrefWindow).toEqual([from, to]);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    const expanded = new URL(
      (await page
        .locator(mvrvCard)
        .getByRole('link', { name: 'MVRV 크게 보기' })
        .getAttribute('href'))!,
      page.url(),
    );
    expect(expanded.searchParams.get('chart_from')).toBe(from);
    expect(expanded.searchParams.get('chart_to')).toBe(to);
    // Native middle-click handling differs by browser port. Inspect the actual
    // destination, whether a new tab or this tab, without weakening its range.
    const existingTabs = new Set(context.pages());
    const destination = () =>
      context
        .pages()
        .find(
          (candidate) =>
            (candidate === page || !existingTabs.has(candidate)) &&
            new URL(candidate.url()).pathname === '/compare',
        );
    if (restored) await link.click({ button: 'middle' });
    else await link.click({ modifiers: ['Control'] });
    await expect.poll(() => Boolean(destination())).toBe(true);
    const tab = destination()!;
    await expect(tab.locator(chart)).toHaveAttribute('data-range-ready', '1');
    await expect(tab.locator(chart)).toHaveAttribute('data-visible-from', from!);
    await expect(tab.locator(chart)).toHaveAttribute('data-visible-to', to!);
    expect(new URL(tab.url()).searchParams.get('chart_from')).toBe(from);
    expect(new URL(tab.url()).searchParams.get('chart_to')).toBe(to);
    if (tab === page) {
      await page.goBack();
      await expect(plot).toHaveAttribute('data-visible-from', from!);
      await expect(plot).toHaveAttribute('data-visible-to', to!);
    } else {
      await tab.close();
      await page.bringToFront();
      await expect(plot).toHaveAttribute('data-visible-from', from!);
      expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    }
    await link.click();
    await expect(page).toHaveURL(/\/compare\?/);
    await expect(page.locator(chart)).toHaveAttribute('data-range-ready', '1');
    await expect(page.locator(chart)).toHaveAttribute('data-visible-from', from!);
    await expect(page.locator(chart)).toHaveAttribute('data-visible-to', to!);
  });
