import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DAY } from '../shared/math';

// Explicit large-value synthetic observations exercise the current model and
// source units. This fixture is not provider freshness or production-history proof.
async function hashFixture(page: Page, asset: 'BTC' | 'DASH') {
  const last = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
  const data = Array.from({ length: 400 }, (_, index) => ({
    time: last - (399 - index) * DAY,
    value: asset === 'BTC' ? 1_000_000_000 + index * 1_000_000 : 2_000_000 + index * 5_000,
  }));
  const unit = asset === 'BTC' ? 'TH/s' : 'GH/s';
  await page.route('**/api/v1/network?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('metric') !== 'hashrate' || url.searchParams.get('asset') !== asset)
      return route.continue();
    await route.fulfill({
      json: {
        data,
        price: [],
        nextCursor: null,
        meta: {
          source: 'Explicit synthetic hash geometry fixture',
          unit,
          market: `${asset} / isolated test data`,
          dataAsOf: last,
          fetchedAt: last + DAY,
          historyStart: data[0].time,
          stale: false,
          observationInterval: '1d',
        },
      },
    });
  });
  const latest60 = data.slice(-60).reduce((sum, point) => sum + point.value, 0) / 60;
  const latest30 = data.slice(-30).reduce((sum, point) => sum + point.value, 0) / 30;
  return { last, unit, latest60, latest30 };
}

async function focusedOnly(page: Page) {
  await expect(
    page.locator('.analysis-reading-date,.indicator-provenance,.chart-readings-table'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '최근값 보기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CSV|내보내기|공유/ })).toHaveCount(0);
}
async function accessibleLayout(page: Page, width: number) {
  const chart = page.locator('[data-chart-kind="analysis"]');
  const box = (await chart.boundingBox())!;
  expect(box.y).toBeLessThanOrEqual(width < 768 ? 280 : 240);
  if (width >= 768) expect(box.height).toBeGreaterThanOrEqual(420);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  return box;
}

for (const width of [320, 390, 1280]) {
  for (const [asset, metric, source] of [
    ['BTC', 'view:hash_ribbons', 'reference'],
    ['DASH', 'view:hashrate_trend', 'binance'],
  ] as const) {
    test(
      asset + ' hash model keeps latest means and compact accessible controls at ' + width + 'px',
      async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        const fixture = await hashFixture(page, asset);
        const explicit = fixture.last - DAY;
        await page.goto(
          '/coins/' +
            asset +
            '?metric=' +
            metric +
            '&price_source=' +
            source +
            '&period=all&reading_date=' +
            explicit,
        );
        const chart = page.locator('[data-chart-kind="analysis"]');
        await expect(page.locator('.indicator-workspace')).toHaveAttribute(
          'data-indicator',
          metric,
        );
        await expect(chart).toHaveAttribute('data-range-ready', '1');
        await expect(chart).toHaveAttribute('data-asset', asset);
        const summary = page.locator('.analysis-reading-value');
        await expect(summary).toContainText(fixture.unit);
        expect(
          Number((await summary.locator('span').first().innerText()).replace(/,/g, '')),
        ).toBeCloseTo(fixture.latest30, 2);
        const secondary = page.locator('.analysis-secondary-readings .analysis-secondary-reading');
        await expect(secondary).toHaveCount(1);
        await expect(secondary).toContainText('60일 평균');
        await expect(secondary).toContainText(fixture.unit);
        expect(Number((await secondary.locator('b').innerText()).replace(/,/g, ''))).toBeCloseTo(
          fixture.latest60,
          2,
        );
        const latest = await summary.innerText();
        const range = [
          await chart.getAttribute('data-visible-from'),
          await chart.getAttribute('data-visible-to'),
        ];
        const geometry = [];
        for (const theme of ['light', 'dark']) {
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          const box = await accessibleLayout(page, width);
          const reading = await summary.evaluate((element) => {
            const value = element.querySelector('span')!.getBoundingClientRect();
            const unit = element.querySelector('.analysis-primary-unit')!.getBoundingClientRect();
            return {
              valueY: value.y,
              valueBottom: value.bottom,
              unitY: unit.y,
              unitBottom: unit.bottom,
              unitFont: parseFloat(
                getComputedStyle(element.querySelector('.analysis-primary-unit')!).fontSize,
              ),
            };
          });
          if (width < 768) {
            expect(reading.unitY).toBeLessThan(reading.valueBottom);
            expect(reading.unitBottom).toBeLessThanOrEqual(reading.valueBottom + 1);
          }
          expect(reading.unitFont).toBeGreaterThanOrEqual(12);
          await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
          await expect(page.getByTestId('chart-tooltip')).toBeVisible();
          await expect(page.getByTestId('chart-tooltip')).toContainText(asset);
          await expect(page.getByTestId('chart-tooltip')).toContainText(fixture.unit);
          await expect(page.getByTestId('chart-tooltip')).not.toHaveText(/\d{4}-\d{2}-\d{2}/);
          await chart.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
          await chart.press('ArrowLeft');
          await expect(summary).toHaveText(latest);
          expect(new URL(page.url()).searchParams.get('reading_date')).toBe(String(explicit));
          await focusedOnly(page);
          geometry.push({ theme, box, reading });
        }
        await testInfo.attach('hash-geometry.json', {
          body: Buffer.from(JSON.stringify(geometry)),
          contentType: 'application/json',
        });
        const helpButton = page.getByRole('button', { name: /^지표 설명/ });
        await helpButton.click();
        const help = page.getByRole('dialog', { name: '지표 설명', exact: true });
        await expect(help).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(1);
        if (width < 768) await expect(help).toHaveClass(/desk-dialog-sheet/);
        const helpBox = (await help.boundingBox())!;
        expect(helpBox.x).toBeGreaterThanOrEqual(0);
        expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(width + 1);
        if (width < 768) {
          const sizes = await page
            .locator('.indicator-workspace button,.indicator-workspace select')
            .evaluateAll((elements) =>
              elements
                .filter(
                  (e) =>
                    e.getBoundingClientRect().height > 0 &&
                    getComputedStyle(e).visibility !== 'hidden',
                )
                .map((e) => ({
                  label: e.getAttribute('aria-label') ?? e.textContent?.trim(),
                  height: e.getBoundingClientRect().height,
                })),
            );
          for (const control of sizes)
            expect(control.height, control.label).toBeGreaterThanOrEqual(44);
          expect(
            (await help.getByRole('button', { name: '지표 설명 닫기', exact: true }).boundingBox())!
              .height,
          ).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press('Escape');
        await expect(help).not.toBeVisible();
        await expect(helpButton).toBeFocused();
        expect([
          await chart.getAttribute('data-visible-from'),
          await chart.getAttribute('data-visible-to'),
        ]).toEqual(range);
        await expect(summary).toHaveText(latest);
      },
    );
  }
}

for (const metric of ['view:price', 'net:mvrv', 'view:supertrend']) {
  test(
    metric + ' keeps the compact mobile latest value and source selection without date controls',
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/coins/BTC?metric=' + metric + '&price_source=upbit&period=1y');
      const chart = page.locator('[data-chart-kind="analysis"]');
      await expect(chart).toHaveAttribute('data-range-ready', '1');
      const range = [
        await chart.getAttribute('data-visible-from'),
        await chart.getAttribute('data-visible-to'),
      ];
      const latest = await page.locator('.analysis-reading-value').innerText();
      const quote = page.getByRole('button', { name: '가격 거래소 선택', exact: true });
      const quoteBox = (await quote.boundingBox())!;
      expect(quoteBox.height).toBeGreaterThanOrEqual(44);
      expect(quoteBox.height).toBeLessThanOrEqual(46);
      await expect(quote).toHaveAccessibleDescription(/Upbit · KRW/);
      const checks = [];
      // Audit each theme's initial layout before the native End key can scroll
      // the document. Keyboard exploration is checked separately below.
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const box = await accessibleLayout(page, 390);
        await focusedOnly(page);
        checks.push({ theme, box, quoteBox });
      }
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const box = (await chart.boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
        await chart.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
        await chart.press('End');
        await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
        expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
        await focusedOnly(page);
      }
      await quote.click();
      const selection = page.getByRole('dialog', { name: '가격 선택', exact: true });
      await expect(
        selection.getByRole('combobox', { name: '현재 가격 거래소', exact: true }),
      ).toHaveValue('upbit');
      await expect(selection).not.toContainText(/체결 시각|수집 시각|확보 시작/);
      await page.keyboard.press('Escape');
      await expect(quote).toBeFocused();
      expect([
        await chart.getAttribute('data-visible-from'),
        await chart.getAttribute('data-visible-to'),
      ]).toEqual(range);
      await testInfo.attach('core-focused-geometry.json', {
        body: Buffer.from(JSON.stringify(checks)),
        contentType: 'application/json',
      });
    },
  );
}

test('funding retains exact settlement inputs and latest summary while legacy dates stay internal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const last = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY + 16 * 3600;
  const data = Array.from({ length: 100 }, (_, index) => ({
    time: last - (99 - index) * 8 * 3600,
    value: 0.01 + index / 10000,
  }));
  await page.route('**/api/v1/derivatives?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'BTC' || url.searchParams.get('metric') !== 'funding')
      return route.continue();
    await route.fulfill({
      json: {
        data,
        nextCursor: null,
        meta: {
          source: 'Explicit synthetic settlement fixture',
          unit: '%',
          dataAsOf: last,
          historyStart: data[0].time,
          fetchedAt: Date.now() / 1000,
          stale: false,
          observationInterval: '8h',
        },
      },
    });
  });
  const explicit = last - 8 * 3600;
  await page.goto(
    '/coins/BTC?metric=futures:funding&price_source=upbit&interval=1d&period=3m&reading_date=' +
      explicit,
  );
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(chart).toHaveAttribute('data-observations', '100');
  expect(data.at(-1)!.time - data.at(-2)!.time).toBe(8 * 3600);
  const summary = page.locator('.analysis-reading-value');
  expect(Number((await summary.locator('span').first().innerText()).replace(/,/g, ''))).toBeCloseTo(
    0.0199,
    6,
  );
  await expect(summary).toContainText('%');
  const latest = await summary.innerText();
  await chart.press('ArrowLeft');
  await chart.press('End');
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe(String(explicit));
  await expect(summary).toHaveText(latest);
  await focusedOnly(page);
  await accessibleLayout(page, 390);
});
