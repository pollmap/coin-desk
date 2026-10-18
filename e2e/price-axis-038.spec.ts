import { test, expect } from '@playwright/test';
import { dragChartTimeAxis } from './chart-gestures';
import { ORIGINAL_RAINBOW_BASELINE } from '../shared/btc-rainbow-original';

const chart = '.analysis-canvas';

async function recordAxisLabels(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      (this.canvas as HTMLCanvasElement & { axisLabels?: string[] }).axisLabels = [];
      return clear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      const canvas = this.canvas as HTMLCanvasElement & { axisLabels?: string[] };
      (canvas.axisLabels ??= []).push(String(args[0]));
      return original.apply(this, args);
    };
  });
}

async function axisLabels(page: import('@playwright/test').Page) {
  return page.locator(chart).evaluate((host) => {
    const bounds = host.getBoundingClientRect();
    return [...host.querySelectorAll('canvas')]
      .filter((canvas) => {
        const axis = canvas.getBoundingClientRect();
        // Identify the actual right-hand price axis, not a font-dependent width.
        // Wide price ranges can require labels wider than 150px.
        return (
          axis.width > 0 &&
          axis.height > 40 &&
          axis.x > bounds.x &&
          Math.abs(axis.right - bounds.right) < 3
        );
      })
      .flatMap(
        (canvas) => (canvas as HTMLCanvasElement & { axisLabels?: string[] }).axisLabels ?? [],
      );
  });
}

test('positive logarithmic price history never draws negative axis ticks', async ({ page }) => {
  await recordAxisLabels(page);
  await page.setViewportSize({ width: 810, height: 692 });
  await page.route('**/api/v1/reference?**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const start = Date.UTC(2020, 0, 1) / 1000;
    body.data = Array.from({ length: 900 }, (_, i) => ({
      time: start + i * 86400,
      value: i === 0 ? 0.00001 : 0.00001 * Math.exp((i / 899) * Math.log(1e6)),
    }));
    body.nextCursor = null;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/coins/DOGE?metric=view:price&price_source=reference&period=all&log=1');
  await expect(page.locator(chart)).toHaveAttribute('data-range-ready', '1');
  await expect.poll(() => axisLabels(page)).toContainEqual(expect.stringMatching(/^\$/));
  expect((await axisLabels(page)).filter((label) => /^\$[-−]/.test(label))).toEqual([]);
});

for (const sample of [
  { name: 'tiny flat', values: [1e-12, 1e-12] },
  { name: 'flat', values: [0.05, 0.05] },
  { name: 'wide', values: [1e-12, 1e12] },
])
  test(`positive log ticks stay positive for ${sample.name} prices`, async ({ page }) => {
    await recordAxisLabels(page);
    await page.route('**/api/v1/reference?**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const start = Date.UTC(2020, 0, 1) / 1000;
      body.data = Array.from({ length: 900 }, (_, i) => ({
        time: start + i * 86400,
        value:
          sample.values[0] * Math.exp((i / 899) * Math.log(sample.values[1] / sample.values[0])),
      }));
      body.nextCursor = null;
      await route.fulfill({ response, json: body });
    });
    await page.goto('/coins/DOGE?metric=view:price&price_source=reference&period=all');
    await expect(page.locator(chart)).toHaveAttribute('data-range-ready', '1');
    await expect(page.locator(chart)).toHaveAttribute('data-axis', 'log');
    await expect.poll(() => axisLabels(page)).toContainEqual(expect.stringMatching(/^\$/));
    await test.info().attach('price-axis-labels', {
      body: JSON.stringify(
        await page.locator(chart).evaluate((host) => ({
          width: host.getBoundingClientRect().width,
          canvases: [...host.querySelectorAll('canvas')].map((canvas) => ({
            width: canvas.getBoundingClientRect().width,
            x: canvas.getBoundingClientRect().x - host.getBoundingClientRect().x,
            labels: (canvas as HTMLCanvasElement & { axisLabels?: string[] }).axisLabels ?? [],
          })),
        })),
      ),
      contentType: 'application/json',
    });
    expect((await axisLabels(page)).filter((label) => /^\$[-−]/.test(label))).toEqual([]);
  });

test('price defaults to log while ratio and signed indicators keep linear axes', async ({
  page,
}) => {
  for (const [metric, axis] of [
    ['view:price', 'log'],
    ['net:mvrv', 'linear'],
    ['rsi', 'linear'],
    ['net:nupl', 'linear'],
  ]) {
    await page.goto(
      `/coins/BTC?metric=${encodeURIComponent(metric)}&price_source=reference&period=all`,
    );
    await expect(page.locator(chart)).toHaveAttribute('data-range-ready', '1');
    await expect(page.locator(chart)).toHaveAttribute('data-axis', axis);
  }
  await page.goto('/coins/BTC?metric=net:mvrv&log=1');
  await expect(page.locator(chart)).toHaveAttribute('data-axis', 'log');
  await page.goto('/coins/BTC?metric=rsi&log=1');
  await expect(page.locator(chart)).toHaveAttribute('data-axis', 'linear');
});

test('a genuine negative Bollinger boundary falls back to linear without removing the boundary', async ({
  page,
}) => {
  await recordAxisLabels(page);
  await page.route('**/api/v1/reference?**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const start = Date.UTC(2020, 0, 1) / 1000;
    body.data = Array.from({ length: 900 }, (_, i) => ({
      time: start + i * 86400,
      value: i < 890 ? 100 : 1,
    }));
    body.nextCursor = null;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/coins/DOGE?metric=view:bb&price_source=reference&period=all&log=1');
  await expect(page.locator(chart)).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator(chart)).toHaveAttribute('data-axis', 'linear');
  await expect
    .poll(async () => (await axisLabels(page)).filter((label) => /^\$[-−]/.test(label)).length)
    .toBeGreaterThan(0);
});

test('per-card axis preserves canvas and zoom, then restores through focus, history and saved analysis', async ({
  page,
}) => {
  const card = page.locator('.coin-dashboard-card[data-metric="view:price"]');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?dashboard_cards=view:price,net:mvrv&price_source=reference');
  const plot = card.locator(chart);
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await expect(plot).toHaveAttribute('data-range-ready', '1');
  const canvas = await plot.locator('canvas').first().elementHandle();
  await dragChartTimeAxis(page, plot);
  const beforeFrom = await plot.getAttribute('data-visible-from');
  const beforeTo = await plot.getAttribute('data-visible-to');
  await card.getByRole('button', { name: '가격 차트 축', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await expect(plot).toHaveAttribute('data-visible-from', beforeFrom!);
  await expect(plot).toHaveAttribute('data-visible-to', beforeTo!);
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  const focus = card.getByRole('link', { name: '가격 차트 크게 보기', exact: true });
  expect(
    new URL((await focus.getAttribute('href'))!, 'https://example.test').searchParams.get('log'),
  ).toBe('0');
  await focus.click();
  await expect(page).toHaveURL(/metric=view%3Aprice/);
  await expect(page.locator('.coin-dashboard')).toHaveCount(0);
  await expect(page.locator(chart)).toHaveAttribute('data-axis', 'linear');
  await page.goBack();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await expect(plot).toHaveAttribute('data-visible-from', beforeFrom!);
  await page.reload();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름').fill('가격 축 보존');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('coin-desk.personal.v1')!).workspaces[0],
  );
  expect(saved.dashboard.axes['view:price']).toBe('linear');
  await page.getByRole('link', { name: /가격 축 보존/ }).click();
  expect(JSON.parse(new URL(page.url()).searchParams.get('dashboard_axes')!)['view:price']).toBe(
    'linear',
  );
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  const explicit = new URLSearchParams({
    dashboard_cards: 'view:price',
    dashboard_axes: JSON.stringify({ 'view:price': 'log' }),
  });
  await page.goto('/coins/BTC?' + explicit);
  await expect(plot).toHaveAttribute('data-axis', 'log');
});

test('focused axis remembers the coin choice but explicit links win without losing dates', async ({
  page,
}) => {
  const day = 86400,
    today = Math.floor(Date.now() / 86400000) * day;
  const params = new URLSearchParams({
    metric: 'view:price',
    price_source: 'reference',
    period: 'all',
    reading_date: String(today - 100 * day),
    chart_from: String(today - 300 * day),
    chart_to: String(today - 20 * day),
  });
  await page.goto('/coins/BTC?' + params);
  const plot = page.locator(chart);
  await expect(plot).toHaveAttribute('data-range-ready', '1');
  await expect(plot).toHaveAttribute('data-axis', 'log');
  const canvas = await plot.locator('canvas').first().elementHandle();
  const from = await plot.getAttribute('data-visible-from'),
    to = await plot.getAttribute('data-visible-to');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '로그 축', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe(params.get('reading_date'));
  await expect(plot).toHaveAttribute('data-visible-from', from!);
  await expect(plot).toHaveAttribute('data-visible-to', to!);
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  await page.goto('/coins/BTC?' + params);
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  params.set('log', '1');
  await page.goto('/coins/BTC?' + params);
  await expect(plot).toHaveAttribute('data-axis', 'log');
  params.delete('log');
  await page.goto('/coins/DOGE?' + params);
  await expect(plot).toHaveAttribute('data-axis', 'log');
});

test('indicator and source navigation restore the destination axis instead of carrying defaults', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=view:btc_rainbow_original&price_source=reference&period=all');
  const plot = page.locator(chart);
  const shortcuts = page.getByRole('navigation', { name: '자주 보는 지표' });
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await expect(shortcuts.getByRole('link', { name: 'MVRV', exact: true })).not.toHaveAttribute(
    'href',
    /[?&]log=/,
  );
  await shortcuts.getByRole('link', { name: 'MVRV', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await shortcuts.getByRole('link', { name: '가격', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '로그 축', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await shortcuts.getByRole('link', { name: 'MVRV', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await shortcuts.getByRole('link', { name: '가격', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByRole('combobox', { name: '가격 기준', exact: true }).selectOption('binance');
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await page.getByRole('combobox', { name: '가격 기준', exact: true }).selectOption('reference');
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await page.getByRole('combobox', { name: '가격 기준', exact: true }).selectOption('binance');
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await page.getByRole('button', { name: '로그 축', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  await page.getByRole('button', { name: '가격 거래소 선택', exact: true }).click();
  const quote = page.getByRole('dialog', { name: '가격 선택', exact: true });
  await quote
    .getByRole('combobox', { name: '현재 가격 거래소', exact: true })
    .selectOption('upbit');
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await quote
    .getByRole('combobox', { name: '현재 가격 거래소', exact: true })
    .selectOption('binance');
  await expect(plot).toHaveAttribute('data-axis', 'linear');
});

test('a saved dashboard period change retains the current axis and Original model', async ({
  page,
}) => {
  const metric = 'view:btc_rainbow_original';
  const today = Math.floor(Date.now() / 86400000) * 86400;
  const params = new URLSearchParams({
    price_source: 'reference',
    period: 'all',
    dashboard_cards: 'view:price,' + metric,
    dashboard_axes: JSON.stringify({ 'view:price': 'linear', [metric]: 'log' }),
    dashboard_models: JSON.stringify({ [metric]: ORIGINAL_RAINBOW_BASELINE.modelVersion }),
    dashboard_ranges: JSON.stringify({
      'view:price': { from: today - 300 * 86400, to: today - 30 * 86400 },
    }),
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?' + params);
  const card = page.locator('.coin-dashboard-card[data-metric="view:price"]');
  const plot = card.locator(chart);
  await expect(plot).toHaveAttribute('data-range-ready', '1');
  await expect(plot).toHaveAttribute('data-axis', 'linear');
  const from = await plot.getAttribute('data-visible-from');
  await card.getByRole('button', { name: '가격 차트 축', exact: true }).click();
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await page.getByRole('button', { name: '1년', exact: true }).click();
  await expect(plot).toHaveAttribute('data-range-ready', '1');
  await expect(plot).toHaveAttribute('data-axis', 'log');
  await expect(plot).not.toHaveAttribute('data-visible-from', from!);
  const url = new URL(page.url()).searchParams;
  expect(url.get('period')).toBe('1y');
  expect(url.has('dashboard_ranges')).toBe(false);
  expect(JSON.parse(url.get('dashboard_axes')!)['view:price']).toBe('log');
  expect(JSON.parse(url.get('dashboard_models')!)[metric]).toBe(
    ORIGINAL_RAINBOW_BASELINE.modelVersion,
  );
  await page.reload();
  await expect(plot).toHaveAttribute('data-axis', 'log');
});
