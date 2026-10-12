import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('market prices, explicit indicators and performance comparison are distinct destinations', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: '비트코인 BTC', exact: true }).click();
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-primary-metric', 'price');
  await expect(chart).toHaveAttribute('data-price-style', 'candles');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
  await page.getByRole('link', { name: '가격 성과 비교', exact: true }).click();
  expect(new URL(page.url()).searchParams.get('mode')).toBe('performance');
  expect(new URL(page.url()).searchParams.get('assets')).toBe('BTC,ETH');
  expect(new URL(page.url()).searchParams.get('market')).toBe('upbit');
  await page.goBack();
  await page
    .getByRole('navigation', { name: '자주 보는 지표' })
    .getByRole('link', { name: 'MVRV', exact: true })
    .click();
  await expect(chart).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await page
    .getByRole('navigation', { name: '자주 보는 지표' })
    .getByRole('link', { name: '가격', exact: true })
    .click();
  await expect(chart).toHaveAttribute('data-primary-metric', 'price');
  await page.getByRole('button', { name: '가격 거래소와 체결 시각', exact: true }).click();
  await page
    .getByRole('combobox', { name: '현재 가격 거래소', exact: true })
    .selectOption('binance');
  await page.keyboard.press('Escape');
  const params = new URL(page.url()).searchParams;
  expect(params.get('market')).toBe('binance');
  expect(params.get('price_source')).toBe('binance');
  await expect(page.locator('.detail-quote')).toContainText('Binance · USDT');
  await expect(page.locator('.analysis-legend')).toContainText('USDT');
});

test('line/candle selection preserves the user window and survives save and restore', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=view%3Aprice&price_source=upbit&period=1y&log=0');
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: '구간·확대', exact: true }).click();
  await page.getByRole('button', { name: '차트 확대', exact: true }).click();
  await page.keyboard.press('Escape');
  const from = await chart.getAttribute('data-visible-from');
  const to = await chart.getAttribute('data-visible-to');
  await page.getByRole('combobox', { name: '가격 차트 표시', exact: true }).selectOption('line');
  await expect(chart).toHaveAttribute('data-price-style', 'line');
  await expect(chart).toHaveAttribute('data-visible-from', from!);
  await expect(chart).toHaveAttribute('data-visible-to', to!);
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('가격 종가선');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('button', { name: '분석 저장 닫기', exact: true }).click();
  await page.goto('/workspace');
  await page.getByRole('link', { name: /가격 종가선/ }).click();
  await expect(chart).toHaveAttribute('data-price-style', 'line');
  await expect(page.getByRole('combobox', { name: '가격 차트 표시' })).toHaveValue('line');
});

test('USD reference prices remain close lines and do not borrow a KRW current price', async ({
  page,
}) => {
  await page.goto(
    '/coins/BTC?metric=view%3Aprice&price_source=reference&period=1y&chart_style=candles',
  );
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute(
    'data-price-style',
    'line',
  );
  await expect(page.locator('.detail-quote')).toContainText('USD 참조 · 확정 종가');
  await expect(page.getByRole('combobox', { name: '가격 차트 표시' })).toHaveCount(0);
});

test('Binance minute ticker does not become a verified trade reference line', async ({ page }) => {
  await page.addInitScript(() => {
    class Source extends EventTarget {
      onerror = null;
      close() {}
    }
    Object.assign(window, { EventSource: Source });
  });
  await page.goto('/coins/BTC?metric=view%3Aprice&price_source=binance&market=binance&period=1m');
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.detail-quote')).toContainText('Binance · USDT');
  await expect(chart).not.toHaveAttribute('data-live-price');
});

test('live reference price never replaces historical candles, recreates the canvas or accepts an old event', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const sources: EventTarget[] = [];
    class Source extends EventTarget {
      closed = false;
      onerror = null;
      constructor(readonly url: string) {
        super();
        sources.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    Object.assign(window, {
      EventSource: Source,
      emitPrice(sequence: number, price: number, tradedAt: number) {
        for (const source of sources as Source[])
          if (!source.closed)
            source.dispatchEvent(
              new MessageEvent('quotes', {
                data: JSON.stringify({
                  epoch: 'price-regression',
                  sequence,
                  market: 'upbit',
                  connected: true,
                  quotes: [
                    {
                      asset: 'BTC',
                      market: 'upbit',
                      price,
                      tradedAt,
                      receivedAt: Date.now() / 1000,
                    },
                  ],
                }),
              }),
            );
      },
    });
  });
  await page.goto('/coins/BTC?metric=view%3Aprice&price_source=upbit&market=upbit&period=1m');
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const candleCount = await chart.getAttribute('data-observations');
  const canvas = await chart.locator('canvas').first().elementHandle();
  const legend = await page.locator('.analysis-legend').innerText();
  const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
  const emit = (sequence: number, price: number, time: number) =>
    page.evaluate(
      ({ sequence, price, time }) =>
        (window as unknown as { emitPrice: (s: number, p: number, t: number) => void }).emitPrice(
          sequence,
          price,
          time,
        ),
      { sequence, price, time },
    );
  await emit(1, 85000000, now);
  await expect(chart).toHaveAttribute('data-live-price', '85000000');
  await emit(2, 1, now - 1);
  await expect(chart).toHaveAttribute('data-live-price', '85000000');
  await emit(3, 86000000, now + 1);
  await expect(chart).toHaveAttribute('data-live-price', '86000000');
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(chart).toHaveAttribute('data-observations', candleCount!);
  await expect(page.locator('.analysis-legend')).toHaveText(legend, { useInnerText: true });
});

for (const width of [320, 390, 768, 1280, 1440])
  test(`price entry geometry and keyboard accessibility ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/coins/BTC');
    const chart = page.locator('[data-chart-kind=analysis]');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    const bounds = (await chart.boundingBox())!;
    expect(bounds.y).toBeLessThanOrEqual(width < 768 ? 280 : 240);
    expect(bounds.height).toBeGreaterThanOrEqual(width < 768 ? 320 : 420);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const audit = await new AxeBuilder({ page }).include('main').analyze();
    expect(audit.violations).toEqual([]);
  });
