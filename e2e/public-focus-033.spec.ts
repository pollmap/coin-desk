import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const chart = (page: Page) => page.locator('[data-chart-kind="analysis"]');
const value = (page: Page) => page.locator('.analysis-reading-value');
async function cleanPublicChart(page: Page) {
  await expect(
    page.locator(
      '.analysis-reading-date,.analysis-reading-reset,.analysis-tools,.analysis-table,.date-navigator,.indicator-provenance',
    ),
  ).toHaveCount(0);
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /데이터 정보|날짜로 이동|링크 공유|링크 복사|내보내기|CSV/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /데이터 정보|차트 날짜 탐색/ })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(
    /확보 시작|수집 시각|계산 버전|관측 변경 식별자|코인별 수집 이력/,
  );
}

for (const width of [390, 1280]) {
  test(`focused analysis, indicator comparison and save reopen stay usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/coins/BTC?metric=view:price&price_source=upbit&period=1y');
    await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
    await cleanPublicChart(page);
    const shortcuts = page.getByRole('navigation', { name: '자주 보는 지표' });
    await shortcuts.getByRole('link', { name: 'MVRV', exact: true }).click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
    const latest = await value(page).innerText();
    const surface = (await chart(page).boundingBox())!;
    await page.mouse.move(surface.x + surface.width * 0.5, surface.y + 100);
    await expect(page.getByTestId('chart-tooltip')).toBeVisible();
    await expect(page.getByTestId('chart-tooltip')).toContainText('배');
    await expect(page.getByTestId('chart-tooltip')).not.toContainText(/UTC|\d{4}-\d{2}-\d{2}/);
    await page.mouse.click(surface.x + surface.width * 0.5, surface.y + 100);
    await expect(value(page)).toHaveText(latest);
    await expect(page).not.toHaveURL(/reading_date=/);
    await chart(page).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await expect(value(page)).toHaveText(latest);
    await expect(page).not.toHaveURL(/reading_date=/);
    await page.getByRole('button', { name: /^지표 설명/ }).click();
    const explanation = page.getByRole('dialog', { name: '지표 설명', exact: true });
    await expect(explanation.locator('.indicator-concept[data-concept="mvrv"]')).toBeVisible();
    await expect(explanation).toContainText('시가총액');
    await expect(
      explanation.locator('.indicator-selected-context,.indicator-provenance'),
    ).toHaveCount(0);
    await explanation.getByText('계산식·기호', { exact: true }).click();
    await expect(explanation).toContainText(/MVRV|실현/);
    await page.keyboard.press('Escape');
    await expect(explanation).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: '지표 설명 · 읽는 법', exact: true }),
    ).toBeFocused();
    await shortcuts.getByRole('link', { name: '슈퍼트렌드', exact: true }).click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', 'price');
    await expect(page.locator('.supertrend-context')).toContainText(/상승 추세|하락 추세/);
    await cleanPublicChart(page);
    await shortcuts.getByRole('link', { name: 'MVRV', exact: true }).click();
    await page.getByRole('link', { name: /^같은 지표 비교/ }).click();
    await expect(page).toHaveURL(/mode=indicator/);
    await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
    await expect(page.locator('.indicator-comparison-results th')).toHaveText(['코인', '지표값']);
    await expect(page.locator('.indicator-comparison-results tbody tr')).toHaveCount(2);
    await cleanPublicChart(page);
    const firstRange = await chart(page).getAttribute('data-visible-from');
    const box = (await chart(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + 120);
    await page.mouse.wheel(0, -180);
    await expect.poll(() => chart(page).getAttribute('data-visible-from')).not.toBe(firstRange);
    const from = await chart(page).getAttribute('data-visible-from');
    const to = await chart(page).getAttribute('data-visible-to');
    const name = `QA 지표 비교 ${width}`;
    await page.getByRole('button', { name: '비교 분석 저장', exact: true }).click();
    await page.getByLabel('작업공간 이름', { exact: true }).fill(name);
    await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
    await page.getByRole('link', { name: new RegExp(name) }).click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
    await expect(chart(page)).toHaveAttribute('data-visible-from', from!);
    await expect(chart(page)).toHaveAttribute('data-visible-to', to!);
    await cleanPublicChart(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}

test('legacy date URLs retain their range without changing the public latest MVRV', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=net:mvrv&price_source=upbit&period=all');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const latest = await value(page).innerText();
  const response = await page.request.get(
    '/api/v1/network?asset=BTC&metric=mvrv&from=' +
      Math.floor(Date.now() / 1000 - 120 * 86400) +
      '&limit=1000',
  );
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const rows = body.data.filter(
    (point: { time: number }) => point.time + 86400 <= Date.now() / 1000,
  );
  expect(rows.length).toBeGreaterThan(60);
  const old = rows.at(-30).time,
    from = rows.at(-60).time,
    to = rows.at(-5).time;
  await page.goto(
    `/coins/BTC?metric=net:mvrv&price_source=upbit&period=all&reading_date=${old}&chart_from=${from}&chart_to=${to}`,
  );
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(chart(page)).toHaveAttribute('data-visible-from', String(from));
  await expect(chart(page)).toHaveAttribute('data-visible-to', String(to));
  await expect(value(page)).toHaveText(latest);
  await cleanPublicChart(page);
  const url = page.url();
  await chart(page).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('End');
  await expect(page).toHaveURL(url);
  await expect(value(page)).toHaveText(latest);
  const rect = (await chart(page).boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.4, rect.y + 100);
  await expect(page.getByTestId('chart-tooltip')).toBeVisible();
  await expect(value(page)).toHaveText(latest);
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('이전 날짜 링크');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('link', { name: /이전 날짜 링크/ }).click();
  await expect(page).toHaveURL(new RegExp(`reading_date=${old}(?:&|$)`));
  await expect(chart(page)).toHaveAttribute('data-visible-from', String(from));
  await expect(chart(page)).toHaveAttribute('data-visible-to', String(to));
  await expect(value(page)).toHaveText(latest);
  await cleanPublicChart(page);
});

test('source selection contains only the necessary choice and failures expose no diagnostics', async ({
  page,
}) => {
  await page.goto('/coins/BTC?metric=view:price&price_source=upbit&period=1m');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const sourceButton = page.getByRole('button', { name: '가격 거래소 선택', exact: true });
  await sourceButton.click();
  const dialog = page.getByRole('dialog', { name: '가격 선택', exact: true });
  await expect(dialog.getByRole('combobox', { name: '현재 가격 거래소' })).toBeVisible();
  await expect(dialog).not.toContainText(/체결|수집|시각|스트림|분 단위/);
  await page.keyboard.press('Escape');
  await expect(sourceButton).toBeFocused();
  await page.route('**/api/v1/network?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('asset') === 'BTC' && query.get('metric') === 'mvrv') {
      await route.fulfill({
        status: 503,
        json: { error: 'PRIVATE_FAKE_PROVIDER_DIAGNOSTIC', code: 'VALIDATION_ERROR' },
      });
    } else await route.continue();
  });
  await page
    .getByRole('navigation', { name: '자주 보는 지표' })
    .getByRole('link', { name: 'MVRV', exact: true })
    .click();
  await expect(page.locator('.indicator-workspace')).toHaveAttribute('data-availability', 'error');
  await expect(page.getByText('차트를 불러오지 못했습니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText('PRIVATE_FAKE_PROVIDER_DIAGNOSTIC');
  await expect(page.getByText('차트를 불러오는 중…', { exact: true })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '자주 보는 지표' })
    .getByRole('link', { name: '가격', exact: true })
    .click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'price');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(page.getByText('차트를 불러오지 못했습니다.', { exact: true })).toHaveCount(0);
});

test('missing current price distinguishes loading, failed lookup and unavailable values without diagnostics', async ({
  page,
}) => {
  await page.addInitScript(() => {
    class UnavailableSource extends EventTarget {
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        super();
        queueMicrotask(() => this.onerror?.());
      }
      close() {}
    }
    Object.assign(window, { EventSource: UnavailableSource });
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let unavailable = false;
  await page.route('**/api/v1/market?*', async (route) => {
    if (!unavailable) {
      await gate;
      await route.fulfill({
        status: 503,
        json: { error: 'PRIVATE_FAKE_QUOTE_DIAGNOSTIC', code: 'SOURCE_ERROR' },
      });
    } else {
      const response = await route.fetch();
      const data = await response.json();
      for (const row of data.rows) {
        row.quote = null;
        row.status = 'pending';
      }
      await route.fulfill({ response, json: data });
    }
  });
  await page.goto('/coins/BTC?metric=view:price&price_source=upbit&period=1m');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const quote = page.locator('.detail-quote');
  await expect(quote).toContainText('불러오는 중');
  release();
  await expect(quote).toContainText('가격 확인 불가');
  await expect(quote).not.toContainText(/연결 중|불러오는 중|PRIVATE_FAKE/);
  await expect(quote.locator('strong')).toHaveText('—');
  unavailable = true;
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(quote).toContainText('가격 확인 불가');
  await expect(quote).not.toContainText(/연결 중|불러오는 중/);
  await expect(quote.locator('strong')).toHaveText('—');
});

test('performance comparison retains results without date inputs, source diagnostics or export actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/compare?mode=performance&assets=BTC,DOGE&market=upbit&period=1y');
  await expect(page.locator('.comparison-chart')).toHaveAttribute('data-render-ready', '1');
  await expect(page.locator('.comparison-statistics tbody tr')).toHaveCount(2);
  await expect(page.locator('.comparison-statistics')).toContainText('기간 수익률');
  await expect(page.locator('.comparison-statistics')).toContainText('최대 낙폭');
  await expect(page.locator('.comparison-statistics')).toContainText('연환산 변동성');
  await expect(
    page.locator('.comparison-coverage,.comparison-share,.comparison-share-result,.chart-tools'),
  ).toHaveCount(0);
  await page.locator('.comparison-settings > summary').click();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: '비교 기간', exact: true }).selectOption('3m');
  await expect(page).toHaveURL(/period=3m/);
  await expect(page.locator('.comparison-chart')).toHaveAttribute('data-render-ready', '1');
  await expect(page.locator('.comparison-statistics tbody tr')).toHaveCount(2);
});
