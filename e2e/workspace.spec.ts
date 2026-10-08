import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const chart = (p: Page) => p.locator('[data-chart-kind="analysis"]');
const pick = async (p: Page, name: string) => {
  await p.getByRole('button', { name: /지표 변경$/ }).click();
  await p.getByLabel('지표 검색', { exact: true }).fill(name);
  await p
    .getByRole('navigation', { name: '지표 목록', exact: true })
    .getByRole('link', { name: new RegExp('^' + name) })
    .click();
};
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (r) =>
    new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort(),
  );
});

test('loading a band does not prematurely claim zero observations or insufficient history', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/reference?**', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/?asset=BTC&metric=view%3Abtc_rainbow&period=all&price_source=reference');
    await expect(page.getByText('지표 이력을 불러오고 있습니다…')).toBeVisible();
    await expect(page.locator('.indicator-empty p')).toHaveCount(0);
    await expect(page.getByText('밴드 계산에 필요한 이력이 부족합니다.')).toHaveCount(0);
    release();
    await expect(chart(page)).toBeVisible();
  } finally {
    release();
  }
});
test('BTC detail defaults to MVRV; eight coins use supported metrics and sources', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) requests.push(r.url());
  });
  await page.goto('/?asset=BTC');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await expect(page.getByRole('button', { name: '5년', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    requests.every(
      (u) =>
        u.includes('/network?') ||
        u.includes('/signals?') ||
        u.includes('/market?') ||
        u.includes('/quotes/stream?'),
    ),
  ).toBe(true);
  const box = (await chart(page).boundingBox())!;
  expect(box.y).toBeLessThanOrEqual(240);
  expect(box.height).toBeGreaterThanOrEqual(420);
  for (const [query, asset] of [
    ['도지', 'DOGE'],
    ['ETH', 'ETH'],
    ['비트', 'BTC'],
    ['XRP', 'XRP'],
    ['LINK', 'LINK'],
    ['ONDO', 'ONDO'],
    ['SOL', 'SOL'],
    ['PEPE', 'PEPE'],
  ]) {
    await page.getByRole('button', { name: /코인 변경/ }).click();
    const input = page.getByRole('searchbox', { name: '코인 검색' });
    await expect(input).toBeFocused();
    await input.fill(query);
    await input.press('Enter');
    await expect(chart(page)).toHaveAttribute('data-asset', asset);
    if (['ONDO', 'SOL', 'PEPE'].includes(asset)) {
      expect(new URL(page.url()).searchParams.get('price_source')).toBe('binance');
      await expect(chart(page)).toHaveAttribute('data-primary-metric', 'rsi');
    }
  }
});
test('market deep link, one-click selection and source survive back/reload/share', async ({
  page,
}) => {
  await page.goto('/coins?market=upbit&view=derivatives');
  await page.getByRole('link', { name: '도지코인 미결제약정 차트', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'futures:open_interest');
  await pick(page, 'MVRV');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
  await pick(page, '확정 펀딩률');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'futures:funding');
  await page.goBack();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await page.locator('details.analysis-tools > summary').click();
  await page.getByRole('button', { name: '링크 공유', exact: true }).click();
  const shared = await page.getByLabel('공유 주소', { exact: true }).inputValue();
  await page.goto(shared);
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
});
test('legacy metric URLs use the same indicator workspace without automatic price comparison', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (/api\/v1\/(reference|candles|overview)\?/.test(r.url())) requests.push(r.url());
  });
  await page.goto('/metrics/mvrv?period=all&visual=price');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'btc:mvrv');
  await expect(page.getByLabel('가격 비교', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: /지표 변경$/ })).toBeVisible();
  expect(requests).toEqual([]);
  await page.goto('/metrics/mvrv?asset=ONDO');
  await expect(page.locator('[data-availability]')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  await expect(page.getByRole('navigation', { name: '지표 목록', exact: true })).not.toContainText(
    'MVRV',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '지원되는 원천·분석으로 열기' }).click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'ONDO');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'rsi');
});
test('initial collection is pending and waits for the normal refresh interval before retrying', async ({
  page,
}) => {
  await page.clock.install();
  let calls = 0;
  await page.route('**/api/v1/series?asset=BTC**', (r) => {
    calls++;
    return r.fulfill({ status: 503, json: { code: 'NO_DATA', error: '온체인 초기 수집 대기' } });
  });
  await page.goto('/metrics/mvrv');
  await expect(page.locator('[data-availability]')).toHaveAttribute('data-availability', 'pending');
  await expect(page.getByText('아직 수집된 관측이 없습니다.')).toBeVisible();
  await expect(page.getByText(/불러오고 있습니다|불러오지 못했습니다/)).toHaveCount(0);
  const initialCalls = calls;
  await page.clock.fastForward(60000);
  expect(calls).toBe(initialCalls);
  await page.clock.fastForward(240001);
  await expect.poll(() => calls).toBeGreaterThan(initialCalls);
  await expect(page.locator('[data-availability]')).toHaveAttribute('data-availability', 'pending');
});
test('unsupported URLs do not request data or retry and ONDO help retains asset', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/network?asset=ONDO') || r.url().includes('/reference?asset=ONDO'))
      requests.push(r.url());
  });
  await page.goto('/?asset=ONDO&metric=net:mvrv&price_source=reference');
  await expect(page.locator('[data-availability]')).toHaveAttribute(
    'data-availability',
    'unsupported',
  );
  await expect(chart(page)).toHaveCount(0);
  await expect(page.getByText(/불러오고 있습니다/)).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '지원되는 원천·분석으로 열기' }).click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'rsi');
  await page.getByRole('link', { name: '현재 분석 설명' }).click();
  expect(new URL(page.url()).searchParams.get('asset')).toBe('ONDO');
  await expect(page.locator('[data-chart-kind],canvas')).toHaveCount(0);
});
test('slow failures, logos and stale data never contaminate another asset', async ({ page }) => {
  await page.route('**/api/v1/network?asset=BTC**', async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await r.fulfill({ status: 503, json: { error: 'BTC fixture outage' } });
  });
  await page.route('**/coin-logos/btc.png', (r) => r.abort());
  await page.goto('/?asset=BTC');
  await expect(page.locator('.coin-picker .asset-logo.fallback')).toBeVisible();
  await page.getByRole('button', { name: /코인 변경/ }).click();
  await page.getByRole('searchbox', { name: '코인 검색' }).fill('DOGE');
  await page.keyboard.press('Enter');
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  await page.waitForTimeout(1300);
  await expect(page.getByText('BTC fixture outage')).toHaveCount(0);
  await page.route('**/api/v1/network?asset=ETH**', async (r) => {
    const response = await r.fetch(),
      body = await response.json();
    body.meta.stale = true;
    body.meta.warning = 'fixture stale observation';
    await r.fulfill({ json: body });
  });
  await page.goto('/?asset=ETH');
  await expect(chart(page)).toBeVisible();
  await expect(page.locator('.indicator-notice')).toContainText('갱신 지연');
  await page.goto('/?asset=BTC');
  await expect(page.getByText('이력을 불러오지 못했습니다.')).toBeVisible();
  await expect(page.getByText(/불러오고 있습니다/)).toHaveCount(0);
});
for (const width of [320, 390, 768, 1000, 1280, 1440])
  test('indicator charts reflow and pass axe ' + width + 'px both themes', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/?asset=BTC',
      '/?asset=DOGE&metric=view:rainbow',
      '/?asset=BTC&metric=view:btc_rainbow',
      '/onchain/ETH',
      '/futures/PEPE',
      '/coins',
    ]) {
      await page.goto(path);
      if (path !== '/coins') {
        await expect(chart(page)).toBeVisible();
        if (width === 390) expect((await chart(page).boundingBox())!.y).toBeLessThanOrEqual(300);
      }
      for (let t = 0; t < 2; t++) {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
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
test('mobile search Escape focus and 200 percent keyboard reflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/?asset=BTC');
  await expect(chart(page)).toBeVisible();
  const opener = page.getByRole('button', { name: /지표 변경$/ });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '지표 선택' });
  await dialog.getByRole('textbox', { name: '지표 검색' }).fill('RSI');
  await expect(dialog.getByRole('link', { name: /RSI 14/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await chart(page).focus();
  await page.keyboard.press('Home');
  const first = await page.locator('.analysis-legend').innerText();
  await page.keyboard.press('End');
  expect(await page.locator('.analysis-legend').innerText()).not.toBe(first);
});
for (const asset of ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK', 'SOL', 'ONDO', 'PEPE'])
  test(asset + ' selected onchain and futures do not request prices', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (/api\/v1\/(reference|candles|overview)\?/.test(r.url())) requests.push(r.url());
    });
    await page.goto('/futures/' + asset);
    await expect(chart(page)).toHaveAttribute('data-primary-metric', 'futures:funding');
    if (!['SOL', 'ONDO', 'PEPE'].includes(asset)) {
      await page.goto('/onchain/' + asset);
      await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
    }
    expect(requests).toEqual([]);
  });
for (const metric of ['view:price', 'view:rainbow', 'view:btc_rainbow', 'net:mvrv'])
  test(metric + ' date zoom share save restoration', async ({ page }) => {
    await page.goto('/?asset=BTC&period=all&metric=' + metric);
    const surface = chart(page);
    await expect(surface).toHaveAttribute('data-range-ready', '1');
    const first = Number(await surface.getAttribute('data-visible-from')),
      last = Number(await surface.getAttribute('data-visible-to')),
      target = first + 30 * 86400,
      date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
    const nav = page;
    await nav.getByRole('button', { name: '날짜로 이동', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '차트 날짜 탐색', exact: true });
    await dialog.getByRole('button', { name: '기간 선택', exact: true }).click();
    await dialog.getByLabel('시작일 (UTC)').fill(date(target));
    await dialog.getByLabel('종료일 (UTC)').fill(date(target + 30 * 86400));
    await dialog.getByRole('button', { name: '기간 적용', exact: true }).click();
    await expect(surface).toHaveAttribute('data-visible-from', String(target));
    const toggle = page.getByRole('checkbox', { name: '가격 비교' });
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(toggle).toBeChecked();
    }
    await expect(surface).toHaveAttribute('data-visible-from', String(target));
    await page.locator('details.analysis-tools > summary').click();
    await page.getByRole('button', { name: '링크 공유', exact: true }).click();
    const shared = await page.getByLabel('공유 주소', { exact: true }).inputValue();
    expect(new URL(shared).searchParams.get('chart_from')).toBe(String(target));
    await page.goto(shared);
    await expect(surface).toHaveAttribute('data-visible-from', String(target));
    await expect(surface).toHaveAttribute('data-visible-to', String(target + 30 * 86400));
    await page.getByRole('button', { name: '분석 저장' }).click();
    await page.getByLabel('작업공간 이름', { exact: true }).fill('구간 보존');
    await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
    await page.getByRole('link', { name: /구간 보존/ }).click();
    await expect(surface).toHaveAttribute('data-visible-from', String(target));
    await page.getByRole('button', { name: '구간·확대', exact: true }).click();
    await nav.getByRole('button', { name: '전체 보기', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(surface).toHaveAttribute('data-visible-to', String(last));
    await surface.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Escape');
    await nav.getByRole('button', { name: '날짜로 이동', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(nav.locator('.date-jump')).toBeFocused();
  });

test('source selection stays separate and automatic refresh preserves the canvas and chosen range', async ({
  page,
}) => {
  await page.clock.install();
  let requests = 0;
  await page.route('**/api/v1/network?asset=BTC**', async (route) => {
    requests++;
    const response = await route.fetch(),
      body = await response.json();
    if (requests > 2)
      body.data = body.data.map((p: { time: number; value: number }) => ({
        ...p,
        value: p.value + 1,
      }));
    await route.fulfill({ json: body });
  });
  await page.goto('/?asset=BTC&metric=net:mvrv&period=all');
  const surface = chart(page);
  await expect(surface).toHaveAttribute('data-range-ready', '1');
  const initialRequests = requests;
  const canvas = await surface.locator('canvas').first().elementHandle();
  const first = Number(await surface.getAttribute('data-visible-from')),
    target = first + 30 * 86400;
  const nav = page;
  await nav.getByRole('button', { name: '날짜로 이동', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '차트 날짜 탐색', exact: true });
  await dialog.getByRole('button', { name: '기간 선택', exact: true }).click();
  await dialog.getByLabel('시작일 (UTC)').fill(new Date(target * 1000).toISOString().slice(0, 10));
  await dialog
    .getByLabel('종료일 (UTC)')
    .fill(new Date((target + 30 * 86400) * 1000).toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: '기간 적용', exact: true }).click();
  const before = await page.locator('.analysis-legend').innerText();
  await page.clock.fastForward(300001);
  await expect.poll(() => requests).toBeGreaterThan(initialRequests);
  await expect(page.locator('.analysis-legend')).not.toHaveText(before);
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(surface).toHaveAttribute('data-visible-from', String(target));
  await page.getByLabel('지표 원천', { exact: true }).selectOption('btc:mvrv');
  await expect(surface).toHaveAttribute('data-primary-metric', 'btc:mvrv');
  await expect(page.locator('.indicator-heading')).toContainText('Bitview');
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const navLinks = page.getByRole('navigation', { name: '지표 목록', exact: true });
  await expect(navLinks.locator('a[aria-current=page]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByLabel('보조 지표 1', { exact: true }).selectOption('rsi');
  await expect(page.locator('.analysis-legend')).toContainText('RSI 14');
  await expect(surface).toHaveAttribute('data-visible-from', String(target));
});
