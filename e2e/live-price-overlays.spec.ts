import { expect, test, type Page } from '@playwright/test';

const chart = (page: Page) => page.locator('[data-chart-kind="analysis"]');
const summary = (page: Page) => page.locator('.analysis-reading-value');

/** Explicit isolated stream fixtures; this suite does not certify provider values. */
async function installQuotes(page: Page) {
  // Make the fixture server's minute snapshot stale without changing any product limits.
  await page.clock.install({ time: new Date(Date.now() + 600000) });
  await page.addInitScript(() => {
    const sources: Source[] = [];
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
    const paints: string[] = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      paints.push(String(text));
      if (paints.length > 2048) paints.splice(0, 1024);
      if (maxWidth === undefined) fillText.call(this, text, x, y);
      else fillText.call(this, text, x, y, maxWidth);
    };
    Object.assign(window, {
      EventSource: Source,
      overlayAxisPaints: paints,
      emitOverlayQuote(
        sequence: number,
        asset: string,
        market: string,
        price: number,
        tradedAt: number,
        connectionMarket: string,
      ) {
        for (const source of sources)
          if (
            !source.closed &&
            new URL(source.url, location.href).searchParams.get('market') === connectionMarket
          )
            source.dispatchEvent(
              new MessageEvent('quotes', {
                data: JSON.stringify({
                  epoch: 'overlay-price-regression',
                  sequence,
                  market,
                  connected: true,
                  quotes: [
                    {
                      asset,
                      market,
                      price,
                      tradedAt,
                      receivedAt: Date.now() / 1000,
                      lastTradeId: sequence,
                    },
                  ],
                }),
              }),
            );
      },
    });
  });
}

async function emit(
  page: Page,
  sequence: number,
  price: number,
  tradedAt: number,
  market = 'binance',
  asset = 'BTC',
  connectionMarket = market,
) {
  await page.evaluate(
    ({ sequence, asset, market, price, tradedAt, connectionMarket }) =>
      (
        window as unknown as {
          emitOverlayQuote: (
            sequence: number,
            asset: string,
            market: string,
            price: number,
            tradedAt: number,
            connectionMarket: string,
          ) => void;
        }
      ).emitOverlayQuote(sequence, asset, market, price, tradedAt, connectionMarket),
    { sequence, asset, market, price, tradedAt, connectionMarket },
  );
}

for (const metric of ['view:supertrend', 'view:ribbon', 'view:bb'])
  test(`overlay current price ${metric} stays separate from closed data and uses the chart source`, async ({
    page,
  }) => {
    await installQuotes(page);
    // The explicit chart source wins over a conflicting legacy header-market parameter.
    await page.goto(
      `/coins/BTC?metric=${encodeURIComponent(metric)}&price_source=binance&market=upbit&period=all&interval=1d`,
    );
    const surface = chart(page);
    await expect(surface).toHaveAttribute('data-range-ready', '1');
    await expect(page.locator('.quote-source-label')).toContainText('Binance · USDT');
    await expect(surface).toHaveAttribute('data-axis-reading', 'close');
    const observations = await surface.getAttribute('data-observations');
    const from = await surface.getAttribute('data-visible-from');
    const to = await surface.getAttribute('data-visible-to');
    const latest = await summary(page).innerText();
    const secondary = await page.locator('.analysis-secondary-readings').innerText();
    const canvas = await surface.locator('canvas').first().elementHandle();
    const now = await page.evaluate(() => Math.floor(Date.now() / 1000));

    await emit(page, 1, 999999, now, 'upbit', 'BTC', 'binance');
    await emit(page, 2, 999999, now, 'binance', 'ETH');
    await expect(surface).not.toHaveAttribute('data-live-price');
    await emit(page, 3, 60001, now);
    await expect(surface).toHaveAttribute('data-live-price', '60001');
    await expect(surface).toHaveAttribute('data-axis-reading', 'live');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { overlayAxisPaints: string[] }).overlayAxisPaints.includes(
            '현재가',
          ),
        ),
      )
      .toBe(true);
    await expect(summary(page)).toHaveText(latest);
    await expect(page.locator('.analysis-secondary-readings')).toHaveText(secondary, {
      useInnerText: true,
    });
    await expect(surface).toHaveAttribute('data-observations', observations!);
    await expect(surface).toHaveAttribute('data-visible-from', from!);
    await expect(surface).toHaveAttribute('data-visible-to', to!);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);

    await surface.press('End');
    await expect(surface).toHaveAttribute('data-hover-value');
    expect(Number(await surface.getAttribute('data-hover-value'))).not.toBe(60001);
    await expect(summary(page)).toHaveText(latest);
    await page.keyboard.press('Escape');
    await emit(page, 4, 1, now - 1);
    const futureFrom = await page.evaluate(() => Math.floor(Date.now() / 1000));
    await emit(page, 5, 1, futureFrom + 120);
    await expect(surface).toHaveAttribute('data-live-price', '60001');
    await page.clock.fastForward(301000);
    await expect(surface).not.toHaveAttribute('data-live-price');
    await expect(surface).toHaveAttribute('data-axis-reading', 'close');
    await expect(page.locator('.quote-source-label')).toContainText(' · 지연');
    await expect(summary(page)).toHaveText(latest);
    await expect(surface).toHaveAttribute('data-visible-from', from!);
    await expect(surface).toHaveAttribute('data-visible-to', to!);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);

    const recoveredAt = await page.evaluate(() => Math.floor(Date.now() / 1000));
    await emit(page, 6, 60002, recoveredAt);
    await expect(surface).toHaveAttribute('data-live-price', '60002');
    await page.getByRole('button', { name: '가격 거래소 선택', exact: true }).click();
    await page
      .getByRole('combobox', { name: '현재 가격 거래소', exact: true })
      .selectOption('upbit');
    await page.keyboard.press('Escape');
    await expect(page.locator('.quote-source-label')).toContainText('Upbit · KRW');
    await expect(surface).toHaveAttribute('data-range-ready', '1');
    await expect(surface).not.toHaveAttribute('data-live-price');
    const selection = new URL(page.url()).searchParams;
    expect(selection.get('market')).toBe('upbit');
    expect(selection.get('price_source')).toBe('upbit');
    expect(selection.get('period')).toBe('all');
    await emit(page, 7, 60003, recoveredAt, 'binance', 'BTC', 'upbit');
    await expect(surface).not.toHaveAttribute('data-live-price');
    await emit(page, 8, 84000111, recoveredAt, 'upbit');
    await expect(surface).toHaveAttribute('data-live-price', '84000111');
    await expect(surface).toHaveAttribute('data-axis-reading', 'live');
    await expect(page.locator('.analysis-legend')).toContainText('KRW');
    await page.getByRole('button', { name: '코인 변경 · 비트코인 BTC', exact: true }).click();
    await page.getByRole('searchbox', { name: '코인 검색', exact: true }).fill('ETH');
    await page
      .locator('.coin-result-list')
      .getByRole('button', { name: /이더리움 ETH/ })
      .click();
    await expect(surface).toHaveAttribute('data-asset', 'ETH');
    await expect(surface).toHaveAttribute('data-range-ready', '1');
    await expect(surface).not.toHaveAttribute('data-live-price');
    const ethClosed = await summary(page).innerText();
    await emit(page, 9, 84000112, recoveredAt, 'upbit', 'BTC');
    await expect(surface).not.toHaveAttribute('data-live-price');
    await emit(page, 10, 4200011, recoveredAt, 'upbit', 'ETH');
    await expect(surface).toHaveAttribute('data-live-price', '4200011');
    await expect(summary(page)).toHaveText(ethClosed);
    expect(new URL(page.url()).searchParams.get('metric')).toBe(metric);
    expect(new URL(page.url()).searchParams.get('period')).toBe('all');
  });

test('indicator-only and USD reference views never borrow a live spot-price axis', async ({
  page,
}) => {
  await installQuotes(page);
  for (const metric of ['net:mvrv', 'net:nupl', 'view:hash_ribbons']) {
    await page.goto(
      `/coins/BTC?metric=${encodeURIComponent(metric)}&price_source=binance&market=binance&period=all`,
    );
    await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
    const before = await summary(page).innerText();
    const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
    await emit(page, 1, 60001, now);
    await expect(page.locator('.detail-quote')).toContainText('60,001');
    await expect(chart(page)).not.toHaveAttribute('data-live-price');
    await expect(chart(page)).toHaveAttribute('data-axis-reading', 'close');
    await expect(summary(page)).toHaveText(before);
  }
  for (const metric of ['view:price', 'view:ribbon', 'view:bb']) {
    await page.goto(
      `/coins/BTC?metric=${encodeURIComponent(metric)}&price_source=reference&market=upbit&period=all`,
    );
    await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
    await expect(page.locator('.analysis-legend')).toContainText('USD');
    const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
    await emit(page, 1, 84000111, now, 'upbit');
    await expect(chart(page)).not.toHaveAttribute('data-live-price');
    await expect(chart(page)).toHaveAttribute('data-axis-reading', 'close');
  }
  await page.goto('/coins/BTC?metric=view%3Asupertrend&price_source=reference&period=all');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(chart(page)).toHaveCount(0);
});
