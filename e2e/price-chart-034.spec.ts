import { expect, test, type APIRequestContext, type CDPSession, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Candle, CandleResponse } from '../shared/types';

const DAY = 86400;
const chart = (page: Page) => page.locator('[data-chart-kind="analysis"]');
const tooltip = (page: Page) => page.getByTestId('chart-tooltip');
const summary = (page: Page) => page.locator('.analysis-reading-value');
const lastClosedDay = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;

/** Explicit synthetic OHLC in browser-only routes; never certifies production coverage. */
function dailyBars(count: number, base = 1): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const time = lastClosedDay - (count - 1 - index) * DAY;
    const close = base * (1 + index / 1500 + Math.sin(index / 7) / 25);
    return {
      time,
      open: close * 0.998,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 100 + index,
      closeTime: time + DAY,
      closed: true,
    };
  });
}

/** Independent recurrence, not the product's Supertrend function. */
function independentlyCalculatedSupertrend(bars: Candle[]) {
  const values = new Map<number, number>();
  let previousUpper: number | undefined, previousLower: number | undefined;
  let previousValue: number | undefined,
    atr = 0;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index],
      previous = bars[index - 1];
    const trueRange = previous
      ? Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previous.close),
          Math.abs(bar.low - previous.close),
        )
      : bar.high - bar.low;
    if (index < 10) atr += trueRange / 10;
    else atr = (9 * atr + trueRange) / 10;
    if (index < 9) continue;
    const middle = (bar.high + bar.low) / 2;
    const rawUpper = middle + 3 * atr,
      rawLower = middle - 3 * atr;
    const upper: number =
      previousUpper === undefined || rawUpper < previousUpper || previous.close > previousUpper
        ? rawUpper
        : previousUpper;
    const lower: number =
      previousLower === undefined
        ? Math.max(0, rawLower)
        : rawLower > previousLower || previous.close < previousLower
          ? rawLower
          : previousLower;
    const value =
      previousValue === undefined || previousValue === previousUpper
        ? bar.close > upper && previousValue !== undefined
          ? lower
          : upper
        : bar.close < lower
          ? upper
          : lower;
    values.set(bar.time, value);
    previousUpper = upper;
    previousLower = lower;
    previousValue = value;
  }
  return values;
}

async function canvasPricePaints(page: Page) {
  await page.addInitScript(() => {
    const paints: { text: string; x: number; y: number; canvasX: number; canvasWidth: number }[] =
      [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      const bounds = this.canvas.getBoundingClientRect(),
        transform = this.getTransform();
      const deviceX = transform.a * x + transform.c * y + transform.e;
      const deviceY = transform.b * x + transform.d * y + transform.f;
      if (bounds.width > 0 && bounds.height > 0) {
        paints.push({
          text: String(text),
          x: bounds.x + (deviceX / this.canvas.width) * bounds.width,
          y: bounds.y + (deviceY / this.canvas.height) * bounds.height,
          canvasX: bounds.x,
          canvasWidth: bounds.width,
        });
        if (paints.length > 5000) paints.splice(0, 1000);
      }
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
    Object.assign(window, { priceChartPaints: paints });
  });
}

async function fixture(page: Page, asset: string, state: { bars: Candle[]; delay?: number }) {
  const requests: { from: number; to: number; rows: number }[] = [];
  await page.route('**/api/v1/candles?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== asset) return route.continue();
    const from = Number(url.searchParams.get('from') || 0);
    const to = Number(url.searchParams.get('to') || lastClosedDay + DAY);
    const limit = Math.min(1000, Number(url.searchParams.get('limit') || 1000));
    const candidates = state.bars.filter((bar) => bar.time >= from && bar.time < to);
    const data = candidates.slice(0, limit);
    requests.push({ from, to, rows: data.length });
    if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
    await route.fulfill({
      json: {
        data,
        nextCursor: candidates.length > limit ? data.at(-1)!.time + DAY : null,
        range: { from: state.bars[0].time, to: lastClosedDay + DAY },
        meta: {
          source: 'Explicit isolated OHLC fixture',
          unit: url.searchParams.get('market') === 'upbit' ? 'KRW' : 'USDT',
          market: `${asset} / isolated test`,
          historyStart: state.bars[0].time,
          dataAsOf: state.bars.at(-1)!.time,
          fetchedAt: lastClosedDay + DAY,
          stale: false,
          calculationVersion: 'e2e-price-034',
          observationInterval: '1d',
        },
      },
    });
  });
  return requests;
}

async function actualCandles(request: APIRequestContext, asset: string, interval = '1d') {
  const bars: Candle[] = [];
  let cursor = 0;
  for (let count = 0; count < 40; count++) {
    const response = await request.get(
      `/api/v1/candles?asset=${asset}&market=binance&interval=${interval}&limit=1000${cursor ? `&from=${cursor}` : ''}`,
    );
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as CandleResponse;
    expect(body.meta.market).toBe('binance');
    expect(body.meta.unit).toBe('USDT');
    bars.push(...body.data);
    if (body.nextCursor === null)
      return [...new Map(bars.map((bar) => [bar.time, bar])).values()]
        .sort((a, b) => a.time - b.time)
        .filter((bar) => bar.closed && bar.closeTime <= Date.now() / 1000);
    expect(body.nextCursor).toBeGreaterThan(cursor);
    cursor = body.nextCursor;
  }
  throw new Error('Fixture candle pagination did not terminate');
}

async function ready(page: Page) {
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  return chart(page)
    .boundingBox()
    .then((box) => box!);
}
async function publicOnly(page: Page) {
  await expect(
    page.locator(
      '.analysis-reading-date,.analysis-tools,.analysis-table,.date-navigator,.indicator-provenance',
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /데이터 정보|내보내기|CSV|링크 공유|날짜로 이동/ }),
  ).toHaveCount(0);
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
}
async function pointerBounds(page: Page) {
  const bounds = await chart(page).boundingBox();
  const tip = await tooltip(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(tip).not.toBeNull();
  expect(tip!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(tip!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(tip!.x + tip!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
  expect(tip!.y + tip!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
  await expect(chart(page)).toHaveAttribute('data-crosshair-mode', 'normal');
}

test('new price, Supertrend, ribbon and Bollinger views display the complete actual fixture history', async ({
  page,
}) => {
  test.setTimeout(90000);
  const bars = await actualCandles(page.request, 'XRP');
  expect(bars.length).toBe(1100);
  for (const metric of ['view:price', 'view:supertrend', 'view:ribbon', 'view:bb']) {
    await page.goto(`/coins/XRP?metric=${metric}&price_source=binance&interval=1d`);
    await ready(page);
    await expect(page.locator('.indicator-workspace')).toHaveAttribute('data-indicator', metric);
    await expect(page.getByRole('button', { name: '전체', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[0].time));
    await expect(chart(page)).toHaveAttribute('data-visible-to', String(bars.at(-1)!.time));
    await expect(chart(page)).toHaveAttribute('data-observations', String(bars.length));
    await publicOnly(page);
  }
  await page.goto('/coins/XRP?metric=net:mvrv&price_source=binance');
  await ready(page);
  await page
    .getByRole('navigation', { name: '자주 보는 지표' })
    .getByRole('link', { name: '가격', exact: true })
    .click();
  await ready(page);
  await expect(page.getByRole('button', { name: '전체', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[0].time));
});

test('day, week and month price histories retain the oldest bar before Supertrend preparation', async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const interval of ['1d', '1w', '1M']) {
    const bars = await actualCandles(page.request, 'DOGE', interval);
    expect(bars.length).toBeGreaterThan(10);
    await page.goto(`/coins/DOGE?metric=view:supertrend&price_source=binance&interval=${interval}`);
    await ready(page);
    await expect(chart(page)).toHaveAttribute('data-price-style', 'candles');
    await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[0].time));
    await expect(chart(page)).toHaveAttribute('data-visible-to', String(bars.at(-1)!.time));
    await expect(chart(page)).toHaveAttribute('data-observations', String(bars.length));
    await chart(page).press('Home');
    await expect(chart(page)).toHaveAttribute('data-hover-time', String(bars[0].time));
    await expect(chart(page)).not.toHaveAttribute('data-hover-line-value');
    await expect(tooltip(page)).toContainText('종가');
    await expect(tooltip(page)).not.toContainText('슈퍼트렌드');
  }
});

test('late 1000-bar page and minute refresh keep all history; explicit windows and the All action are distinct', async ({
  page,
}) => {
  await page.clock.install();
  const state = { bars: dailyBars(1250), delay: 120 };
  const requests = await fixture(page, 'XRP', state);
  await page.goto('/coins/XRP?metric=view:price&price_source=binance');
  await ready(page);
  await expect(chart(page)).toHaveAttribute('data-observations', '1250');
  await expect(chart(page)).toHaveAttribute('data-visible-from', String(state.bars[0].time));
  expect(requests.some((request) => request.rows === 1000)).toBe(true);
  expect(requests.some((request) => request.from > state.bars[0].time)).toBe(true);
  const canvas = await chart(page).locator('canvas').first().elementHandle();
  const originalCalls = requests.length;
  await page.clock.fastForward(60001);
  await expect.poll(() => requests.length).toBeGreaterThan(originalCalls);
  await ready(page);
  await expect(chart(page)).toHaveAttribute('data-visible-from', String(state.bars[0].time));
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);

  const from = state.bars[1000].time,
    to = state.bars[1100].time;
  await page.goto(
    `/coins/XRP?metric=view:price&price_source=binance&period=1m&chart_from=${from}&chart_to=${to}`,
  );
  await ready(page);
  await expect(chart(page)).toHaveAttribute('data-visible-from', String(from));
  await expect(chart(page)).toHaveAttribute('data-visible-to', String(to));
  await page.getByRole('button', { name: '전체', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-visible-from', String(state.bars[0].time));
  await expect(chart(page)).toHaveAttribute('data-visible-to', String(state.bars.at(-1)!.time));
  expect(new URL(page.url()).searchParams.has('chart_from')).toBe(false);
  expect(new URL(page.url()).searchParams.has('chart_to')).toBe(false);
});

test('tiny PEPE and SHIB price axes preserve nonzero precision and matched tooltip observations', async ({
  page,
}) => {
  await canvasPricePaints(page);
  for (const [asset, base] of [
    ['PEPE', 0.00000377],
    ['SHIB', 0.00001213],
  ] as const) {
    const bars = dailyBars(80, base);
    await fixture(page, asset, { bars });
    await page.goto(`/coins/${asset}?metric=view:price&price_source=binance&period=all`);
    const box = await ready(page);
    const move = Number(await chart(page).getAttribute('data-primary-min-move'));
    const precision = Number(await chart(page).getAttribute('data-primary-precision'));
    expect(move).toBeGreaterThan(0);
    expect(move).toBeLessThanOrEqual(1e-8);
    expect(precision).toBeGreaterThanOrEqual(8);
    await expect
      .poll(async () =>
        page.evaluate(({ x, width, y, height }) => {
          const paints = (
            window as unknown as {
              priceChartPaints: {
                text: string;
                x: number;
                y: number;
                canvasX: number;
                canvasWidth: number;
              }[];
            }
          ).priceChartPaints;
          const ticks = paints.filter(
            (paint) =>
              paint.canvasX >= x + width * 0.7 &&
              paint.canvasWidth < width / 2 &&
              paint.y > y &&
              paint.y < y + height &&
              /^\$0\.\d{8,}$/.test(paint.text),
          );
          return new Set(
            ticks.filter((tick) => Number(tick.text.slice(1)) > 0).map((tick) => tick.text),
          ).size;
        }, box),
      )
      .toBeGreaterThanOrEqual(2);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await expect(tooltip(page)).toBeVisible();
    const time = Number(await chart(page).getAttribute('data-hover-time'));
    const selected = bars.find((bar) => bar.time === time)!;
    expect(selected).toBeDefined();
    expect(Number(await chart(page).getAttribute('data-hover-value'))).toBe(selected.close);
    await expect(tooltip(page)).not.toContainText(/\$0\.00(?:\s|$)/);
    await expect(tooltip(page).locator('time')).toHaveAttribute(
      'datetime',
      new Date(time * 1000).toISOString(),
    );
    await pointerBounds(page);
    await page.screenshot({ path: test.info().outputPath(`${asset}-precise-axis.png`) });
  }
});

test('DOGE axis zero stays compact without rounding actual observations through refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await canvasPricePaints(page);
  const bars = dailyBars(120, 0.003).map((bar, index) => {
    const close = index === 119 ? 0.08765 : 0.003 + 0.72 * Math.sin((index / 119) * Math.PI) ** 2;
    return { ...bar, open: close * 0.998, high: close * 1.01, low: close * 0.99, close };
  });
  const state = { bars };
  const requests = await fixture(page, 'DOGE', state);
  await page.goto('/coins/DOGE?metric=view:supertrend&price_source=binance&interval=1d&period=all');
  await ready(page);
  const axis = async () =>
    page.evaluate(() => {
      const element = document.querySelector('[data-chart-kind="analysis"]')!;
      const host = element.getBoundingClientRect();
      const right = [...element.querySelectorAll('canvas')]
        .map((canvas) => canvas.getBoundingClientRect())
        .filter((bounds) => bounds.width > 0 && bounds.x > host.x + host.width / 2)
        .sort((a, b) => b.height - a.height)[0];
      const paints = (
        window as unknown as {
          priceChartPaints: { text: string; canvasX: number; canvasWidth: number }[];
        }
      ).priceChartPaints;
      return {
        width: right?.width,
        ticks: paints
          .filter((paint) => paint.canvasX === right?.x && paint.canvasWidth === right.width)
          .map((paint) => paint.text)
          .filter((text) => text.startsWith('$')),
      };
    });
  await expect.poll(async () => (await axis()).ticks.includes('$0.00')).toBe(true);
  const assertAxis = async () => {
    const reading = await axis();
    expect(reading.width).toBeLessThan(90);
    expect(reading.ticks.some((text) => Number(text.slice(1)) > 0)).toBe(true);
    expect(
      reading.ticks.filter((text) => Number(text.slice(1)) === 0 && /\.\d{3,}$/.test(text)),
    ).toEqual([]);
  };
  await assertAxis();
  await chart(page).press('Home');
  await expect(chart(page)).toHaveAttribute('data-hover-value', String(bars[0].close));
  await expect(tooltip(page)).toContainText('$0.00300000');
  const latest = await summary(page).innerText();
  const calls = requests.length;
  await page.evaluate(() => {
    (window as unknown as { priceChartPaints: unknown[] }).priceChartPaints.splice(0);
  });
  await page.clock.fastForward(60001);
  await expect.poll(() => requests.length).toBeGreaterThan(calls);
  await expect.poll(async () => (await axis()).ticks.includes('$0.00')).toBe(true);
  await assertAxis();
  await expect(chart(page)).toHaveAttribute('data-hover-value', String(bars[0].close));
  await expect(summary(page)).toHaveText(latest);
  await page.screenshot({ path: test.info().outputPath('doge-axis-zero-compact.png') });
});

test('ribbon and Bollinger keep every latest overlay value below mobile charts without hiding either axis', async ({
  page,
}) => {
  test.setTimeout(90000);
  const bars = await actualCandles(page.request, 'XRP');
  const average = (period: number) =>
    bars.slice(-period).reduce((sum, bar) => sum + bar.close, 0) / period;
  const middle = average(20);
  const deviation = Math.sqrt(
    bars.slice(-20).reduce((sum, bar) => sum + (bar.close - middle) ** 2, 0) / 20,
  );
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [metric, values] of [
      ['view:ribbon', [7, 25, 50, 100].map(average)],
      ['view:bb', [middle, middle + 2 * deviation, middle - 2 * deviation]],
    ] as const) {
      await page.goto(`/coins/XRP?metric=${metric}&price_source=binance&interval=1d&period=all`);
      await ready(page);
      const latest = await summary(page).innerText();
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const box = await ready(page);
        expect(box.y).toBeLessThanOrEqual(viewport.width < 768 ? 280 : 240);
        expect(box.height).toBeGreaterThanOrEqual(viewport.width < 768 ? 240 : 420);
        if (viewport.width < 768) {
          expect(box.height).toBeLessThanOrEqual(330);
          const navTop = await page
            .locator('.product-nav')
            .evaluate((element) => element.getBoundingClientRect().top);
          expect(box.y + box.height).toBeLessThanOrEqual(navTop - 6);
        }
        const readings = page.locator('.analysis-secondary-readings .analysis-secondary-reading');
        await expect(readings).toHaveCount(values.length);
        for (const [index, value] of values.entries()) {
          await expect(readings.nth(index)).toBeVisible();
          const rect = (await readings.nth(index).boundingBox())!;
          expect(rect.y).toBeGreaterThanOrEqual(box.y + box.height);
          const rendered = Number(
            (await readings.nth(index).locator('b').innerText()).replaceAll(',', ''),
          );
          expect(rendered).toBeCloseTo(value, 2);
          await expect(readings.nth(index)).toContainText('USDT');
        }
        await expect(summary(page)).toHaveText(latest);
        expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
        await page.screenshot({
          path: test.info().outputPath(`${metric.slice(5)}-${viewport.width}-${theme}-compact.png`),
        });
      }
    }
  }
});

test('keyboard history-boundary inspection preserves logical zoom through resize, refresh, older history and saved reload', async ({
  page,
}) => {
  await page.clock.install();
  const state = { bars: dailyBars(1250, 0.1) };
  const requests = await fixture(page, 'DOGE', state);
  await page.goto(
    `/coins/DOGE?metric=view:supertrend&price_source=binance&period=all&chart_from=${state.bars[1000].time}&chart_to=${state.bars[1100].time}`,
  );
  await ready(page);
  const latest = await summary(page).innerText();
  const canvas = await chart(page).locator('canvas').first().elementHandle();
  const logicalWidth = async () => {
    const from = Number(await chart(page).getAttribute('data-visible-logical-from'));
    const to = Number(await chart(page).getAttribute('data-visible-logical-to'));
    expect(Number.isFinite(from) && Number.isFinite(to)).toBe(true);
    return to - from;
  };
  const width = await logicalWidth();
  expect(width).toBeCloseTo(100, 6);
  const stableWidth = async () => {
    await expect.poll(async () => Math.abs((await logicalWidth()) - width)).toBeLessThan(1e-6);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(summary(page)).toHaveText(latest);
  };
  for (const [key, time] of [
    ['Home', state.bars[0].time],
    ['ArrowLeft', state.bars[0].time],
    ['End', state.bars.at(-1)!.time],
    ['ArrowRight', state.bars.at(-1)!.time],
    ['Home', state.bars[0].time],
    ['End', state.bars.at(-1)!.time],
  ] as const) {
    await chart(page).press(key);
    await expect(chart(page)).toHaveAttribute('data-hover-time', String(time));
    await stableWidth();
  }
  const currentFrom = await chart(page).getAttribute('data-visible-from');
  const currentTo = await chart(page).getAttribute('data-visible-to');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await stableWidth();
    await expect(chart(page)).toHaveAttribute('data-visible-from', currentFrom!);
    await expect(chart(page)).toHaveAttribute('data-visible-to', currentTo!);
  }
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await expect(page.getByRole('dialog', { name: '지표 설명', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await stableWidth();
  const originalCalls = requests.length;
  const older = {
    ...state.bars[0],
    time: state.bars[0].time - DAY,
    closeTime: state.bars[0].closeTime - DAY,
  };
  state.bars.unshift(older);
  await page.clock.fastForward(60001);
  await expect.poll(() => requests.length).toBeGreaterThan(originalCalls);
  await expect(chart(page)).toHaveAttribute('data-observations', '1251');
  await stableWidth();
  await expect(chart(page)).toHaveAttribute('data-visible-from', currentFrom!);
  await expect(chart(page)).toHaveAttribute('data-visible-to', currentTo!);
  await chart(page).press('Home');
  await expect(chart(page)).toHaveAttribute('data-hover-time', String(older.time));
  await stableWidth();
  await chart(page).press('End');
  await stableWidth();
  const savedFrom = await chart(page).getAttribute('data-visible-from');
  const savedTo = await chart(page).getAttribute('data-visible-to');
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('키보드 확대 보존');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('link', { name: /키보드 확대 보존/ }).click();
  await ready(page);
  await expect(chart(page)).toHaveAttribute('data-visible-from', savedFrom!);
  await expect(chart(page)).toHaveAttribute('data-visible-to', savedTo!);
  expect(await logicalWidth()).toBeCloseTo(width, 6);
  await page.reload();
  await ready(page);
  await expect(chart(page)).toHaveAttribute('data-visible-from', savedFrom!);
  await expect(chart(page)).toHaveAttribute('data-visible-to', savedTo!);
  expect(await logicalWidth()).toBeCloseTo(width, 6);
  await expect(summary(page)).toHaveText(latest);
  await publicOnly(page);
});

test('Supertrend inspection follows the actual intersection, uses the same candle and keeps the latest summary', async ({
  page,
}) => {
  const bars = dailyBars(80, 0.1);
  const expectedSupertrend = independentlyCalculatedSupertrend(bars);
  await fixture(page, 'DOGE', { bars });
  await page.goto('/coins/DOGE?metric=view:supertrend&price_source=binance&interval=1d&period=all');
  const box = await ready(page);
  const latest = await summary(page).innerText();
  for (const ratio of [0.3, 0.7]) {
    const point = { x: box.x + box.width * ratio, y: box.y + box.height * 0.45 };
    await page.mouse.move(point.x, point.y);
    await expect(tooltip(page)).toBeVisible();
    const time = Number(await chart(page).getAttribute('data-hover-time'));
    const candle = bars.find((bar) => bar.time === time)!;
    expect(candle).toBeDefined();
    expect(Number(await chart(page).getAttribute('data-hover-value'))).toBe(candle.close);
    expect(Number(await chart(page).getAttribute('data-hover-line-value'))).toBeCloseTo(
      expectedSupertrend.get(time)!,
      10,
    );
    await expect(tooltip(page)).toContainText('종가');
    await expect(tooltip(page)).toContainText('슈퍼트렌드');
    await expect(tooltip(page)).toHaveAttribute('data-observation-time', String(time));
    await pointerBounds(page);
    const marker = await page.locator('.analysis-observation-dot').boundingBox();
    expect(marker).not.toBeNull();
    expect(marker!.x + marker!.width / 2).toBeCloseTo(
      box.x + Number(await chart(page).getAttribute('data-hover-observation-x')),
      0,
    );
    expect(marker!.y + marker!.height / 2).toBeCloseTo(
      box.y + Number(await chart(page).getAttribute('data-hover-observation-y')),
      0,
    );
    await expect(summary(page)).toHaveText(latest);
  }
  await chart(page).press('Home');
  await expect(chart(page)).toHaveAttribute('data-hover-time', String(bars[0].time));
  await chart(page).press('End');
  await expect(chart(page)).toHaveAttribute('data-hover-time', String(bars.at(-1)!.time));
  await chart(page).press('ArrowLeft');
  await expect(chart(page)).toHaveAttribute('data-hover-time', String(bars.at(-2)!.time));
  await chart(page).press('Escape');
  await expect(tooltip(page)).not.toBeVisible();
  await expect(summary(page)).toHaveText(latest);
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
});

test('small mobile and desktop charts leave their axes outside fixed navigation in both themes', async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 331, height: 577 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/coins/XRP?metric=view:price&price_source=binance');
    await ready(page);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const geometry = await page.evaluate(() => {
        const element = document.querySelector('[data-chart-kind="analysis"]')!;
        const rect = element.getBoundingClientRect();
        const navigation = [...document.querySelectorAll('nav')]
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            css: getComputedStyle(node),
          }))
          .find(
            ({ rect: bounds, css }) =>
              css.position === 'fixed' && bounds.height > 0 && bounds.y >= innerHeight / 2,
          );
        return {
          top: rect.y,
          bottom: rect.bottom,
          height: rect.height,
          navTop: navigation?.rect.y ?? innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.top).toBeLessThanOrEqual(viewport.width < 768 ? 280 : 240);
      expect(geometry.height).toBeGreaterThanOrEqual(viewport.width < 768 ? 240 : 420);
      if (viewport.width < 768) {
        expect(geometry.height).toBeLessThanOrEqual(330);
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop - 6);
      }
      expect(geometry.overflow).toBe(false);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`axes-${viewport.width}-${theme}.png`),
      });
    }
  }
});

type TouchPoint = { x: number; y: number; id: number };
async function dispatchTouch(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  touchPoints: TouchPoint[],
) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints });
}
async function trustedTouchLog(page: Page) {
  await page.addInitScript(() => {
    const events: { type: string; trusted: boolean; touches: number }[] = [];
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
      document.addEventListener(
        type,
        (event) => {
          const touch = event as TouchEvent;
          events.push({ type, trusted: event.isTrusted, touches: touch.touches.length });
        },
        { capture: true },
      );
    Object.assign(window, { priceChartTouchEvents: events });
  });
}
async function touches(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          priceChartTouchEvents: { type: string; trusted: boolean; touches: number }[];
        }
      ).priceChartTouchEvents,
  );
}

async function panePlot(page: Page, index: number) {
  return chart(page).evaluate((element, paneIndex) => {
    const host = element.getBoundingClientRect();
    const rects = [...element.querySelectorAll('canvas')]
      .map((canvas) => canvas.getBoundingClientRect())
      .filter((bounds) => bounds.width > host.width * 0.6 && bounds.height > 50)
      .sort((a, b) => a.y - b.y);
    const panes = [
      ...new Map(
        rects.map((bounds) => [
          bounds.y,
          { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        ]),
      ).values(),
    ];
    if (!panes[paneIndex]) throw new Error(`Actual rendered pane ${paneIndex} is missing`);
    return panes[paneIndex];
  }, index);
}

async function fundingPaneContract(page: Page, touch: boolean) {
  const bars = dailyBars(80, 1000);
  const missing = bars[60].time;
  const funding = bars
    .filter((bar) => bar.time !== missing)
    .map((bar, index) => ({
      time: bar.time,
      value: index < 40 ? 0 : -0.015,
    }));
  await fixture(page, 'DOGE', { bars });
  await page.route('**/api/v1/derivatives?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('asset') !== 'DOGE' || url.searchParams.get('metric') !== 'funding')
      return route.continue();
    await route.fulfill({
      json: {
        data: funding,
        price: [],
        nextCursor: null,
        meta: {
          source: 'Explicit isolated funding fixture',
          unit: '%',
          market: 'Bybit USDT perpetual',
          dataAsOf: funding.at(-1)!.time,
          fetchedAt: lastClosedDay + DAY,
          stale: false,
          calculationVersion: 'e2e-price-034-funding',
          observationInterval: 'settlement',
        },
      },
    });
  });
  await page.goto(
    '/coins/DOGE?metric=view:price&price_source=binance&period=all&panels=futures:funding',
  );
  await ready(page);
  await expect(chart(page)).toHaveAttribute('data-panels', '1');
  const latest = await summary(page).innerText();
  for (const [barIndex, expected] of [
    [24, 0],
    [54, -0.015],
  ] as const) {
    // Obtain an actual candle coordinate by native keyboard input. Arbitrary
    // percentages can correctly land on a missing 8h settlement whitespace.
    await chart(page).press('End');
    for (let index = 0; index < bars.length - 1 - barIndex; index++)
      await chart(page).press('ArrowLeft');
    await expect(chart(page)).toHaveAttribute('data-hover-time', String(bars[barIndex].time));
    const host = (await chart(page).boundingBox())!;
    const plot = await panePlot(page, 1);
    // Same actual lower-pane canvas on both engines; never a main-pane dataset-only probe.
    const point = {
      x: host.x + Number(await chart(page).getAttribute('data-hover-observation-x')),
      y: plot.y + plot.height * 0.5,
    };
    if (touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.move(point.x, point.y);
    await expect(tooltip(page)).toBeVisible();
    await expect(chart(page)).toHaveAttribute('data-hover-pane', '1');
    const inspected = Number(await chart(page).getAttribute('data-hover-time'));
    expect(Number(await chart(page).getAttribute('data-hover-value'))).toBe(expected);
    expect(funding.find((row) => row.time === inspected)?.value).toBe(expected);
    await expect(tooltip(page)).toContainText('펀딩률');
    await expect(tooltip(page)).toContainText('%');
    await expect(tooltip(page)).not.toContainText(/종가|USDT/);
    const bounds = (await tooltip(page).boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(plot.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(plot.y + plot.height + 1);
    await expect(summary(page)).toHaveText(latest);
  }
  // Native keyboard selects an actual main-price date. Its coordinate then tests
  // the same missing settlement in the lower pane without fabricating a price.
  await chart(page).press('End');
  for (let index = 0; index < 19; index++) await chart(page).press('ArrowLeft');
  await expect(chart(page)).toHaveAttribute('data-hover-time', String(missing));
  const x = Number(await chart(page).getAttribute('data-hover-observation-x'));
  const host = (await chart(page).boundingBox())!;
  const plot = await panePlot(page, 1);
  if (touch) await page.touchscreen.tap(host.x + x, plot.y + plot.height * 0.5);
  else await page.mouse.move(host.x + x, plot.y + plot.height * 0.5);
  await expect(tooltip(page)).not.toBeVisible();
  await expect(summary(page)).toHaveText(latest);
  await publicOnly(page);
}

test('actual secondary-pane zero, negative and missing funding values never borrow the price or another date', async ({
  page,
}) => {
  await fundingPaneContract(page, false);
});

test.describe('actual touch-capable browser input', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('the already-selected All menu item resets a mobile window through genuine touch input', async ({
    page,
    context,
    browserName,
  }, info) => {
    await page.clock.install();
    await trustedTouchLog(page);
    const bars = dailyBars(80, 0.1);
    const requests = await fixture(page, 'DOGE', { bars });
    await page.goto(
      `/coins/DOGE?metric=view:price&price_source=binance&period=all&chart_from=${bars[30].time}&chart_to=${bars[60].time}`,
    );
    await ready(page);
    const canvas = await chart(page).locator('canvas').first().elementHandle();
    await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[30].time));
    await expect(chart(page)).toHaveAttribute('data-visible-to', String(bars[60].time));
    const trigger = page.getByRole('button', { name: '조회 기간 · 전체', exact: true });
    await expect(trigger).toBeVisible();
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    const menu = page.getByRole('menu', { name: /^조회 기간/ });
    const all = menu.getByRole('menuitemradio', { name: '전체', exact: true });
    await expect(all).toHaveAttribute('aria-checked', 'true');
    expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // This is a trusted tap on the selected item, not selectOption(), which
    // artificially emits change even when a native select's value is unchanged.
    await all.tap();
    await expect(menu).not.toBeVisible();
    await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[0].time));
    await expect(chart(page)).toHaveAttribute('data-visible-to', String(bars.at(-1)!.time));
    expect(new URL(page.url()).searchParams.has('chart_from')).toBe(false);
    expect(new URL(page.url()).searchParams.has('chart_to')).toBe(false);
    await expect(trigger).toBeFocused();

    if (browserName === 'chromium') {
      const box = (await chart(page).boundingBox())!;
      const center = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4 };
      const session = await context.newCDPSession(page);
      await dispatchTouch(session, 'touchStart', [
        { x: center.x - 25, y: center.y, id: 1 },
        { x: center.x + 25, y: center.y, id: 2 },
      ]);
      for (const distance of [40, 60, 80]) {
        await dispatchTouch(session, 'touchMove', [
          { x: center.x - distance, y: center.y, id: 1 },
          { x: center.x + distance, y: center.y, id: 2 },
        ]);
        await page.clock.runFor(20);
      }
      await dispatchTouch(session, 'touchEnd', []);
      await expect
        .poll(() => chart(page).getAttribute('data-visible-from'))
        .not.toBe(String(bars[0].time));
      await trigger.tap();
      await expect(all).toHaveAttribute('aria-checked', 'true');
      await all.tap();
      await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[0].time));
      await expect(chart(page)).toHaveAttribute('data-visible-to', String(bars.at(-1)!.time));
      await session.detach();
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await trigger.tap();
      await expect(menu).toBeVisible();
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
      await expect(all).toHaveAttribute('aria-checked', 'true');
      const audit = await new AxeBuilder({ page }).include('.period-menu-popup').analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`mobile-period-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(menu).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
    const initialCalls = requests.length;
    await page.clock.fastForward(60001);
    await expect.poll(() => requests.length).toBeGreaterThan(initialCalls);
    await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[0].time));
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    const events = await touches(page);
    expect(events.some((event) => event.type === 'touchstart' && event.trusted)).toBe(true);
    await info.attach('mobile-selected-all-native-input.json', {
      body: Buffer.from(
        JSON.stringify({
          engine: info.project.name,
          genuineBrowserInput: true,
          selectedItemReactivated: true,
          nativePinchAlsoVerified: browserName === 'chromium',
          events,
        }),
      ),
      contentType: 'application/json',
    });
  });

  test('trusted tap shows a value without becoming a pan and outside tap closes it on both engines', async ({
    page,
  }, info) => {
    await page.clock.install();
    await trustedTouchLog(page);
    const bars = dailyBars(80, 0.1);
    const requests = await fixture(page, 'DOGE', { bars });
    await page.goto('/coins/DOGE?metric=view:supertrend&price_source=binance&interval=1d');
    const box = await ready(page);
    const maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
    const range = [
      await chart(page).getAttribute('data-visible-from'),
      await chart(page).getAttribute('data-visible-to'),
    ];
    const latest = await summary(page).innerText();
    await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await expect(tooltip(page)).toBeVisible();
    const time = Number(await chart(page).getAttribute('data-hover-time'));
    expect(Number(await chart(page).getAttribute('data-hover-value'))).toBe(
      bars.find((bar) => bar.time === time)!.close,
    );
    await pointerBounds(page);
    expect([
      await chart(page).getAttribute('data-visible-from'),
      await chart(page).getAttribute('data-visible-to'),
    ]).toEqual(range);
    await expect(summary(page)).toHaveText(latest);
    await page.touchscreen.tap(box.x + 2, box.y - 20);
    await expect(tooltip(page)).not.toBeVisible();
    // A simple tap must not set the user-pan flag: recovered earlier observations
    // expand the All view at the next minute refresh, without replacing latest.
    bars.unshift({ ...bars[0], time: bars[0].time - DAY, closeTime: bars[0].time });
    const originalCalls = requests.length;
    await page.clock.fastForward(60001);
    await expect.poll(() => requests.length).toBeGreaterThan(originalCalls);
    await expect(chart(page)).toHaveAttribute('data-observations', '81');
    await expect(chart(page)).toHaveAttribute('data-visible-from', String(bars[0].time));
    await expect(summary(page)).toHaveText(latest);
    const events = await touches(page);
    expect(events.some((event) => event.type === 'touchstart' && event.trusted)).toBe(true);
    expect(events.some((event) => event.type === 'touchend' && event.trusted)).toBe(true);
    await info.attach('native-touch-capability.json', {
      body: Buffer.from(
        JSON.stringify({
          engine: info.project.name,
          method: 'Playwright touchscreen.tap',
          genuineBrowserInput: true,
          maxTouchPoints,
          events,
        }),
      ),
      contentType: 'application/json',
    });
  });

  test('trusted lower-pane taps preserve zero and negative units, and do not fill a missing settlement', async ({
    page,
  }, info) => {
    await trustedTouchLog(page);
    await fundingPaneContract(page, true);
    const events = await touches(page);
    expect(events.some((event) => event.type === 'touchstart' && event.trusted)).toBe(true);
    await info.attach('native-pane-touch-capability.json', {
      body: Buffer.from(
        JSON.stringify({
          engine: info.project.name,
          method: 'Playwright touchscreen.tap',
          genuineBrowserInput: true,
          events,
        }),
      ),
      contentType: 'application/json',
    });
  });

  test('an inspected touch observation follows a provider revision and closes on withdrawal', async ({
    page,
  }, info) => {
    await page.clock.install();
    await trustedTouchLog(page);
    const bars = dailyBars(80, 0.1);
    const requests = await fixture(page, 'DOGE', { bars });
    await page.goto('/coins/DOGE?metric=view:price&price_source=binance&period=all');
    const box = await ready(page);
    const latest = await summary(page).innerText();
    await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await expect(tooltip(page)).toBeVisible();
    const time = Number(await chart(page).getAttribute('data-hover-time'));
    const index = bars.findIndex((bar) => bar.time === time);
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(bars.length - 1);
    const oldY = Number(await chart(page).getAttribute('data-hover-observation-y'));
    const revised = bars[index].close * 1.5;
    bars[index] = {
      ...bars[index],
      open: revised,
      close: revised,
      high: revised * 1.01,
      low: revised * 0.99,
    };
    const beforeRevision = requests.length;
    await page.clock.fastForward(60001);
    await expect.poll(() => requests.length).toBeGreaterThan(beforeRevision);
    await expect(chart(page)).toHaveAttribute('data-hover-time', String(time));
    await expect(chart(page)).toHaveAttribute('data-hover-value', String(revised));
    await expect
      .poll(async () => Number(await chart(page).getAttribute('data-hover-observation-y')))
      .not.toBe(oldY);
    await expect(tooltip(page).locator('[data-series="primary"]')).toHaveAttribute(
      'data-value',
      String(revised),
    );
    await expect(summary(page)).toHaveText(latest);

    bars.splice(index, 1);
    const beforeWithdrawal = requests.length;
    await page.clock.fastForward(60001);
    await expect.poll(() => requests.length).toBeGreaterThan(beforeWithdrawal);
    await expect(chart(page)).toHaveAttribute('data-observations', '79');
    await expect(chart(page)).not.toHaveAttribute('data-hover-time');
    await expect(tooltip(page)).not.toBeVisible();
    await expect(page.locator('.analysis-observation-dot')).toHaveCount(0);
    await expect(summary(page)).toHaveText(latest);
    const events = await touches(page);
    expect(events.some((event) => event.type === 'touchstart' && event.trusted)).toBe(true);
    await info.attach('revision-touch-capability.json', {
      body: Buffer.from(
        JSON.stringify({
          engine: info.project.name,
          genuineBrowserInput: true,
          revisedTime: time,
          events,
        }),
      ),
      contentType: 'application/json',
    });
  });

  test('outside pointer release, axes and indicator transitions do not leave a stale touch inspector', async ({
    page,
  }, info) => {
    await trustedTouchLog(page);
    await fixture(page, 'DOGE', { bars: dailyBars(80, 0.1) });
    await page.goto('/coins/DOGE?metric=view:price&price_source=binance&period=all');
    let box = await ready(page);
    const point = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.4 };
    // A genuine mouse release outside the host must end its pointer ownership.
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(2, point.y, { steps: 8 });
    await page.mouse.up();
    // Panning changes where real candles are. Use the rendered last-candle
    // coordinate, then dismiss it so an inert touch cannot pass on an old tip.
    await chart(page).press('End');
    point.x = box.x + Number(await chart(page).getAttribute('data-hover-observation-x'));
    await page.keyboard.press('Escape');
    await expect(tooltip(page)).not.toBeVisible();
    await page.touchscreen.tap(point.x, point.y);
    await expect(tooltip(page)).toBeVisible();
    await page.touchscreen.tap(box.x + box.width - 4, point.y);
    await expect(tooltip(page)).not.toBeVisible();
    await expect(page.locator('.analysis-observation-dot')).toHaveCount(0);
    await page.touchscreen.tap(point.x, point.y);
    await expect(tooltip(page)).toBeVisible();
    await page.touchscreen.tap(point.x, box.y + box.height - 4);
    await expect(tooltip(page)).not.toBeVisible();
    await expect(chart(page)).not.toHaveAttribute('data-hover-time');
    await page.touchscreen.tap(point.x, point.y);
    await expect(tooltip(page)).toBeVisible();

    const shortcuts = page.getByRole('navigation', { name: '자주 보는 지표' });
    await shortcuts.getByRole('link', { name: 'MVRV', exact: true }).tap();
    await ready(page);
    await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
    await expect(tooltip(page)).not.toBeVisible();
    await shortcuts.getByRole('link', { name: '가격', exact: true }).tap();
    box = await ready(page);
    await expect(chart(page)).toHaveAttribute('data-primary-metric', 'price');
    await expect(chart(page)).not.toHaveAttribute('data-hover-time');
    await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await expect(tooltip(page)).toContainText('종가');
    await expect(tooltip(page)).toContainText('USDT');
    await expect(tooltip(page)).not.toContainText('배');
    const events = await touches(page);
    expect(events.some((event) => event.type === 'touchstart' && event.trusted)).toBe(true);
    await info.attach('outside-axis-native-touch.json', {
      body: Buffer.from(
        JSON.stringify({ engine: info.project.name, genuineBrowserInput: true, events }),
      ),
      contentType: 'application/json',
    });
  });

  test('Escape cancels queued keyboard cursor frames instead of reopening an old observation', async ({
    page,
  }) => {
    await page.clock.install();
    const bars = dailyBars(80, 0.1);
    await fixture(page, 'DOGE', { bars });
    await page.goto(
      `/coins/DOGE?metric=view:price&price_source=binance&period=all&chart_from=${bars[40].time}&chart_to=${bars[70].time}`,
    );
    await ready(page);
    const latest = await summary(page).innerText();
    const pauseAt = await page.evaluate(() => Date.now() + 1000);
    await page.clock.pauseAt(pauseAt);
    for (const key of ['Home', 'End']) {
      await chart(page).press(key);
      await page.keyboard.press('Escape');
      await page.clock.runFor(80);
      await expect(tooltip(page)).not.toBeVisible();
      await expect(page.locator('.analysis-observation-dot')).toHaveCount(0);
      await expect(chart(page)).not.toHaveAttribute('data-hover-time');
      await expect(summary(page)).toHaveText(latest);
      expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
    }
    await page.clock.runFor(300);
    await expect(tooltip(page)).not.toBeVisible();
    await publicOnly(page);
  });

  test('native long press, horizontal pan, pinch and cancellation keep inspected values and window state', async ({
    page,
    context,
    browserName,
  }, info) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright exposes only native tap for WebKit; native multi-touch is separately unverified, not replaced by DOM dispatch.',
    );
    await page.setViewportSize({ width: 320, height: 568 });
    await trustedTouchLog(page);
    await page.addInitScript(() => {
      const clicks: { trusted: boolean; target: string }[] = [];
      document.addEventListener(
        'click',
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-chart-kind="analysis"]')
          )
            clicks.push({ trusted: event.isTrusted, target: event.target.tagName });
        },
        { capture: true },
      );
      Object.assign(window, { chartCancelClicks: clicks });
    });
    const bars = dailyBars(160, 0.1);
    await fixture(page, 'DOGE', { bars });
    await page.goto(
      '/coins/DOGE?metric=view:supertrend&price_source=binance&interval=1d&period=1m',
    );
    const box = await ready(page);
    const canvas = await chart(page).locator('canvas').first().elementHandle();
    const session = await context.newCDPSession(page);
    const origin = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4, id: 1 };
    const latest = await summary(page).innerText();
    const initialRange = [
      await chart(page).getAttribute('data-visible-from'),
      await chart(page).getAttribute('data-visible-to'),
    ];
    await dispatchTouch(session, 'touchStart', [origin]);
    await page.waitForTimeout(650); // Library native long-tap recognizer; not a mocked DOM event.
    await dispatchTouch(session, 'touchMove', [{ ...origin, x: origin.x - 40 }]);
    await expect(tooltip(page)).toBeVisible();
    const observed = Number(await chart(page).getAttribute('data-hover-time'));
    expect(Number(await chart(page).getAttribute('data-hover-value'))).toBe(
      bars.find((bar) => bar.time === observed)!.close,
    );
    await dispatchTouch(session, 'touchEnd', []);
    await expect(summary(page)).toHaveText(latest);
    await page.keyboard.press('Escape');
    await expect(tooltip(page)).not.toBeVisible();

    await dispatchTouch(session, 'touchStart', [origin]);
    // Continuous native input crosses both recognition and scroll-start thresholds,
    // then provides actual scrolling frames. Two moves only initialize LWC's pan.
    for (const offset of [15, 30, 45, 60, 80]) {
      await dispatchTouch(session, 'touchMove', [{ ...origin, x: origin.x + offset }]);
      await page.waitForTimeout(20);
    }
    await dispatchTouch(session, 'touchEnd', []);
    await expect
      .poll(() => chart(page).getAttribute('data-visible-from'))
      .not.toBe(initialRange[0]);
    const panned =
      Number(await chart(page).getAttribute('data-visible-to')) -
      Number(await chart(page).getAttribute('data-visible-from'));
    const fingers = [
      { x: origin.x - 35, y: origin.y, id: 1 },
      { x: origin.x + 35, y: origin.y, id: 2 },
    ];
    await dispatchTouch(session, 'touchStart', fingers);
    for (const distance of [50, 70, 90]) {
      await dispatchTouch(session, 'touchMove', [
        { ...fingers[0], x: origin.x - distance },
        { ...fingers[1], x: origin.x + distance },
      ]);
      await page.waitForTimeout(20);
    }
    await dispatchTouch(session, 'touchEnd', []);
    await expect
      .poll(
        async () =>
          Number(await chart(page).getAttribute('data-visible-to')) -
          Number(await chart(page).getAttribute('data-visible-from')),
      )
      .toBeLessThan(panned);
    const zoomed = [
      await chart(page).getAttribute('data-visible-from'),
      await chart(page).getAttribute('data-visible-to'),
    ];
    const chartClicks = () =>
      page.evaluate(
        () => (window as unknown as { chartCancelClicks: unknown[] }).chartCancelClicks.length,
      );
    const beforeCancelClicks = await chartClicks();
    const beforeCancelEnds = (await touches(page)).filter(
      (event) => event.type === 'touchend',
    ).length;
    await dispatchTouch(session, 'touchStart', [origin]);
    await dispatchTouch(session, 'touchCancel', []);
    await expect(tooltip(page)).not.toBeVisible();
    // Detach just as in the actual failed live sequence. The next first tap,
    // not a keyboard fallback or a second tap, must open the real menu.
    await session.detach();
    expect(await chartClicks()).toBe(beforeCancelClicks);
    expect((await touches(page)).filter((event) => event.type === 'touchend')).toHaveLength(
      beforeCancelEnds,
    );
    await expect(summary(page)).toHaveText(latest);
    expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
    const periodTrigger = page.getByRole('button', { name: '조회 기간 · 1개월', exact: true });
    await periodTrigger.tap();
    const periodMenu = page.getByRole('menu', { name: /^조회 기간/ });
    await expect(periodMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(periodMenu).not.toBeVisible();
    await expect(periodTrigger).toBeFocused();

    const cancelBeforeOutsideTap = async () => {
      await page.evaluate(() => scrollTo(0, 0));
      const bounds = (await chart(page).boundingBox())!;
      const active = await context.newCDPSession(page);
      const point = { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.4, id: 1 };
      const clicks = await chartClicks();
      const ends = (await touches(page)).filter((event) => event.type === 'touchend').length;
      try {
        await dispatchTouch(active, 'touchStart', [point]);
        await dispatchTouch(active, 'touchCancel', []);
      } finally {
        await active.detach();
      }
      expect(await chartClicks()).toBe(clicks);
      expect((await touches(page)).filter((event) => event.type === 'touchend')).toHaveLength(ends);
      await expect(summary(page)).toHaveText(latest);
      await expect(tooltip(page)).not.toBeVisible();
    };
    await cancelBeforeOutsideTap();
    const more = page.getByRole('button', { name: '더보기', exact: true });
    await more.tap();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#indicator-more')).toBeVisible();
    await more.tap();
    await expect(page.locator('#indicator-more')).not.toBeVisible();
    await cancelBeforeOutsideTap();
    await page.getByRole('button', { name: /^지표 설명/ }).tap();
    await expect(page.getByRole('dialog', { name: '지표 설명', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '지표 설명' })).not.toBeVisible();
    expect([
      await chart(page).getAttribute('data-visible-from'),
      await chart(page).getAttribute('data-visible-to'),
    ]).toEqual(zoomed);
    expect(
      await canvas!.evaluate(
        (element) =>
          element.isConnected &&
          element === document.querySelector('[data-chart-kind="analysis"] canvas'),
      ),
    ).toBe(true);

    // A new genuine drag and pinch must still work after cleanup. Do not
    // recreate the chart or replace input with synthetic DOM events.
    await page.evaluate(() => scrollTo(0, 0));
    const recoveredBox = (await chart(page).boundingBox())!;
    const recoveredPoint = {
      x: recoveredBox.x + recoveredBox.width * 0.5,
      y: recoveredBox.y + recoveredBox.height * 0.4,
      id: 1,
    };
    const recovered = await context.newCDPSession(page);
    let finalZoom: (string | null)[] = [];
    try {
      await dispatchTouch(recovered, 'touchStart', [recoveredPoint]);
      for (const offset of [-15, -30, -45, -60, -80]) {
        await dispatchTouch(recovered, 'touchMove', [
          { ...recoveredPoint, x: recoveredPoint.x + offset },
        ]);
        await page.waitForTimeout(20);
      }
      await dispatchTouch(recovered, 'touchEnd', []);
      await expect.poll(() => chart(page).getAttribute('data-visible-from')).not.toBe(zoomed[0]);
      const beforePinch =
        Number(await chart(page).getAttribute('data-visible-to')) -
        Number(await chart(page).getAttribute('data-visible-from'));
      const recoveredFingers = [
        { ...recoveredPoint, x: recoveredPoint.x - 25 },
        { ...recoveredPoint, x: recoveredPoint.x + 25, id: 2 },
      ];
      await dispatchTouch(recovered, 'touchStart', recoveredFingers);
      for (const distance of [40, 60, 80]) {
        await dispatchTouch(recovered, 'touchMove', [
          { ...recoveredFingers[0], x: recoveredPoint.x - distance },
          { ...recoveredFingers[1], x: recoveredPoint.x + distance },
        ]);
        await page.waitForTimeout(20);
      }
      await dispatchTouch(recovered, 'touchEnd', []);
      await expect
        .poll(
          async () =>
            Number(await chart(page).getAttribute('data-visible-to')) -
            Number(await chart(page).getAttribute('data-visible-from')),
        )
        .toBeLessThan(beforePinch);
      const beforeCanceledPan = await chart(page).getAttribute('data-visible-logical-from');
      await dispatchTouch(recovered, 'touchStart', [recoveredPoint]);
      for (const offset of [15, 30, 45, 60, 80]) {
        await dispatchTouch(recovered, 'touchMove', [
          { ...recoveredPoint, x: recoveredPoint.x + offset },
        ]);
        await page.waitForTimeout(20);
      }
      await expect
        .poll(() => chart(page).getAttribute('data-visible-logical-from'))
        .not.toBe(beforeCanceledPan);
      const cancelClicks = await chartClicks();
      const cancelEnds = (await touches(page)).filter((event) => event.type === 'touchend').length;
      const atCancel = [
        await chart(page).getAttribute('data-visible-logical-from'),
        await chart(page).getAttribute('data-visible-logical-to'),
      ];
      await dispatchTouch(recovered, 'touchCancel', []);
      const frames = await chart(page).evaluate(async (element) => {
        const values: { frame: number; from: string | undefined; to: string | undefined }[] = [];
        for (let frame = 0; frame < 20; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          values.push({
            frame,
            from: (element as HTMLElement).dataset.visibleLogicalFrom,
            to: (element as HTMLElement).dataset.visibleLogicalTo,
          });
        }
        return values;
      });
      await info.attach('canceled-pan-logical-frames.json', {
        body: Buffer.from(
          JSON.stringify({
            atCancel,
            frames,
            note: 'Observed native cancel range; no claimed kinetic behavior without reading this evidence.',
          }),
        ),
        contentType: 'application/json',
      });
      for (const frame of frames) {
        expect(Number(frame.from)).toBeCloseTo(Number(atCancel[0]), 8);
        expect(Number(frame.to)).toBeCloseTo(Number(atCancel[1]), 8);
      }
      expect(await chartClicks()).toBe(cancelClicks);
      expect((await touches(page)).filter((event) => event.type === 'touchend')).toHaveLength(
        cancelEnds,
      );
      await expect(summary(page)).toHaveText(latest);
      finalZoom = [
        await chart(page).getAttribute('data-visible-from'),
        await chart(page).getAttribute('data-visible-to'),
      ];
    } finally {
      await recovered.detach();
    }
    await periodTrigger.tap();
    await expect(periodMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(periodMenu).not.toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await ready(page);
    expect([
      await chart(page).getAttribute('data-visible-from'),
      await chart(page).getAttribute('data-visible-to'),
    ]).toEqual(finalZoom);
    expect(
      await canvas!.evaluate(
        (element) =>
          element.isConnected &&
          element === document.querySelector('[data-chart-kind="analysis"] canvas'),
      ),
    ).toBe(true);
    const events = await touches(page);
    expect(events.some((event) => event.trusted && event.touches === 2)).toBe(true);
    expect(events.some((event) => event.trusted && event.type === 'touchcancel')).toBe(true);
    await info.attach('native-multi-touch-capability.json', {
      body: Buffer.from(
        JSON.stringify({
          engine: browserName,
          method: 'official CDP Input.dispatchTouchEvent',
          genuineBrowserInput: true,
          events,
        }),
      ),
      contentType: 'application/json',
    });
  });
});
