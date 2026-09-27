import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const chart = (page: Page) => page.locator('[data-chart-kind="analysis"]');
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
});

test('market table opens the selected metric, keeps currency and groups on-chain choices', async ({
  page,
}) => {
  await page.goto('/coins?market=upbit&view=derivatives');
  await expect(page.getByRole('link', { name: '도지코인 차트 열기' })).toBeVisible();
  await expect(page.getByRole('link', { name: '솔라나 차트 열기' })).toHaveCount(0);
  await page.getByRole('link', { name: '도지코인 미결제약정 차트', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'futures:open_interest');
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  const oiShortcut = page
    .getByRole('group', { name: '자주 보는 지표' })
    .getByRole('button', { name: '미결제약정', exact: true });
  await expect(oiShortcut).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('combobox', { name: '선물 지표' })
    .selectOption('futures:open_interest_daily');
  await expect(oiShortcut).toHaveAttribute('aria-pressed', 'true');
  await oiShortcut.click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'futures:open_interest_daily');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
  await page
    .getByRole('navigation', { name: 'DOGE 분석 화면' })
    .getByRole('link', { name: '온체인', exact: true })
    .click();
  await page
    .getByRole('group', { name: '자주 보는 지표' })
    .getByRole('button', { name: '활성 주소', exact: true })
    .click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:active_addresses');
  await page.getByRole('button', { name: '지표 찾기', exact: true }).click();
  await page
    .getByRole('group', { name: '지표 분류' })
    .getByRole('button', { name: '가격 평가·손익', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /^MVRV / })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /^활성 주소 / })).toHaveCount(
    0,
  );
  await page.keyboard.press('Escape');
  await page.goto('/coins?market=upbit');
  await page.getByRole('searchbox', { name: '코인 찾기' }).fill('솔라나');
  await expect(page.getByRole('link', { name: '솔라나 차트 열기' })).toBeVisible();
  await page
    .getByRole('navigation', { name: '시장 분석' })
    .getByRole('link', { name: '성과 비교' })
    .click();
  await expect(
    page.getByRole('navigation', { name: '시장 분석' }).getByRole('link', { name: '성과 비교' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).searchParams.get('market')).toBe('upbit');
});
test('core selection, Korean/ticker search, all-history and keyboard restoration', async ({
  page,
}) => {
  await page.goto('/');
  await expect(chart(page)).toHaveAttribute('data-asset', 'BTC');
  const periodSelect = page.getByRole('combobox', { name: '조회 기간', exact: true });
  if (await periodSelect.isVisible()) await expect(periodSelect).toHaveValue('all');
  else
    await expect(page.getByRole('button', { name: '전체', exact: true }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  for (const [query, asset] of [
    ['도지', 'DOGE'],
    ['ETH', 'ETH'],
    ['비트', 'BTC'],
  ]) {
    await page.getByRole('button', { name: /코인 변경/ }).click();
    const search = page.getByRole('searchbox', { name: '코인 검색' });
    await expect(search).toBeFocused();
    await search.fill(query);
    await search.press('Enter');
    await expect(chart(page)).toHaveAttribute('data-asset', asset);
  }
  const picker = page.getByRole('button', { name: /코인 변경/ });
  await picker.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(picker).toBeFocused();
  await page.getByRole('button', { name: '지표 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '지표 추가', exact: true })).toBeFocused();
});
test('price source survives sections, navigation, reload and shared URL', async ({ page }) => {
  // Three price sources, each with section changes, Back and a full reload.
  test.setTimeout(90000);
  await page.goto('/?asset=DOGE&period=all&price_source=reference');
  for (const basis of ['upbit', 'binance', 'reference']) {
    await page.getByLabel('가격 기준', { exact: true }).selectOption(basis);
    await expect(chart(page)).toBeVisible();
    await expect(page.getByLabel('가격 기준', { exact: true })).toHaveValue(basis);
    await page
      .getByRole('navigation', { name: 'DOGE 분석 화면' })
      .getByRole('link', { name: '온체인', exact: true })
      .click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /net:/);
    expect(new URL(page.url()).searchParams.get('price_source')).toBe(basis);
    await page
      .getByRole('navigation', { name: 'DOGE 분석 화면' })
      .getByRole('link', { name: '선물', exact: true })
      .click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /futures:/);
    await page.goBack();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /net:/);
    await page.reload();
    await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
    await page
      .getByRole('navigation', { name: 'DOGE 분석 화면' })
      .getByRole('link', { name: '가격·기술', exact: true })
      .click();
    await expect(page.getByLabel('가격 기준', { exact: true })).toHaveValue(basis);
  }
  await page.locator('summary').filter({ hasText: '내보내기 · 공유' }).click();
  await page.getByRole('button', { name: '링크 공유', exact: true }).click();
  const shared = await page.getByLabel('공유 주소', { exact: true }).inputValue();
  await page.goto(shared);
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
});
test('slow failed old asset and broken logo do not contaminate the next asset', async ({
  page,
}) => {
  await page.route('**/api/v1/reference?asset=BTC**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 503, json: { error: 'BTC fixture outage' } });
  });
  await page.route('**/coin-logos/btc.png', (route) => route.abort());
  await page.goto('/?asset=BTC');
  await expect(page.locator('.coin-picker .asset-logo.fallback')).toBeVisible();
  await page.getByRole('button', { name: /코인 변경/ }).click();
  await page.getByRole('searchbox', { name: '코인 검색' }).fill('DOGE');
  await page.keyboard.press('Enter');
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  await page.waitForTimeout(1700);
  await expect(page.getByText('BTC fixture outage')).toHaveCount(0);
  await expect(page.locator('.coin-picker img').first()).toBeVisible();
  expect(
    await page
      .locator('.coin-picker img')
      .first()
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
});
for (const width of [320, 390, 768, 1280, 1440]) {
  test(`responsive and axe at ${width}px in both themes`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/coins',
      '/coins?view=derivatives',
      '/?asset=BTC&period=all',
      '/?asset=DOGE&period=all&visual=rainbow',
      '/onchain/ETH',
      '/futures/DOGE',
    ]) {
      await page.goto(path);
      if (path.includes('rainbow'))
        await expect(page.locator('[data-chart-kind="position"]')).toBeVisible();
      else if (!path.startsWith('/coins')) await expect(chart(page)).toBeVisible();
      else await expect(page.getByRole('link', { name: '비트코인 차트 열기' })).toBeVisible();
      for (let theme = 0; theme < 2; theme++) {
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        ).toEqual([]);
        await page.getByRole('button', { name: /테마로 변경/ }).click();
      }
    }
  });
}
test('200 percent CSS zoom preserves controls and chart keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/?asset=ETH&period=all');
  await expect(chart(page)).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await chart(page).focus();
  await page.keyboard.press('Home');
  const first = await page.locator('.analysis-legend').innerText();
  await page.keyboard.press('End');
  expect(await page.locator('.analysis-legend').innerText()).not.toBe(first);
});

test('stale data is visible and an API failure remains isolated to its asset', async ({ page }) => {
  await page.route('**/api/v1/reference?asset=BTC**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.meta.stale = true;
    body.meta.warning = 'fixture stale observation';
    await route.fulfill({ json: body });
  });
  await page.goto('/?asset=BTC&period=all');
  await expect(chart(page)).toBeVisible();
  await expect(page.locator('.source-line').getByText('갱신 지연')).toBeVisible();
  await page.getByRole('link', { name: '이더리움 ETH', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'ETH');
  await expect(page.locator('.source-line').getByText('갱신 지연')).toHaveCount(0);
});
for (const asset of ['BTC', 'DOGE', 'ETH']) {
  test(`${asset} onchain and futures are the main chart without price requests`, async ({
    page,
  }) => {
    const priceRequests: string[] = [];
    page.on('request', (r) => {
      if (/api\/v1\/(reference|candles|overview)\?/.test(r.url())) priceRequests.push(r.url());
    });
    await page.goto('/onchain/' + asset);
    await expect(chart(page)).toHaveAttribute('data-asset', asset);
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /^(net|btc):/);
    await page
      .getByRole('navigation', { name: asset + ' 분석 화면' })
      .getByRole('link', { name: '선물', exact: true })
      .click();
    await expect(chart(page)).toHaveAttribute('data-primary-metric', /^futures:/);
    expect(priceRequests).toEqual([]);
  });
}

for (const visual of ['price', 'rainbow']) {
  test(`${visual} date navigation zooms, selects UTC ranges and restores focus`, async ({
    page,
  }) => {
    await page.goto(`/?asset=DOGE&period=all&visual=${visual}`);
    const surface = page.locator(
      `[data-chart-kind="${visual === 'rainbow' ? 'position' : 'analysis'}"]`,
    );
    await expect(surface).toBeVisible();
    await expect(surface).toHaveAttribute('data-visible-from', /\d+/);
    const first = Number(await surface.getAttribute('data-visible-from'));
    const last = Number(await surface.getAttribute('data-visible-to'));
    const date = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
    const target = first + 300 * 86400;
    const nav = page.getByRole('group', { name: '차트 날짜 탐색', exact: true });
    await nav.getByRole('button', { name: '날짜로 이동', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '차트 날짜 탐색' });
    await dialog.getByLabel('이동할 날짜 (UTC)').fill('2100-01-01');
    await dialog.getByRole('button', { name: '이동', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('확보한 데이터');
    await dialog.getByLabel('이동할 날짜 (UTC)').fill(date(target));
    await dialog.getByRole('button', { name: '이동', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(nav.getByRole('button', { name: '날짜로 이동', exact: true })).toBeFocused();
    await expect
      .poll(
        async () =>
          Number(await surface.getAttribute('data-visible-to')) -
          Number(await surface.getAttribute('data-visible-from')),
      )
      .toBeLessThan(100 * 86400);
    const before = Number(await surface.getAttribute('data-visible-from'));
    await nav.getByRole('button', { name: '다음 구간', exact: true }).click();
    await expect
      .poll(async () => Number(await surface.getAttribute('data-visible-from')))
      .toBeGreaterThan(before);
    await page.keyboard.press('Alt+g');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '기간 선택', exact: true }).click();
    await dialog.getByLabel('시작일 (UTC)').fill(date(target));
    await dialog.getByLabel('종료일 (UTC)').fill(date(target + 30 * 86400));
    await dialog.getByRole('button', { name: '기간 적용', exact: true }).click();
    await expect(surface).toHaveAttribute('data-visible-from', String(target));
    await expect(surface).toHaveAttribute('data-visible-to', String(target + 30 * 86400));
    await page.locator('details.analysis-tools > summary').click();
    await page.getByRole('button', { name: '링크 공유', exact: true }).click();
    const shared = await page.getByRole('textbox', { name: '공유 주소', exact: true }).inputValue();
    expect(new URL(shared).searchParams.get('chart_from')).toBe(String(target));
    await page.goto(shared);
    await expect(surface).toHaveAttribute('data-visible-from', String(target));
    await expect(surface).toHaveAttribute('data-visible-to', String(target + 30 * 86400));
    await nav.getByRole('button', { name: '최신 구간', exact: true }).click();
    await expect(surface).toHaveAttribute('data-visible-to', String(last));
    await nav.getByRole('button', { name: '전체 보기', exact: true }).click();
    await expect(surface).toHaveAttribute('data-visible-from', String(first));
    await expect(surface).toHaveAttribute('data-visible-to', String(last));
    await nav.getByRole('button', { name: '날짜로 이동', exact: true }).click();
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(scan.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(nav.getByRole('button', { name: '날짜로 이동', exact: true })).toBeFocused();
  });
}
