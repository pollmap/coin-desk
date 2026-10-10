import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ASSET_REGISTRY } from '../shared/asset-registry';

for (const width of [390, 1280])
  test(`all 150 market logos decode and match their own identity ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/');
    await expect(page.locator('.market-table tbody tr')).toHaveCount(width < 768 ? 20 : 50);
    expect(requests.filter((url) => /\/coin-logos\/v2\//.test(url)).length).toBeLessThan(150);
    const seen = new Set<string>();
    for (const [market, count] of [
      ['Upbit · 원화', 103],
      ['Binance · USDT', 138],
    ] as const) {
      await page.getByRole('button', { name: market, exact: true }).click();
      let visible = width < 768 ? 20 : 50;
      await expect(page.locator('.market-table tbody tr')).toHaveCount(visible);
      while (visible < count) {
        await page.getByRole('button', { name: '더 보기', exact: true }).click();
        visible = Math.min(count, visible + (width < 768 ? 20 : 50));
        await expect(page.locator('.market-table tbody tr')).toHaveCount(visible);
      }
      await expect(page.locator('.market-table tbody tr')).toHaveCount(count);
      const images = await page.locator('.market-coin-cell img').evaluateAll(async (nodes) => {
        const logos = nodes as HTMLImageElement[];
        const inventory = [];
        // Production requests visible logos lazily. Bound the inventory probe too:
        // forcing 138 simultaneous off-screen loads is not the user loading path.
        for (const logo of logos) {
          await new Promise<void>((resolve, reject) => {
            const description = `${logo.dataset.asset}: ${new URL(logo.src).pathname}`;
            const cleanup = () => {
              clearTimeout(deadline);
              logo.removeEventListener('load', loaded);
              logo.removeEventListener('error', failed);
            };
            const loaded = () => {
              cleanup();
              if (logo.naturalWidth > 0) resolve();
              else reject(new Error(`Empty logo: ${description}`));
            };
            const failed = () => {
              cleanup();
              reject(new Error(`Failed logo load: ${description}`));
            };
            const deadline = setTimeout(() => {
              cleanup();
              reject(new Error(`Logo load deadline: ${description}`));
            }, 15000);
            logo.addEventListener('load', loaded);
            logo.addEventListener('error', failed);
            logo.loading = 'eager';
            if (logo.complete) loaded();
          });
          await logo.decode();
          inventory.push({
            asset: logo.dataset.asset!,
            path: new URL(logo.src).pathname,
            width: logo.width,
            height: logo.height,
            naturalWidth: logo.naturalWidth,
          });
        }
        return inventory;
      });
      expect(images).toHaveLength(count);
      for (const item of images) {
        seen.add(item.asset);
        expect(item.path).toBe(ASSET_REGISTRY.find((asset) => asset.id === item.asset)?.logo);
        expect(item.width).toBe(32);
        expect(item.height).toBe(32);
        expect(item.naturalWidth).toBeGreaterThanOrEqual(32);
      }
    }
    expect(seen.size).toBe(150);
    expect(requests.filter((url) => url.includes('/coin-logos/sources.json'))).toHaveLength(0);
    expect(
      requests.filter((url) => /static\.upbit|bnbstatic|raw\.githubusercontent/.test(url)),
    ).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

test('failed logos keep their footprint and recover when switching asset in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route('**/coin-logos/v2/pengu-*.png', (route) => route.abort());
  await page.goto('/coins/PENGU');
  const fallback = page.locator('.coin-picker > summary .asset-logo.fallback');
  await expect(fallback).toHaveText('PE');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    await expect(fallback).toHaveCSS('width', '28px');
    await expect(fallback).toHaveCSS('height', '28px');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: /코인 변경/ }).click();
  await page.getByRole('searchbox', { name: '코인 검색' }).fill('DOGE');
  await page.keyboard.press('Enter');
  const image = page.locator('.coin-picker > summary img.asset-logo');
  await expect(image).toHaveAttribute('data-asset', 'DOGE');
  expect(
    await image.evaluate(async (node) => {
      await (node as HTMLImageElement).decode();
      return (node as HTMLImageElement).naturalWidth;
    }),
  ).toBeGreaterThan(0);
});

test('search, detail and saved analysis retain the same PENGU logo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '코인·지표 검색 열기' }).click();
  await page.getByRole('searchbox', { name: '코인·지표 검색', exact: true }).fill('펭귄');
  const result = page.locator('#product-search-results a').filter({ hasText: 'PENGU' }).first();
  const path = ASSET_REGISTRY.find((asset) => asset.id === 'PENGU')!.logo;
  await expect(result.locator('img')).toHaveAttribute('src', path);
  await result.click();
  await expect(page.locator('.coin-picker > summary img')).toHaveAttribute('src', path);
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('로고 확인');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('button', { name: '분석 저장 닫기', exact: true }).click();
  await page.getByRole('link', { name: '내 저장', exact: true }).click();
  await expect(page.locator('.saved-workspaces img[data-asset=PENGU]')).toHaveAttribute(
    'src',
    path,
  );
});
