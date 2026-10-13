import { test, expect } from '@playwright/test';

test('price data info distinguishes selected weekly OHLC from daily reference closes', async ({
  page,
}) => {
  for (const source of ['upbit', 'reference']) {
    await page.goto(`/coins/BTC?metric=view:price&price_source=${source}&interval=1w&period=all`);
    await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
      'data-range-ready',
      '1',
    );
    if (source === 'reference')
      await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
        'data-price-style',
        'line',
      );
    await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
    const provenance = page
      .getByRole('dialog', { name: '데이터 정보', exact: true })
      .locator('.indicator-provenance');
    await expect(provenance).toContainText('표시·계산 주기');
    await expect(provenance).toContainText(
      source === 'reference' ? '1w 종가 집계 · 원천은 일별 확정 USD 종가' : '1w 확정 봉',
    );
    await page.keyboard.press('Escape');
  }
});

for (const [metric, interval, cadence] of [
  ['view:ribbon', '1w', '표시·계산 주기 · 1w 확정 봉'],
  ['view:bb', '1M', '표시·계산 주기 · 1M 확정 봉'],
  ['rsi', '1w', '관측 주기 · 일별 확정 관측'],
  ['net:mvrv', '1h', '관측 주기 · 일별 확정 관측'],
  ['futures:funding', '1d', '관측 주기 · 거래소 정산 주기'],
] as const) {
  test(`${metric} data info uses the definition cadence independently of the URL interval`, async ({
    page,
  }) => {
    await page.goto(
      `/coins/BTC?metric=${encodeURIComponent(metric)}&price_source=upbit&interval=${interval}&period=all`,
    );
    await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
      'data-range-ready',
      '1',
    );
    await page.getByRole('button', { name: '데이터 정보', exact: true }).click();
    const provenance = page
      .getByRole('dialog', { name: '데이터 정보', exact: true })
      .locator('.indicator-provenance');
    await expect(provenance).toContainText(cadence);
    if (['rsi', 'net:mvrv'].includes(metric)) {
      await expect(provenance).not.toContainText(`${interval} 확정 봉`);
    }
  });
}
