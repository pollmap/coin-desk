import { test, expect } from '@playwright/test';

const hashCard = '.coin-dashboard-card[data-metric="view:hash_ribbons"]';
const priceCard = '.coin-dashboard-card[data-metric="view:price"]';

test('USD hash ribbons reuse the shared price refresh rather than creating a second timer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 450 });
  await page.clock.install({ time: new Date() });
  let usdReads = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === '/api/v1/reference' &&
      url.searchParams.get('asset') === 'BTC' &&
      !url.searchParams.has('from')
    )
      usdReads++;
  });
  await page.goto('/coins/BTC?price_source=reference&dashboard_cards=view:price,view:hash_ribbons');
  await expect(page.locator(`${priceCard} .analysis-canvas`)).toHaveAttribute(
    'data-range-ready',
    '1',
  );
  await expect(page.locator(`${hashCard} .coin-dashboard-placeholder`)).toHaveCount(1);
  expect(usdReads).toBe(1);
  await page.clock.fastForward(5 * 60000);
  await page.locator(hashCard).scrollIntoViewIfNeeded();
  await expect(page.locator(`${hashCard} .analysis-canvas`)).toHaveAttribute(
    'data-range-ready',
    '1',
  );
  expect(usdReads).toBe(1);
  await page.clock.fastForward(55 * 60000 + 2000);
  await expect.poll(() => usdReads).toBe(2);
  // A separately mounted hash-price timer would run five minutes after the shared price timer.
  await page.clock.fastForward(5 * 60000 + 2000);
  await expect(page.locator(`${hashCard} .analysis-canvas`)).toHaveAttribute(
    'data-range-ready',
    '1',
  );
  expect(usdReads).toBe(2);
});

test('KRW hash ribbons keep BTC USD momentum and visible chart lines in both themes', async ({
  page,
}) => {
  const reads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) reads.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?price_source=upbit&dashboard_cards=view:price,view:hash_ribbons');
  await expect(page.locator(`${priceCard} .coin-dashboard-card-reading`)).toContainText('KRW');
  await page.locator(hashCard).scrollIntoViewIfNeeded();
  const canvas = page.locator(`${hashCard} .analysis-canvas`);
  await expect(canvas).toHaveAttribute('data-range-ready', '1');
  expect(reads.some((url) => /\/reference\?asset=BTC/.test(url))).toBe(true);
  expect(reads.some((url) => /\/candles\?asset=BTC&market=upbit/.test(url))).toBe(true);
  await expect(page.locator(`${hashCard} .coin-dashboard-card-reading`)).toContainText('TH/s');
  const linePixels = (rgb: number[]) =>
    canvas.evaluate((host, rgb) => {
      let count = 0;
      for (const node of host.querySelectorAll('canvas')) {
        const context = node.getContext('2d');
        if (!context || !node.width || !node.height) continue;
        const pixels = context.getImageData(0, 0, node.width, node.height).data;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] === rgb[0] &&
            pixels[i + 1] === rgb[1] &&
            pixels[i + 2] === rgb[2] &&
            pixels[i + 3] === 255
          )
            count++;
      }
      return count;
    }, rgb);
  await expect.poll(() => linePixels([66, 138, 122])).toBeGreaterThan(10);
  const from = await canvas.getAttribute('data-visible-from');
  await page.getByRole('button', { name: /테마로 변경/ }).click();
  await expect.poll(() => linePixels([101, 212, 188])).toBeGreaterThan(10);
  await expect(canvas).toHaveAttribute('data-visible-from', from!);
});
