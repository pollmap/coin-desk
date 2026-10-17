import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [320, 390, 768, 1000, 1280, 1440, 1920])
  test(`same indicator comparison layout, accessible settings and latest-value tooltips ${width}px`, async ({
    page,
  }) => {
    const initialRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/indicator-comparison?')) initialRequests.push(r.url());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/compare');
    const chart = page.locator('[data-chart-kind=analysis]');
    await expect(chart).toHaveAttribute('data-range-ready', '1');
    await expect(page.getByRole('main')).toHaveCount(1);
    const readingSizes = await page.locator('.analysis-legend').evaluate((element) => ({
      value: parseFloat(
        getComputedStyle(element.querySelector('.analysis-reading-value')!).fontSize,
      ),
      unit: parseFloat(getComputedStyle(element.querySelector('.analysis-primary-unit')!).fontSize),
    }));
    expect(readingSizes.value).toBeGreaterThanOrEqual(16);
    expect(readingSizes.unit).toBeGreaterThanOrEqual(12);
    expect(
      (
        await new AxeBuilder({ page })
          .withRules(['landmark-main-is-top-level', 'landmark-no-duplicate-main'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(initialRequests).toHaveLength(1);
    await expect(page.locator('.indicator-comparison-results tbody tr')).toHaveCount(2);
    const surface = page.locator('.analysis-surface');
    const box = (await surface.boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(width < 768 ? 280 : 320);
    if (width >= 1280) expect(box.height).toBeGreaterThanOrEqual(420);
    const latest = await page.locator('.analysis-reading-value').innerText();
    await page.mouse.move(box.x + box.width * 0.5, box.y + 100);
    await expect(page.getByTestId('chart-tooltip')).toBeVisible();
    await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
    await chart.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await expect(page).not.toHaveURL(/reading_date=/);
    await expect(page.locator('.analysis-reading-date,.analysis-reading-reset')).toHaveCount(0);
    await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
    await expect(page.locator('.indicator-comparison-results th')).toHaveText(['코인', '지표값']);
    await page.getByRole('button', { name: '비교 설정 변경' }).click();
    const dialog = page.getByRole('dialog', { name: '비교 설정' });
    await expect(dialog).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '비교 설정 변경' })).toBeFocused();
    await page.getByRole('button', { name: /테마로 변경/ }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });

test('unsupported asset, provider changes, save and reopen keep the intended indicator pair', async ({
  page,
}) => {
  await page.goto('/compare?mode=indicator&assets=ONDO,BTC&metric=net%3Amvrv&period=5y');
  await expect(page.locator('.indicator-comparison-results tbody tr').first()).toContainText(
    '미지원',
  );
  await expect(page.getByText('지표를 불러오는 중…')).toHaveCount(0);
  await expect(page.locator('.analysis-reading-value')).toContainText('BTC');
  await expect(
    page.locator('.indicator-comparison-results tbody tr').first().locator('td').nth(1),
  ).toHaveText('미지원');
  await page.getByRole('link', { name: 'ONDO', exact: true }).click();
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute(
    'data-primary-metric',
    'rsi',
  );
  await page.goBack();
  await expect(page.locator('.indicator-comparison-results tbody tr').first()).toContainText(
    '미지원',
  );
  await page.getByRole('button', { name: '비교 설정 변경' }).click();
  const dialog = page.getByRole('dialog', { name: '비교 설정' });
  await dialog.getByLabel('지표', { exact: true }).selectOption('rsi');
  await dialog.getByLabel('비교 거래소·통화').selectOption('binance');
  await dialog.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute(
    'data-primary-metric',
    'rsi',
  );
  await expect(page.locator('.indicator-comparison-results tbody tr').first()).toContainText(
    'ONDO',
  );
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-range-ready', '1');
  const latestValue = await page.locator('.analysis-reading-value').innerText();
  await page.locator('[data-chart-kind=analysis]').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(page).not.toHaveURL(/reading_date=/);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latestValue);
  await page.getByRole('button', { name: '비교 분석 저장' }).click();
  await page.getByLabel('작업공간 이름').fill('ONDO 추세 비교');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('link', { name: /ONDO 추세 비교/ }).click();
  await expect(page).toHaveURL(/assets=ONDO%2CBTC/);
  await expect(page).toHaveURL(/source=binance/);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latestValue);
  await expect(page.locator('.analysis-reading-date,.analysis-reading-reset')).toHaveCount(0);
  await page.locator('.indicator-comparison-info > summary').click();
  await page.getByRole('link', { name: '지표 설명', exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/rsi/);
  await page.goBack();
  await expect(page.locator('[data-chart-kind=analysis]')).toBeVisible();
  await page.getByRole('link', { name: '가격 성과 비교', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가격 성과 비교' })).toBeVisible();
  await page.getByRole('link', { name: '같은 지표 비교', exact: true }).click();
  await expect(page.locator('.indicator-comparison-results')).toBeVisible();
});

test('three assets, explicit dates and enlarged keyboard layout survive save and reopen', async ({
  page,
}) => {
  const from = 1609459200,
    to = 1704067200;
  await page.goto(
    `/compare?mode=indicator&assets=BTC,ETH,DOGE&metric=drawdown&source=binance&period=all&from=${from}&to=${to}`,
  );
  await expect(page.locator('.indicator-comparison-results tbody tr')).toHaveCount(3);
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-range-ready', '1');
  const latestValue = await page.locator('.analysis-reading-value').innerText();
  await page.locator('[data-chart-kind=analysis]').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(page).not.toHaveURL(/reading_date=/);
  await expect(page.locator('.analysis-reading-value')).toHaveText(latestValue);
  await page.getByRole('button', { name: '비교 분석 저장' }).click();
  await page.getByLabel('작업공간 이름').fill('세 코인 낙폭');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('link', { name: /세 코인 낙폭/ }).click();
  await expect(page).toHaveURL(new RegExp(`from=${from}`));
  await expect(page).toHaveURL(new RegExp(`to=${to}`));
  await expect(page.locator('.analysis-reading-value')).toHaveText(latestValue);
  await expect(page.locator('.analysis-reading-date,.analysis-reading-reset')).toHaveCount(0);
  await page.setViewportSize({ width: 640, height: 450 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByRole('button', { name: '비교 설정 변경' }).click();
  await expect(page.getByRole('dialog', { name: '비교 설정' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '비교 설정 변경' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('late responses cannot overwrite the new metric; settlement rates use separate panes', async ({
  page,
}) => {
  await page.route('**/api/v1/indicator-comparison?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('metric') === 'net:mvrv')
      await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('/compare');
  await page.getByRole('button', { name: '비교 설정 변경' }).click();
  const dialog = page.getByRole('dialog', { name: '비교 설정' });
  await dialog.getByLabel('지표', { exact: true }).selectOption('futures:funding');
  await dialog.getByRole('button', { name: '적용', exact: true }).click();
  const chart = page.locator('[data-chart-kind=analysis]');
  await expect(chart).toHaveAttribute('data-primary-metric', 'futures:funding');
  await expect(chart).toHaveAttribute('data-panels', '1');
  await page.waitForTimeout(1700);
  await expect(chart).toHaveAttribute('data-primary-metric', 'futures:funding');
});

test('legacy historical date gaps do not replace the latest peer value or create a public date panel', async ({
  page,
}) => {
  const response = await page.request.get(
    '/api/v1/indicator-comparison?assets=BTC,ETH&metric=net%3Amvrv&source=coinmetrics&period=5y',
  );
  expect(response.ok()).toBe(true);
  const result = await response.json();
  const time = result.common.first;
  expect(typeof time).toBe('number');
  result.rows[1].data = result.rows[1].data.filter(
    (point: { time: number }) => point.time !== time,
  );
  await page.route('**/api/v1/indicator-comparison?**', (route) => route.fulfill({ json: result }));
  await page.goto(
    '/compare?mode=indicator&assets=BTC,ETH&metric=net%3Amvrv&source=coinmetrics&period=5y&reading_date=' +
      time,
  );
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.analysis-reading-value')).toContainText('BTC');
  const peer = page.locator('.indicator-comparison-results tbody tr').nth(1);
  const expected = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(result.rows[1].data.at(-1).value);
  await expect(peer.locator('td').nth(1)).toHaveText(expected + ' ' + result.unit);
  await expect(peer.locator('td')).toHaveCount(2);
  await expect(page.locator('.analysis-reading-date')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp('reading_date=' + time));
  const chart = page.locator('[data-chart-kind=analysis]');
  const latest = await page.locator('.analysis-reading-value').innerText();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + 100);
  await expect(page.getByTestId('chart-tooltip')).toBeVisible();
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await page.getByRole('button', { name: '비교 분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름').fill('이전 비교 날짜');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('link', { name: /이전 비교 날짜/ }).click();
  await expect(page).toHaveURL(new RegExp(`reading_date=${time}(?:&|$)`));
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await expect(peer.locator('td').nth(1)).toHaveText(expected + ' ' + result.unit);
});
