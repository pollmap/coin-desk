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
    await expect(page.getByText('차트를 불러오는 중…')).toBeVisible();
    await expect(page.locator('.indicator-empty p')).toHaveCount(1);
    await expect(page.getByText('밴드 계산에 필요한 이력이 부족합니다.')).toHaveCount(0);
    release();
    await expect(chart(page)).toBeVisible();
  } finally {
    release();
  }
});
test('explicit BTC MVRV entry and eight coin switches use supported metrics and sources', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) requests.push(r.url());
  });
  await page.goto('/?asset=BTC&metric=net:mvrv&period=5y&price_source=reference');
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
      expect(new URL(page.url()).searchParams.get('price_source')).toBe('reference');
      await expect(chart(page)).toHaveAttribute('data-primary-metric', 'price');
    }
  }
});
test('market deep link, one-click selection and source survive back and reload without share controls', async ({
  page,
}) => {
  await page.goto('/coins?market=upbit&view=derivatives');
  await page.getByRole('link', { name: '도지코인 DOGE', exact: true }).click();
  await expect(page.locator('.coin-dashboard')).toHaveAttribute('data-asset', 'DOGE');
  expect(new URL(page.url()).searchParams.has('metric')).toBe(false);
  await page.getByRole('combobox', { name: '차트 가격 통화', exact: true }).selectOption('upbit');
  const priceCard = page.locator('.coin-dashboard-card[data-metric="view:price"]');
  await expect(priceCard.locator('.coin-dashboard-card-reading')).toContainText('KRW');
  await priceCard.getByRole('link', { name: '가격 차트 크게 보기', exact: true }).click();
  await expect(page.locator('.coin-dashboard')).toHaveCount(0);
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'price');
  await pick(page, '미결제약정 · 시간별');
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
  if (
    (await page
      .getByRole('button', { name: '더보기', exact: true })
      .getAttribute('aria-expanded')) !== 'true'
  )
    await page.getByRole('button', { name: '더보기', exact: true }).click();
  await expect(page.locator('details.analysis-tools')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '링크 공유', exact: true })).toHaveCount(0);
  const existingLink = page.url();
  await page.goto(existingLink);
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
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await expect(page.getByLabel('가격 비교 추가', { exact: true })).not.toBeChecked();
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
  await page.getByRole('link', { name: '사용 가능한 분석 열기' }).click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'ONDO');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'price');
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
  await expect(page.getByText('아직 이 지표를 표시할 수 없습니다.')).toBeVisible();
  await expect(page.getByRole('link', { name: '가격 차트 보기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(0);
  await expect(page.getByText(/차트를 불러오는 중|차트를 불러오지 못했습니다/)).toHaveCount(0);
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
  await expect(page.getByText(/차트를 불러오는 중/)).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '사용 가능한 분석 열기' }).click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'price');
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await page
    .getByRole('dialog', { name: '지표 설명', exact: true })
    .getByText('주의할 점', { exact: true })
    .click();
  await page.getByRole('link', { name: '현재 분석 설명' }).click();
  await expect(page).toHaveURL(/\/learn\/candles/);
  await expect(page.getByRole('heading', { name: /캔들/, level: 1 })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('asset')).toBe('ONDO');
  await expect(page.locator('[data-chart-kind],canvas')).toHaveCount(0);
});
test('slow failures, logos and stale data never contaminate another asset', async ({ page }) => {
  await page.route('**/api/v1/network?asset=BTC**', async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await r.fulfill({ status: 503, json: { error: 'BTC fixture outage' } });
  });
  await page.route('**/coin-logos/v2/btc-*.png', (r) => r.abort());
  await page.goto('/?asset=BTC&metric=net:mvrv');
  await expect(page.locator('.coin-picker > summary .asset-logo.fallback')).toBeVisible();
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
  await page.goto('/?asset=ETH&metric=net:mvrv');
  await expect(chart(page)).toBeVisible();
  await expect(page.locator('.indicator-notice')).toContainText(
    '값을 확인하는 데 시간이 걸리고 있습니다.',
  );
  await expect(page.locator('main')).not.toContainText('fixture stale observation');
  await page.goto('/?asset=BTC&metric=net:mvrv');
  await expect(page.getByText('차트를 불러오지 못했습니다.')).toBeVisible();
  await expect(page.getByText(/차트를 불러오는 중/)).toHaveCount(0);
});
for (const width of [320, 390, 768, 1000, 1280, 1440])
  test('indicator charts reflow and pass axe ' + width + 'px both themes', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/?asset=BTC&metric=net:mvrv',
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
  await page.goto('/?asset=BTC&metric=net:mvrv');
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
  const legend = page.locator('.analysis-legend');
  const latest = await legend.innerText();
  await chart(page).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(page).not.toHaveURL(/reading_date=/);
  await expect(legend).toHaveText(latest, { useInnerText: true });
  await expect(page.locator('.analysis-reading-date,.analysis-reading-reset')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
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
  test(
    metric + ' legacy date range, zoom and save restoration retain latest public values',
    async ({ page }) => {
      await page.goto('/?asset=BTC&period=all&metric=' + metric);
      const surface = chart(page);
      await expect(surface).toHaveAttribute('data-range-ready', '1');
      const first = Number(await surface.getAttribute('data-visible-from')),
        last = Number(await surface.getAttribute('data-visible-to')),
        target = first + 30 * 86400;
      const latestValue = await page.locator('.analysis-reading-value').innerText();
      const legacy = new URL(page.url());
      legacy.searchParams.set('chart_from', String(target));
      legacy.searchParams.set('chart_to', String(target + 30 * 86400));
      legacy.searchParams.set('reading_date', String(target));
      await page.goto(legacy.href);
      await expect(surface).toHaveAttribute('data-visible-from', String(target));
      await expect(surface).toHaveAttribute('data-visible-to', String(target + 30 * 86400));
      await expect(page.locator('.analysis-reading-value')).toHaveText(latestValue);
      await expect(
        page.locator('.analysis-reading-date,.analysis-reading-reset,details.analysis-tools'),
      ).toHaveCount(0);
      await page.getByRole('button', { name: '더보기', exact: true }).click();
      const toggle = page.getByRole('checkbox', { name: '가격 비교 추가', exact: true });
      if ((await toggle.isVisible()) && (await toggle.isEnabled())) {
        await toggle.click();
        await expect(toggle).toBeChecked();
      }
      await expect(surface).toHaveAttribute('data-visible-from', String(target));
      await expect(page.getByRole('button', { name: '링크 공유', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '분석 저장' }).click();
      await page.getByLabel('작업공간 이름', { exact: true }).fill('구간 보존');
      await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
      await page.getByRole('link', { name: /구간 보존/ }).click();
      await expect(surface).toHaveAttribute('data-visible-from', String(target));
      await expect(surface).toHaveAttribute('data-visible-to', String(target + 30 * 86400));
      await expect(page.locator('.analysis-reading-value')).toHaveText(latestValue);
      await expect(page.locator('.analysis-reading-date')).toHaveCount(0);
      const allButton = page.getByRole('button', { name: '전체', exact: true });
      await allButton.click();
      await expect(surface).toHaveAttribute('data-visible-to', String(last));
      await expect(page).not.toHaveURL(/reading_date=|chart_from=|chart_to=/);
    },
  );

test('source selection stays separate and automatic refresh preserves the canvas and chosen range', async ({
  page,
}) => {
  await page.clock.install();
  let requests = 0;
  let changed = false;
  await page.route('**/api/v1/network?asset=BTC**', async (route) => {
    requests++;
    const response = await route.fetch(),
      body = await response.json();
    if (changed)
      body.data = body.data.map((p: { time: number; value: number }) => ({
        ...p,
        value: p.value + 1,
      }));
    await route.fulfill({ json: body });
  });
  await page.goto('/?asset=BTC&metric=net:mvrv&period=all');
  const surface = chart(page);
  await expect(surface).toHaveAttribute('data-range-ready', '1');
  const first = Number(await surface.getAttribute('data-visible-from')),
    target = first + 30 * 86400;
  const rangeUrl = new URL(page.url());
  rangeUrl.searchParams.set('chart_from', String(target));
  rangeUrl.searchParams.set('chart_to', String(target + 30 * 86400));
  await page.goto(rangeUrl.href);
  await expect(surface).toHaveAttribute('data-visible-from', String(target));
  const initialRequests = requests;
  const canvas = await surface.locator('canvas').first().elementHandle();
  const before = await page.locator('.analysis-legend').innerText();
  await expect(page.locator('.analysis-reading-value')).toHaveText('1.41 배');
  changed = true;
  await page.clock.fastForward(300001);
  await expect.poll(() => requests).toBeGreaterThan(initialRequests);
  await expect(page.locator('.analysis-legend')).not.toHaveText(before, { useInnerText: true });
  await expect(page.locator('.analysis-reading-value')).toHaveText('2.41 배');
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(surface).toHaveAttribute('data-visible-from', String(target));
  // The older source-specific URL is still supported without a public provenance selector.
  rangeUrl.searchParams.set('metric', 'btc:mvrv');
  await page.goto(rangeUrl.href);
  await expect(surface).toHaveAttribute('data-primary-metric', 'btc:mvrv');
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const navLinks = page.getByRole('navigation', { name: '지표 목록', exact: true });
  await expect(navLinks.locator('a[aria-current=page]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByLabel('보조 지표 1', { exact: true }).selectOption('rsi');
  await expect(page.locator('.analysis-legend')).toContainText('RSI 14');
  await expect(surface).toHaveAttribute('data-visible-from', String(target));
});
