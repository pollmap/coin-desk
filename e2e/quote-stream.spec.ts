import { test, expect } from '@playwright/test';

test('live prices preserve the historical canvas, reject out-of-order events and fall back on disconnect', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const sources: EventTarget[] = [];
    class FixtureSource extends EventTarget {
      onerror: (() => void) | null = null;
      closed = false;
      constructor(readonly url: string) {
        super();
        sources.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    Object.assign(window, {
      EventSource: FixtureSource,
      emitQuote(sequence: number, price: number, time: number, connected = true) {
        for (const s of sources as FixtureSource[])
          if (!s.closed)
            s.dispatchEvent(
              new MessageEvent('quotes', {
                data: JSON.stringify({
                  epoch: 'browser-test',
                  sequence,
                  market: 'upbit',
                  connected,
                  quotes: [
                    {
                      asset: 'BTC',
                      market: 'upbit',
                      price,
                      tradedAt: time,
                      receivedAt: Date.now() / 1000,
                    },
                  ],
                }),
              }),
            );
      },
    });
  });
  await page.goto('/coins/BTC?metric=net%3Amvrv&market=upbit');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const canvas = await chart.locator('canvas').first().elementHandle();
  const latest = await page.locator('.analysis-legend').innerText();
  const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
  const emit = async (sequence: number, price: number, time: number, connected = true) =>
    page.evaluate(
      ({ sequence, price, time, connected }) => {
        (
          window as unknown as { emitQuote: (s: number, p: number, t: number, c: boolean) => void }
        ).emitQuote(sequence, price, time, connected);
      },
      { sequence, price, time, connected },
    );
  await emit(1, 85000000, now);
  await expect(page.locator('.detail-quote')).toContainText('₩85,000,000');
  await emit(2, 1, now - 1);
  await expect(page.locator('.detail-quote')).toContainText('₩85,000,000');
  await expect(page.locator('.analysis-legend')).toHaveText(latest, { useInnerText: true });
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
  await emit(3, 86000000, now + 1, false);
  await expect(page.locator('.detail-quote')).toContainText('₩84,000,000');
  await emit(4, 87000000, now + 2);
  await expect(page.locator('.detail-quote')).toContainText('₩87,000,000');
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
});

test('silent stream reconnects after ten seconds without recreating the chart', async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const sources: any[] = [];
    class SilentSource extends EventTarget {
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
    Object.assign(window, { EventSource: SilentSource, sources });
  });
  await page.goto('/coins/BTC?metric=net%3Amvrv&market=upbit');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const canvas = await chart.locator('canvas').first().elementHandle();
  const before = await page.evaluate(() => (window as any).sources.length);
  await page.clock.fastForward(11000);
  expect(await page.evaluate(() => (window as any).sources.length)).toBe(before + 1);
  expect(await page.evaluate(() => (window as any).sources.at(-2).closed)).toBe(true);
  await page.evaluate(() => {
    const data = {
      epoch: 'recovered',
      sequence: 1,
      market: 'upbit',
      connected: true,
      quotes: [
        {
          asset: 'BTC',
          market: 'upbit',
          price: 88000000,
          tradedAt: Date.now() / 1000,
          receivedAt: Date.now() / 1000,
        },
      ],
    };
    (window as any).sources
      .at(-1)
      .dispatchEvent(new MessageEvent('quotes', { data: JSON.stringify(data) }));
    // Queued events from the closed generation must not change the connection state.
    (window as any).sources
      .at(-2)
      .dispatchEvent(
        new MessageEvent('quotes', {
          data: JSON.stringify({ ...data, epoch: 'closed', connected: false }),
        }),
      );
  });
  await expect(page.locator('.detail-quote')).toContainText('₩88,000,000');
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
});
