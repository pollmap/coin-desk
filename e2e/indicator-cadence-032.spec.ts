import { test, expect } from '@playwright/test';
import { indicatorDefinition } from '../shared/indicator-catalog';

test('weekly actual OHLC and daily reference closes retain their distinct request and rendering contracts without metadata panels', async ({
  page,
}) => {
  for (const source of ['upbit', 'reference']) {
    const observed: URL[] = [];
    page.on('request', (request) => {
      if (/api\/v1\/(candles|reference)\?/.test(request.url()))
        observed.push(new URL(request.url()));
    });
    await page.goto(
      '/coins/BTC?metric=view:price&price_source=' + source + '&interval=1w&period=all',
    );
    const chart = page.locator('[data-chart-kind="analysis"]');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    await expect(chart).toHaveAttribute(
      'data-price-style',
      source === 'reference' ? 'line' : 'candles',
    );
    const requests = observed.filter((url) => url.searchParams.get('asset') === 'BTC');
    if (source === 'reference')
      expect(requests.some((url) => url.pathname.endsWith('/reference'))).toBe(true);
    else
      expect(
        requests.some(
          (url) =>
            url.pathname.endsWith('/candles') &&
            url.searchParams.get('market') === source &&
            url.searchParams.get('interval') === '1w',
        ),
      ).toBe(true);
    await expect(page.locator('.indicator-provenance,.analysis-reading-date')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /CSV|내보내기|공유/ })).toHaveCount(0);
  }
});

for (const [metric, interval, cadence, endpoint, inputInterval] of [
  ['view:ribbon', '1w', '선택한 확정 봉', 'candles', '1w'],
  ['view:bb', '1M', '선택한 확정 봉', 'candles', '1M'],
  ['rsi', '1w', '일별 확정 관측', 'candles', '1d'],
  ['net:mvrv', '1h', '일별 확정 관측', 'network', null],
  ['futures:funding', '1d', '거래소 정산 주기', 'derivatives', null],
] as const) {
  test(
    metric + ' keeps its calculation cadence independent of a hidden metadata panel',
    async ({ page }) => {
      const requests: URL[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/v1/' + endpoint + '?'))
          requests.push(new URL(request.url()));
      });
      await page.goto(
        '/coins/BTC?metric=' +
          encodeURIComponent(metric) +
          '&price_source=upbit&interval=' +
          interval +
          '&period=all',
      );
      const chart = page.locator('[data-chart-kind="analysis"]');
      await expect(chart).toHaveAttribute('data-range-ready', '1');
      expect(indicatorDefinition(metric)!.observationCadence).toBe(cadence);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((url) => url.searchParams.get('asset') === 'BTC')).toBe(true);
      if (inputInterval)
        expect(requests.some((url) => url.searchParams.get('interval') === inputInterval)).toBe(
          true,
        );
      await expect(page.locator('.indicator-provenance,.analysis-reading-date')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
      await expect(page.locator('.analysis-reading-value')).not.toHaveText('—');
    },
  );
}
