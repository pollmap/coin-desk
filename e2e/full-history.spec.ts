import { test, expect } from '@playwright/test';
import { historyBands } from '../shared/history-bands';
import { DAY } from '../shared/math';
import type { Point } from '../shared/types';

test('DOGE band chooses the oldest source and preserves prices before the 730-day preparation period', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=net:mvrv&price_source=upbit');
  await expect(page.locator('[data-chart-kind="analysis"]')).toBeVisible();
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택' });
  await picker.getByRole('textbox', { name: '지표 검색' }).fill('가격 위치');
  await picker.getByRole('link', { name: /가격 위치/ }).click();
  await expect(page).toHaveURL(/price_source=reference/);
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const response = await page.request.get('/api/v1/reference?asset=DOGE&limit=1000');
  expect(response.ok()).toBe(true);
  const data = await response.json();
  const points = data.data as Point[];
  await expect(chart).toHaveAttribute('data-visible-from', String(points[0].time));
  expect(points.length).toBeGreaterThan(730);
  expect(points.slice(0, 731).every((p, i) => i === 0 || p.time - points[i - 1].time === DAY)).toBe(
    true,
  );
  expect(historyBands(points.slice(0, 730))).toEqual([]);
  expect(historyBands(points.slice(0, 731))[0].time).toBe(points[730].time);
  expect(Number(await chart.getAttribute('data-visible-from'))).toBeLessThan(points[730].time);
  const latest = await page.locator('.analysis-reading-value').innerText();
  await chart.press('Home');
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await expect(page.locator('.analysis-reading-date,.indicator-provenance')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('reading_date')).toBe(false);
  await expect(page.locator('.analysis-reading-value')).not.toContainText('—');
});

test('an explicit KRW band retains its market, currency and entire actual traded history', async ({
  page,
}) => {
  await page.goto('/coins/DOGE?metric=view:rainbow&price_source=upbit&period=all');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  const response = await page.request.get(
    '/api/v1/candles?asset=DOGE&market=upbit&interval=1d&limit=2',
  );
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.meta.market).toBe('upbit');
  expect(data.meta.unit).toBe('KRW');
  await expect(chart).toHaveAttribute('data-visible-from', String(data.data[0].time));
  await expect(chart).toHaveAttribute('data-asset', 'DOGE');
  await expect(page.locator('.analysis-reading-value')).toContainText('₩');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
  await expect(page.locator('.analysis-reading-date,.indicator-provenance')).toHaveCount(0);
});

test('an explicit young-price fixture shows its full price history without inventing a 730-day band', async ({
  page,
}) => {
  const last = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
  // Deliberately bounded synthetic source observations, not a claim about PENGU production coverage.
  const points = Array.from({ length: 200 }, (_, i) => ({
    time: last - (199 - i) * DAY,
    value: 1 + i / 1000,
  }));
  const requests: string[] = [];
  await page.route('**/api/v1/reference?*', async (route) => {
    const asset = new URL(route.request().url()).searchParams.get('asset');
    requests.push(asset!);
    if (asset !== 'PENGU') return route.continue();
    await route.fulfill({
      json: {
        data: points,
        price: [],
        nextCursor: null,
        meta: {
          source: 'Explicit synthetic young price fixture',
          unit: 'USD',
          market: 'PENGU / isolated test data',
          historyStart: points[0].time,
          dataAsOf: last,
          fetchedAt: last + DAY,
          stale: false,
        },
      },
    });
  });
  await page.goto('/coins/PENGU?metric=view:rainbow&price_source=reference&period=all');
  const chart = page.locator('[data-chart-kind="analysis"]');
  await expect(chart).toHaveAttribute('data-range-ready', '1');
  await expect(chart).toHaveAttribute('data-asset', 'PENGU');
  await expect(chart).toHaveAttribute('data-observations', '200');
  await expect(chart).toHaveAttribute('data-visible-from', String(points[0].time));
  expect(requests).toEqual(['PENGU']);
  expect(historyBands(points)).toEqual([]);
  await expect(page.locator('.band-context')).toHaveText('아직 밴드를 표시할 수 없습니다.');
  await expect(page.locator('.analysis-reading-value')).not.toContainText('—');
  await expect(page.locator('.indicator-workspace')).toHaveAttribute(
    'data-availability',
    'insufficient-history',
  );
  await expect(page.locator('.analysis-reading-date,.indicator-provenance')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
});
