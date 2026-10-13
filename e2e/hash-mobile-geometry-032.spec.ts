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
  const previous60 = data.slice(-61, -1).reduce((sum, point) => sum + point.value, 0) / 60;
  return { last, unit, previous60 };
}

for (const width of [320, 390, 1280]) {
  for (const [asset, metric, source] of [
    ['BTC', 'view:hash_ribbons', 'reference'],
    ['DASH', 'view:hashrate_trend', 'binance'],
  ] as const) {
    test(`${asset} hash model keeps its chart compact and controls accessible at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      const fixture = await hashFixture(page, asset);
      await page.goto(`/coins/${asset}?metric=${metric}&price_source=${source}&period=all`);
      const chart = page.locator('[data-chart-kind="analysis"]');
      const workspace = page.locator('.indicator-workspace');
      await expect(workspace).toHaveAttribute('data-indicator', metric);
      await expect(chart).toHaveAttribute('data-range-ready', '1');
      await expect(chart).toHaveAttribute('data-asset', asset);
      await expect(page.locator('.analysis-reading-value')).toContainText(fixture.unit);
      await expect(page.locator('.analysis-reading-date')).toHaveAttribute(
        'title',
        new Date(fixture.last * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      );
      const secondary = page.locator('.analysis-secondary-readings');
      await expect(secondary).toContainText('60일 평균');
      await expect(secondary).toContainText(fixture.unit);
      await expect(page.locator('.analysis-secondary-reading')).toHaveCount(1);
      const geometry: object[] = [];
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const box = await chart.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeLessThanOrEqual(width < 768 ? 280 : 240);
        if (width >= 768) expect(box!.height).toBeGreaterThanOrEqual(420);
        const reading = await page.locator('.analysis-reading-value').evaluate((element) => {
          const value = element.querySelector('span')?.getBoundingClientRect();
          const unit = element.querySelector('.analysis-primary-unit')?.getBoundingClientRect();
          return {
            valueY: value?.y,
            unitY: unit?.y,
            valueBottom: value?.bottom,
            unitBottom: unit?.bottom,
            unitFont: parseFloat(
              getComputedStyle(element.querySelector('.analysis-primary-unit')!).fontSize,
            ),
          };
        });
        if (width < 768) {
          expect(reading.unitY).toBeLessThan(reading.valueBottom!);
          expect(reading.unitBottom).toBeLessThanOrEqual(reading.valueBottom! + 1);
        }
        expect(reading.unitFont).toBeGreaterThanOrEqual(12);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        expect(overflow).toBe(false);
        const violations = (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations;
        expect(violations).toEqual([]);
        geometry.push({ theme, box, reading, overflow });
      }
      await testInfo.attach('hash-geometry.json', {
        body: Buffer.from(JSON.stringify(geometry)),
        contentType: 'application/json',
      });
      const shortcuts = page.getByRole('navigation', { name: '자주 보는 지표' });
      await expect(shortcuts.getByRole('link', { name: '가격', exact: true })).toBeVisible();
      await expect(shortcuts.getByRole('link', { name: '슈퍼트렌드', exact: true })).toBeVisible();
      const infoButton = page.getByRole('button', { name: '데이터 정보', exact: true });
      await infoButton.click();
      const info = page.getByRole('dialog', { name: '데이터 정보', exact: true });
      await expect(info).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      if (width < 768) await expect(info).toHaveClass(/desk-dialog-sheet/);
      const infoRect = await info.boundingBox();
      expect(infoRect!.x).toBeGreaterThanOrEqual(0);
      expect(infoRect!.x + infoRect!.width).toBeLessThanOrEqual(width + 1);
      if (width < 768) {
        const controls = await workspace.locator('button,select').evaluateAll((elements) =>
          elements
            .filter(
              (element) =>
                element.getBoundingClientRect().height > 0 &&
                getComputedStyle(element).visibility !== 'hidden',
            )
            .map((element) => ({
              label: element.getAttribute('aria-label') ?? element.textContent?.trim(),
              height: element.getBoundingClientRect().height,
            })),
        );
        await testInfo.attach('hash-control-sizes.json', {
          body: Buffer.from(JSON.stringify(controls)),
          contentType: 'application/json',
        });
        for (const { label, height } of controls) expect(height, label).toBeGreaterThanOrEqual(44);
        const closeBox = await info
          .getByRole('button', { name: '데이터 정보 닫기', exact: true })
          .boundingBox();
        expect(closeBox!.height).toBeGreaterThanOrEqual(44);
      }
      await page.keyboard.press('Escape');
      await expect(info).not.toBeVisible();
      await expect(infoButton).toBeFocused();
      await expect(chart).toHaveAttribute('data-range-ready', '1');
      const originalRange = [
        await chart.getAttribute('data-visible-from'),
        await chart.getAttribute('data-visible-to'),
      ];
      await chart.focus();
      await page.keyboard.press('End');
      await expect(page).toHaveURL(new RegExp(`reading_date=${fixture.last}`));
      await page.keyboard.press('ArrowLeft');
      await expect(page).toHaveURL(new RegExp(`reading_date=${fixture.last - DAY}`));
      const readingDate = page.locator('.analysis-reading-date');
      await expect(readingDate).toHaveAttribute(
        'datetime',
        new Date((fixture.last - DAY) * 1000).toISOString(),
      );
      await expect(readingDate.locator('.analysis-reading-full-date')).toHaveText([
        '날짜 고정',
        `· ${new Date((fixture.last - DAY) * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      ]);
      await expect(secondary).toContainText(
        new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(fixture.previous60),
      );
      const reset = page.getByRole('button', { name: '최근값 보기', exact: true });
      await expect(reset).toBeVisible();
      if (width < 768) {
        expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await reset.boundingBox())!.width).toBeGreaterThanOrEqual(44);
        expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(280);
        await expect(readingDate.locator('.analysis-reading-compact-date')).toBeVisible();
        await expect(readingDate.locator('.analysis-reading-compact-date')).toHaveText(
          new Date((fixture.last - DAY) * 1000).toISOString().slice(0, 10),
        );
      }
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
      await reset.click();
      await expect(page).not.toHaveURL(/reading_date=/);
      await expect(chart).toBeFocused();
      expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(width < 768 ? 280 : 240);
      expect([
        await chart.getAttribute('data-visible-from'),
        await chart.getAttribute('data-visible-to'),
      ]).toEqual(originalRange);
    });
  }
}

for (const metric of ['view:price', 'net:mvrv', 'view:supertrend']) {
  test(`${metric} retains a compact 44px reset and the selected date at 390px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/coins/BTC?metric=${metric}&price_source=upbit&period=1y`);
    const chart = page.locator('[data-chart-kind="analysis"]');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    const originalRange = [
      await chart.getAttribute('data-visible-from'),
      await chart.getAttribute('data-visible-to'),
    ];
    const originalDate = await page.locator('.analysis-reading-date').getAttribute('title');
    const quote = page.getByRole('button', { name: '가격 거래소와 체결 시각', exact: true });
    const quoteBox = await quote.boundingBox();
    expect(quoteBox!.height).toBeGreaterThanOrEqual(44);
    expect(quoteBox!.height).toBeLessThanOrEqual(46);
    await expect(quote).toHaveAccessibleDescription(
      `${await quote.locator('strong').innerText()} ${await quote.locator('.quote-source-label').innerText()}`,
    );
    await expect(quote).toHaveAccessibleDescription(/Upbit · KRW/);
    const checks = [];
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const before = await chart.boundingBox();
      expect(before!.y).toBeLessThanOrEqual(280);
      await chart.focus();
      await page.keyboard.press('End');
      await expect(page).toHaveURL(/reading_date=\d+/);
      await expect(page.locator('.analysis-reading-date')).toHaveAttribute('title', originalDate!);
      const reset = page.getByRole('button', { name: '최근값 보기', exact: true });
      await expect(reset).toBeVisible();
      const resetBox = await reset.boundingBox();
      expect(resetBox!.height).toBeGreaterThanOrEqual(44);
      expect(resetBox!.width).toBeGreaterThanOrEqual(44);
      const pinned = await chart.boundingBox();
      const pinnedRows = await page
        .locator(
          '.topbar,.asset-header,.compact-coins,.coin-context,.detail-quote,.quote-source-button,.indicator-shortcuts,.indicator-heading,.indicator-heading-actions,.price-style-control,.indicator-title-button,.indicator-toolbar,.period-picker select,.analysis-legend,.analysis-legend > span:nth-child(2),.analysis-reading-date,.analysis-reading-value,.analysis-reading-reset',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect(),
              style = getComputedStyle(element);
            return {
              className: element.className,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              display: style.display,
              rows: style.gridTemplateRows,
              columns: style.gridTemplateColumns,
              lineHeight: style.lineHeight,
              gap: style.gap,
              margin: style.margin,
              padding: style.padding,
            };
          }),
        );
      await testInfo.attach(`core-pinned-rows-${theme}.json`, {
        body: Buffer.from(JSON.stringify(pinnedRows)),
        contentType: 'application/json',
      });
      expect(pinned!.y).toBeLessThanOrEqual(280);
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
      await reset.click();
      await expect(page).not.toHaveURL(/reading_date=/);
      const restored = await chart.boundingBox();
      expect(restored!.y).toBeLessThanOrEqual(280);
      expect([
        await chart.getAttribute('data-visible-from'),
        await chart.getAttribute('data-visible-to'),
      ]).toEqual(originalRange);
      checks.push({ theme, before, pinned, restored, resetBox, quoteBox });
      console.log(
        JSON.stringify({
          event: 'core_geometry',
          metric,
          theme,
          initialY: before!.y,
          pinnedY: pinned!.y,
          restoredY: restored!.y,
          resetHeight: resetBox!.height,
          quoteHeight: quoteBox!.height,
        }),
      );
    }
    await testInfo.attach('core-pinned-geometry.json', {
      body: Buffer.from(JSON.stringify(checks)),
      contentType: 'application/json',
    });
  });
}

test('funding pins keep distinct same-day settlement times in the compact mobile date', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const last = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY + 16 * 3600;
  await page.route('**/api/v1/derivatives?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'BTC' || url.searchParams.get('metric') !== 'funding')
      return route.continue();
    const data = Array.from({ length: 100 }, (_, index) => ({
      time: last - (99 - index) * 8 * 3600,
      value: 0.01 + index / 10000,
    }));
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
  await page.goto('/coins/BTC?metric=futures:funding&price_source=upbit&interval=1d&period=3m');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await chart.focus();
  await page.keyboard.press('End');
  await expect(page).toHaveURL(new RegExp(`reading_date=${last}`));
  const date = page.locator('.analysis-reading-date');
  await expect(date.locator('.analysis-reading-compact-date')).toHaveText(
    new Date(last * 1000).toISOString().slice(0, 16).replace('T', ' '),
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`reading_date=${last - 8 * 3600}`));
  await expect(date.locator('.analysis-reading-compact-date')).toHaveText(
    new Date((last - 8 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' '),
  );
  await expect(date).toHaveAttribute('datetime', new Date((last - 8 * 3600) * 1000).toISOString());
  expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(280);
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
});
