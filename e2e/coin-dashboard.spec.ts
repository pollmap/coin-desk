import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { referenceAssets } from '../shared/asset-registry';

const priceCard = '.coin-dashboard-card[data-metric="view:price"]';
const mvrvCard = '.coin-dashboard-card[data-metric="net:mvrv"]';
const chart = '[data-chart-kind="analysis"]';

test('plain coin entry shows supported charts and delays lower-card requests', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) calls.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC');
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await expect(page.getByRole('combobox', { name: '차트 가격 통화' })).toHaveValue('reference');
  await expect(page.locator('.coin-dashboard')).toHaveAttribute('data-asset', 'BTC');
  await expect(page.locator(`${priceCard} .coin-dashboard-card-reading`)).toContainText('USD');
  await expect(page.locator(`${mvrvCard} .coin-dashboard-placeholder`)).toHaveCount(1);
  expect(
    calls.filter((url) =>
      /\/knowledge|\/overview|\/coverage|\/series\?|network.*hashrate/.test(url),
    ),
  ).toEqual([]);
  expect(new URL(page.url()).searchParams.has('metric')).toBe(false);
  await page.locator(mvrvCard).scrollIntoViewIfNeeded();
  await expect(page.locator(`${mvrvCard} ${chart}`)).toHaveAttribute(
    'data-primary-metric',
    'net:mvrv',
  );
  await expect(page.locator(`${mvrvCard} .coin-dashboard-card-reading strong`)).not.toHaveText('—');
  await page.locator(mvrvCard).getByRole('link', { name: '같은 지표 비교' }).click();
  await expect(page.getByRole('heading', { name: '같은 지표 비교', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('metric')).toBe('net:mvrv');
});

test('mobile exact coin selection ignores IME Enter and never substitutes MVRV', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/coins/BTC');
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: '코인 선택', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '코인 선택', exact: true });
  const search = dialog.getByRole('searchbox', { name: '코인 검색', exact: true });
  await search.fill('ONDO');
  await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.coin-dashboard')).toHaveAttribute('data-asset', 'BTC');
  await search.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.coin-dashboard')).toHaveAttribute('data-asset', 'ONDO');
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-asset', 'ONDO');
  await expect(page.locator(mvrvCard)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '차트 가격 통화' })).toHaveValue(
    referenceAssets.includes('ONDO') ? 'reference' : 'binance',
  );
  await page.getByRole('button', { name: '보는 지표 선택', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '보는 지표', exact: true });
  await expect(picker.getByRole('checkbox', { name: 'MVRV', exact: true })).toHaveCount(0);
  await expect(picker.getByRole('checkbox', { name: '슈퍼트렌드', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '보는 지표 선택', exact: true })).toBeFocused();
});

test('saved dashboard restores chart order, separate ranges and reading position', async ({
  page,
}) => {
  const today = Math.floor(Date.now() / 86400000) * 86400;
  const ranges = {
    'net:mvrv': { from: today - 240 * 86400, to: today - 60 * 86400 },
    'view:price': { from: today - 700 * 86400, to: today - 400 * 86400 },
  };
  const params = new URLSearchParams({
    period: 'all',
    price_source: 'reference',
    dashboard_cards: 'net:mvrv,view:price',
    dashboard_ranges: JSON.stringify(ranges),
    dashboard_scroll: '450',
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?' + params);
  await expect(page.locator(`${mvrvCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await expect(page.locator('.coin-dashboard-card').first()).toHaveAttribute(
    'data-metric',
    'net:mvrv',
  );
  const beforeMvrv = Number(
    await page.locator(`${mvrvCard} ${chart}`).getAttribute('data-visible-from'),
  );
  const beforePrice = Number(
    await page.locator(`${priceCard} ${chart}`).getAttribute('data-visible-from'),
  );
  expect(Math.abs(beforeMvrv - ranges['net:mvrv'].from)).toBeLessThanOrEqual(86400);
  expect(Math.abs(beforePrice - ranges['view:price'].from)).toBeLessThanOrEqual(86400);
  // Saving uses the view at invocation, even though the save button scrolls into view.
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름').fill('BTC 두 차트');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('coin-desk.personal.v1')!).workspaces[0],
  );
  expect(stored.dashboard.charts).toEqual(['net:mvrv', 'view:price']);
  expect(Math.abs(stored.dashboard.ranges['net:mvrv'].from - beforeMvrv)).toBeLessThanOrEqual(
    86400,
  );
  expect(Math.abs(stored.dashboard.ranges['view:price'].from - beforePrice)).toBeLessThanOrEqual(
    86400,
  );
  await page.getByRole('link', { name: /BTC 두 차트/ }).click();
  expect(new URL(page.url()).searchParams.has('metric')).toBe(false);
  expect(new URL(page.url()).searchParams.get('dashboard_cards')).toBe('net:mvrv,view:price');
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await expect
    .poll(async () =>
      Math.abs(
        Number(await page.locator(`${priceCard} ${chart}`).getAttribute('data-visible-from')) -
          beforePrice,
      ),
    )
    .toBeLessThanOrEqual(86400);
  await page
    .locator(priceCard)
    .getByRole('link', { name: '가격 차트 크게 보기', exact: true })
    .click();
  await expect(page.locator('.coin-dashboard')).toHaveCount(0);
  await expect(page.locator(chart)).toHaveAttribute('data-primary-metric', 'price');
  expect(new URL(page.url()).searchParams.get('chart_from')).toBe(
    String(stored.dashboard.ranges['view:price'].from),
  );
  await page.goBack();
  await expect(page.locator('.coin-dashboard-card').first()).toHaveAttribute(
    'data-metric',
    'net:mvrv',
  );
});

test('one failed metric stays isolated and can recover without replacing prices', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/v1/network?*', async (route) => {
    if (fail && new URL(route.request().url()).searchParams.get('metric') === 'mvrv')
      await route.fulfill({ status: 503, json: { error: '일시적인 응답 오류입니다.' } });
    else await route.continue();
  });
  await page.goto('/coins/BTC?dashboard_cards=view:price,net:mvrv');
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await page.locator(mvrvCard).scrollIntoViewIfNeeded();
  await expect(page.locator(mvrvCard).getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.locator(`${mvrvCard} ${chart}`)).toHaveCount(0);
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-asset', 'BTC');
  fail = false;
  await page.locator(mvrvCard).getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator(`${mvrvCard} ${chart}`)).toHaveAttribute(
    'data-primary-metric',
    'net:mvrv',
  );
  await expect(page.locator(mvrvCard).getByRole('button', { name: '다시 시도' })).toHaveCount(0);
});

test('a lower chart opens at the top and browser back restores its reading position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/coins/BTC');
  await expect(page.locator(`${priceCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await page.locator(mvrvCard).scrollIntoViewIfNeeded();
  await expect(page.locator(`${mvrvCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  const readingY = await page.evaluate(() => window.scrollY);
  expect(readingY).toBeGreaterThan(500);
  const rail = (await page.locator('.coin-dashboard-rail').boundingBox())!;
  expect(rail.y).toBeGreaterThanOrEqual(64);
  expect(rail.y).toBeLessThanOrEqual(90);
  await page.locator(mvrvCard).getByRole('link', { name: 'MVRV 크게 보기', exact: true }).click();
  await expect(page.locator('.coin-dashboard')).toHaveCount(0);
  await expect(page.locator(chart)).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator(`${mvrvCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - readingY))
    .toBeLessThanOrEqual(4);
});

test('returning to a coin preserves its chosen period and viewport; explicit periods still win', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?dashboard_cards=view:price');
  const canvas = page.locator(`${priceCard} ${chart}`);
  await expect(canvas).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: '1년', exact: true }).click();
  await expect(page.getByRole('button', { name: '1년', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.65, box.y + 120);
  await page.mouse.wheel(0, -350);
  const from = await canvas.getAttribute('data-visible-from');
  await page
    .locator('.coin-dashboard-rail')
    .getByRole('button', { name: '도지코인 DOGE', exact: true })
    .click();
  await expect(page.locator('.coin-dashboard')).toHaveAttribute('data-asset', 'DOGE');
  await page
    .locator('.coin-dashboard-rail')
    .getByRole('button', { name: '비트코인 BTC', exact: true })
    .click();
  await expect(page.locator('.coin-dashboard')).toHaveAttribute('data-asset', 'BTC');
  await expect(page.getByRole('button', { name: '1년', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(canvas).toHaveAttribute('data-range-ready', '1');
  expect(
    Math.abs(Number(await canvas.getAttribute('data-visible-from')) - Number(from)),
  ).toBeLessThanOrEqual(86400);
  expect(new URL(page.url()).searchParams.has('period')).toBe(false);
  await page.goto('/coins/BTC?period=all');
  await expect(page.getByRole('button', { name: '전체', exact: true }).last()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(canvas).toHaveAttribute('data-range-ready', '1');
  expect(Number(await canvas.getAttribute('data-visible-from'))).toBeLessThan(
    Number(from) - 365 * 86400,
  );
});

test('optional charts keep the saved order and favorites and backup stay in their own controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?dashboard_cards=net:mvrv,view:price');
  await expect(page.locator(`${mvrvCard} ${chart}`)).toHaveAttribute('data-range-ready', '1');
  const rail = page.locator('.coin-dashboard-rail');
  await rail.getByRole('button', { name: '관심', exact: true }).click();
  await expect(rail.locator('.coin-dashboard-coin-row')).toHaveCount(3);
  await rail.getByRole('button', { name: '도지코인 관심 코인', exact: true }).click();
  await expect(rail.locator('.coin-dashboard-coin-row')).toHaveCount(2);
  await page.getByRole('button', { name: '보는 지표 선택', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '보는 지표', exact: true });
  for (const name of ['이동평균 리본', '볼린저밴드', '계절성'])
    await picker.getByRole('checkbox', { name, exact: true }).check();
  await page.keyboard.press('Escape');
  expect(
    await page
      .locator('.coin-dashboard-card')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-metric'))),
  ).toEqual(['net:mvrv', 'view:price', 'view:ribbon', 'view:bb', 'view:seasonality']);
  for (const id of ['view:ribbon', 'view:bb']) {
    const card = page.locator(`.coin-dashboard-card[data-metric="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(chart)).toHaveAttribute('data-range-ready', '1');
  }
  const season = page.locator('.coin-dashboard-card[data-metric="view:seasonality"]');
  await season.scrollIntoViewIfNeeded();
  await expect(season).toContainText('완전한 3개 연도의 가격이 필요합니다.');
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '설정 백업·이동', exact: true })).toHaveCount(0);
  await page.getByLabel('작업공간 이름').fill('선택 지표');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '내 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '백업·복원', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /선택 지표/ }).click();
  await expect(page.locator('.coin-dashboard-card')).toHaveCount(5);
});

test('Supertrend follows the chosen native currency and preserves an explicit saved OHLC source', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/coins/BTC?dashboard_cards=view:supertrend,view:price');
  const supertrend = page.locator('.coin-dashboard-card[data-metric="view:supertrend"]');
  await expect(supertrend.locator(chart)).toHaveAttribute('data-range-ready', '1');
  await expect(supertrend.locator('.coin-dashboard-card-reading')).toContainText('USDT');
  await page.getByRole('combobox', { name: '차트 가격 통화', exact: true }).selectOption('upbit');
  await expect(supertrend.locator(chart)).toHaveAttribute('data-range-ready', '1');
  await expect(supertrend.locator('.coin-dashboard-card-reading')).toContainText('KRW');
  await expect(
    supertrend.getByRole('link', { name: '슈퍼트렌드 크게 보기', exact: true }),
  ).toHaveAttribute('href', /price_source=upbit/);
  await page.goto(
    '/coins/BTC?price_source=upbit&dashboard_cards=view:supertrend,view:price&dashboard_ohlc=binance',
  );
  await expect(supertrend.locator(chart)).toHaveAttribute('data-range-ready', '1');
  await expect(supertrend.locator('.coin-dashboard-card-reading')).toContainText('USDT');
  await expect(
    supertrend.getByRole('link', { name: '슈퍼트렌드 크게 보기', exact: true }),
  ).toHaveAttribute('href', /price_source=binance/);
});

for (const width of [320, 390, 1280])
  test(`dashboard geometry, explanation focus and accessibility ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/coins/BTC?dashboard_cards=view:price,net:mvrv');
    const canvas = page.locator(`${priceCard} ${chart}`);
    await expect(canvas).toHaveAttribute('data-range-ready', '1');
    const box = (await canvas.boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(width < 768 ? 280 : 240);
    expect(box.height).toBeGreaterThanOrEqual(width < 768 ? 240 : 420);
    await expect(page.getByRole('main')).toHaveCount(1);
    const initialFrom = await canvas.getAttribute('data-visible-from');
    await page.getByRole('button', { name: '가격 차트 읽는 법', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '가격 차트', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: '가격 차트 읽는 법', exact: true }),
    ).toBeFocused();
    await expect(canvas).toHaveAttribute('data-visible-from', initialFrom!);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: /테마로 변경/ }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        result.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })),
      ).toEqual([]);
    }
  });
