import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { supertrend } from '../shared/supertrend';
import type { Candle, CandleResponse } from '../shared/types';

test('retains fractional price precision in Supertrend readings', async ({ page }) => {
  await page.route('**/api/v1/candles?**', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.data = data.data.map((bar: Record<string, number>) => ({
      ...bar,
      open: bar.open / 1000,
      high: bar.high / 1000,
      low: bar.low / 1000,
      close: bar.close / 1000,
    }));
    await route.fulfill({ response, json: data });
  });
  await page.goto('/coins/DOGE?metric=view:supertrend&price_source=binance&interval=1w');
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
    'data-range-ready',
    '1',
  );
  await expect(
    page
      .locator('.analysis-secondary-readings > span')
      .filter({ hasText: '슈퍼트렌드 10·3' })
      .locator('b'),
  ).toHaveText(/\d+\.\d{5,}/);
});

test('selects Supertrend from USD reference, opens actual DOGE weekly candles and preserves latest readings and zoom while reading help', async ({
  page,
}) => {
  const weeklyPages: { order: number; from: number; body: CandleResponse }[] = [];
  let requestOrder = 0;
  let pendingWeeklyPages = 0;
  await page.route('**/api/v1/candles?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const target =
      params.get('asset') === 'DOGE' &&
      params.get('market') === 'binance' &&
      params.get('interval') === '1w';
    const order = requestOrder++;
    if (target) pendingWeeklyPages++;
    try {
      const response = await route.fetch();
      const body: CandleResponse = await response.json();
      if (target) weeklyPages.push({ order, from: Number(params.get('from') || 0), body });
      await route.fulfill({ response, json: body });
    } finally {
      if (target) pendingWeeklyPages--;
    }
  });
  await page.goto('/coins/DOGE?metric=net:mvrv&price_source=reference');
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택' });
  await picker.getByRole('textbox').fill('슈퍼트렌드');
  await picker.getByRole('link', { name: /슈퍼트렌드/ }).click();
  await expect(page).toHaveURL(/metric=view%3Asupertrend/);
  await expect(page).toHaveURL(/price_source=binance/);
  await expect(page).toHaveURL(/interval=1w/);
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-asset', 'DOGE');
  await expect(chart).toHaveAttribute('data-primary-metric', 'price');
  await expect(chart).toHaveAttribute('data-price-style', 'candles');
  await expect(page.locator('.supertrend-context')).toHaveAttribute(
    'data-direction',
    /^(up|down)$/,
  );
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect.poll(() => weeklyPages.length).toBeGreaterThan(0);
  await expect.poll(() => pendingWeeklyPages).toBe(0);
  // Compare against every DOGE/Binance weekly page, not whichever response arrived last.
  // Calendar pages can overlap; their later chronological window owns the repeated candle.
  const byTime = new Map<number, Candle>();
  for (const page of [...weeklyPages].sort((a, b) => a.from - b.from || a.order - b.order))
    for (const candle of page.body.data) byTime.set(candle.time, candle);
  const inputs = [...byTime.values()].sort((a, b) => a.time - b.time);
  expect(weeklyPages.some((page) => page.body.nextCursor === null)).toBe(true);
  expect(inputs.length).toBeGreaterThan(10);
  const expected = supertrend(inputs, '1w').at(-1);
  expect(expected).toBeDefined();
  await test.info().attach('DOGE-binance-weekly-inputs', {
    body: JSON.stringify({
      pages: weeklyPages.map(({ from, body }) => ({
        from,
        count: body.data.length,
        nextCursor: body.nextCursor,
      })),
      points: inputs.length,
      first: inputs[0].time,
      last: inputs.at(-1)!.time,
    }),
    contentType: 'application/json',
  });
  await expect(page.locator('.supertrend-context')).toHaveAttribute(
    'data-direction',
    expected!.direction,
  );
  const actual = page
    .locator('.analysis-secondary-readings > span')
    .filter({ hasText: '슈퍼트렌드 10·3' })
    .locator('b');
  expect(Number((await actual.innerText()).replace(/,/g, ''))).toBeCloseTo(expected!.value, 4);
  const latest = await page.locator('.analysis-reading-value').innerText();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  await expect(page.locator('.analysis-reading-date,.indicator-provenance')).toHaveCount(0);
  const from = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  const explanation = page.getByRole('dialog', { name: '지표 설명', exact: true });
  await expect(explanation.locator('.guide-example')).toContainText('109.6');
  await expect(explanation.locator('.guide-example li').first()).toBeVisible();
  await expect(explanation.locator('.guide-method li').first()).not.toBeVisible();
  await explanation.getByText('계산식·용어 자세히 보기', { exact: true }).click();
  await expect(explanation.locator('.guide-method details')).toHaveAttribute('open', '');
  await expect(explanation.locator('.guide-method')).toContainText('Wilder RMA');
  await expect(explanation.locator('.guide-method .guide-formula')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chart).toHaveAttribute('data-visible-from', from!);
});

test('rejects a closing-only source without loading another coin and offers a valid alternative', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/reference')) requests.push(r.url());
  });
  await page.goto('/coins/ONDO?metric=view:supertrend&price_source=reference');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole('link', { name: '사용 가능한 분석 열기' }).click();
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute('data-asset', 'ONDO');
  await expect(page.locator('.supertrend-context')).not.toHaveAttribute(
    'data-direction',
    'pending',
  );
  await expect(page.locator('.analysis-secondary-readings')).toContainText('슈퍼트렌드 10·3');
});

test('saves and restores source, weekly interval and custom Supertrend settings', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=view:supertrend&price_source=upbit&interval=1w');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const before = await chart.getAttribute('data-visible-from');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByRole('spinbutton', { name: '슈퍼트렌드 ATR 기간' }).fill('7');
  await page.getByRole('spinbutton', { name: '슈퍼트렌드 배수' }).fill('2.5');
  await page.getByRole('button', { name: '설정 적용', exact: true }).click();
  await expect(page.locator('.analysis-secondary-readings')).toContainText('슈퍼트렌드 7·2.5');
  await expect(chart).toHaveAttribute('data-visible-from', before!);
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  const save = page.getByRole('dialog', { name: '분석 저장' });
  await save.getByRole('textbox', { name: '작업공간 이름' }).fill('DOGE 주봉 추세');
  await save.getByRole('button', { name: '현재 구성 저장' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '내 저장', exact: true }).first().click();
  await page.getByRole('link', { name: /DOGE 주봉 추세/ }).click();
  await expect(page).toHaveURL(/st_period=7/);
  await expect(page).toHaveURL(/st_multiplier=2.5/);
  expect(new URL(page.url()).searchParams.get('interval')).toBe('1w');
  await expect(page.locator('.analysis-secondary-readings')).toContainText('슈퍼트렌드 7·2.5');
  await expect(page.locator('.analysis-reading-value')).toContainText('₩');
});

test('uses the selected coin across supported markets and direct default entry', async ({
  page,
}) => {
  for (const [asset, source] of [
    ['BTC', 'binance'],
    ['ETH', 'upbit'],
    ['PEPE', 'binance'],
    ['PENGU', 'upbit'],
    ['AAVE', 'binance'],
  ]) {
    await page.goto(`/coins/${asset}?metric=view:supertrend&price_source=${source}&interval=1d`);
    await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute('data-asset', asset);
    expect(new URL(page.url()).searchParams.get('interval')).toBe('1d');
    await expect(page.locator('.supertrend-context')).not.toHaveAttribute(
      'data-direction',
      'pending',
    );
    await expect(page.locator('.analysis-secondary-readings')).toContainText('슈퍼트렌드 10·3');
    await expect(page.locator('.analysis-reading-date,.indicator-provenance')).toHaveCount(0);
  }
  const defaultResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/v1/candles' &&
      url.searchParams.get('asset') === 'DOGE' &&
      url.searchParams.get('market') === 'binance'
    );
  });
  await page.goto('/coins/DOGE?metric=view:supertrend');
  const response = await defaultResponse;
  expect(new URL(response.url()).searchParams.get('interval')).toBe('1w');
  const data = (await response.json()).data as Candle[];
  const expected = supertrend(data, '1w').at(-1)!;
  expect(expected).toBeDefined();
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute('data-asset', 'DOGE');
  await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
    'data-range-ready',
    '1',
  );
  // Omitting the default from the URL is valid; actual source and computation
  // must still use confirmed DOGE Binance weekly OHLC.
  await expect(page.locator('.supertrend-context')).toHaveAttribute(
    'data-direction',
    expected.direction,
  );
  await expect(page.locator('.analysis-secondary-readings')).toContainText('슈퍼트렌드 10·3');
  const value = page
    .locator('.analysis-secondary-readings > span')
    .filter({ hasText: '슈퍼트렌드 10·3' })
    .locator('b');
  expect(Number((await value.innerText()).replace(/,/g, ''))).toBeCloseTo(expected.value, 4);
});

test('keeps the weekly chart compact and accessible in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/coins/DOGE?metric=view:supertrend&price_source=binance&interval=1w');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const mobileLayout = await page.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('main *')]
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(
        ({ element, box }) =>
          box.width > 0 &&
          box.height > 0 &&
          box.right > innerWidth + 1 &&
          getComputedStyle(element).visibility !== 'hidden',
      )
      .map(({ element, box }) => ({
        tag: element.tagName,
        className: element.className.toString(),
        text: element.textContent?.trim().slice(0, 120),
        x: box.x,
        right: box.right,
        width: box.width,
      }))
      .slice(0, 20),
    toolbar: [...document.querySelectorAll('.indicator-toolbar button,.indicator-toolbar select')]
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
      .map(({ element, box }) => ({
        label: element.getAttribute('aria-label') ?? element.textContent?.trim(),
        height: box.height,
      })),
    header: ['.asset-header', '.coin-context', '.quote-source-button', '.quote-source-label'].map(
      (selector) => {
        const element = document.querySelector(selector)!,
          box = element.getBoundingClientRect(),
          css = getComputedStyle(element);
        return {
          selector,
          height: box.height,
          width: box.width,
          fontSize: css.fontSize,
          lineHeight: css.lineHeight,
          minHeight: css.minHeight,
          whiteSpace: css.whiteSpace,
        };
      },
    ),
  }));
  await testInfo.attach('supertrend-mobile-layout', {
    body: JSON.stringify(mobileLayout, null, 2),
    contentType: 'application/json',
  });
  const quoteHeight = mobileLayout.header.find(
    (row) => row.selector === '.quote-source-button',
  )!.height;
  expect(quoteHeight).toBeGreaterThanOrEqual(44);
  expect(quoteHeight).toBeLessThanOrEqual(46);
  expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(280);
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewport);
  for (const control of mobileLayout.toolbar) expect(control.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('supertrend-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await chart.boundingBox())!.height).toBeGreaterThanOrEqual(420);
  expect((await chart.boundingBox())!.y).toBeLessThanOrEqual(240);
  await page.screenshot({ path: testInfo.outputPath('supertrend-pc.png'), fullPage: true });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '어두운 테마로 변경' }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
  }
});
