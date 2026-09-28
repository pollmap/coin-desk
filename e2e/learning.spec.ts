import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { GUIDE_ARTICLES } from '../shared/learning-catalog';
test.describe.configure({ mode: 'parallel' });
const chart = (page: Page) => page.locator('[data-chart-kind="analysis"]');
const openApply = (page: Page) => page.locator('.guide-use > summary').click();
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
});

test('guide search retains filters, favorites and source context; real OHLC is required', async ({
  page,
}) => {
  await page.goto('/learn?asset=DOGE&price_source=reference');
  await page.getByRole('button', { name: '캔들 패턴', exact: true }).click();
  await page.getByRole('searchbox', { name: '분석 사전 검색' }).fill('장악형');
  await expect(page.locator('.learn-row')).toHaveCount(2);
  await page.getByRole('button', { name: '상승 장악형 즐겨찾기', exact: true }).click();
  await page.locator('.learn-row > a').filter({ hasText: '상승 장악형' }).click();
  await expect(page.getByRole('heading', { name: '상승 장악형', exact: true })).toBeVisible();
  await openApply(page);
  await expect(page.getByLabel('사전 코인', { exact: true })).toHaveValue('DOGE');
  await expect(page.locator('.guide-apply')).toContainText('필요한 데이터가 없습니다');
  await expect(page.locator('.guide-primary')).toHaveCount(2);
  await page.getByRole('link', { name: '사전 목록', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '분석 사전 검색' })).toHaveValue('장악형');
  await page.getByRole('button', { name: '즐겨찾기', exact: true }).click();
  await page.reload();
  await expect(page.locator('.learn-row')).toHaveCount(1);
  await page.locator('.learn-row > a').click();
  await openApply(page);
  await page.getByLabel('사전 패턴 추세 필터').selectOption('none');
  await page.locator('.guide-primary').filter({ hasText: 'Upbit' }).click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  await expect(chart(page)).toHaveAttribute('data-observations', '1100');
  expect(new URL(page.url()).searchParams.get('patterns')).toBe('bullish-engulfing');
  expect(new URL(page.url()).searchParams.get('pattern_trend')).toBe('none');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(page.getByRole('region', { name: '캔들 패턴 관찰' })).toContainText('0건');
  const picker = page.getByRole('button', { name: '캔들 패턴 1', exact: true });
  await picker.click();
  await expect(page.getByRole('dialog', { name: '캔들 패턴' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeFocused();
});

test('confirmed patterns navigate their chart, survive save/share and clear selection on asset change', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/learn/pattern-doji?asset=DOGE&price_source=upbit');
  await openApply(page);
  await page.locator('.guide-primary').click();
  await expect(chart(page)).toHaveAttribute('data-observations', '1100');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  expect((await chart(page).boundingBox())!.y).toBeLessThanOrEqual(260);
  const list = page.getByRole('region', { name: '캔들 패턴 관찰' });
  await expect(list).toContainText('1100건');
  const first = Number(await chart(page).getAttribute('data-visible-from'));
  await list
    .getByRole('button', { name: /차트에서 보기/ })
    .first()
    .click();
  await expect(page.locator('.pattern-detail')).toContainText('몸통');
  await expect
    .poll(async () => Number(await chart(page).getAttribute('data-visible-from')))
    .toBeGreaterThan(first);
  // A plain bookmarked observation (before generating an explicit range share)
  // must survive initial layout, a reload and subsequent chart resizing.
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect
    .poll(async () => Number(await chart(page).getAttribute('data-visible-from')))
    .toBeGreaterThan(first);
  const focusedFrom = await chart(page).getAttribute('data-visible-from');
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(chart(page)).toHaveAttribute('data-visible-from', focusedFrom!);
  await page.locator('.analysis-tools > summary').click();
  await page.getByRole('button', { name: '링크 공유', exact: true }).click();
  const url = await page.getByRole('textbox', { name: '공유 주소', exact: true }).inputValue();
  expect(new URL(url).searchParams.get('patterns')).toBe('doji');
  await page.goto(url);
  await expect(list).toContainText('1100건');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(chart(page)).toHaveAttribute(
    'data-visible-from',
    new URL(url).searchParams.get('chart_from')!,
  );
  await page
    .locator('.analysis-save > summary')
    .filter({ hasText: '작업공간 저장·불러오기' })
    .click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('도지 조건 확인');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await expect(page.getByRole('link', { name: /도지 조건 확인/ })).toBeVisible();
  await page.getByRole('link', { name: '이더리움 ETH', exact: true }).click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'ETH');
  expect(new URL(page.url()).searchParams.has('pattern_focus')).toBe(false);
});

test('onchain guides open the corresponding primary metric and unsupported coins are explicit', async ({
  page,
}) => {
  await page.goto('/learn/net-mvrv?asset=ETH&price_source=upbit');
  await openApply(page);
  await page.locator('.guide-primary').click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'ETH');
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await expect(page.locator('.guide-title')).toContainText('MVRV');
  await openApply(page);
  await expect(page.getByLabel('사전 가격 기준', { exact: true })).toHaveValue('upbit');
  await page.goto('/learn/powerlaw?asset=DOGE&price_source=upbit');
  await openApply(page);
  await expect(page.locator('.guide-apply')).toContainText('DOGE에는 제공하지 않습니다');
  await expect(page.locator('.guide-primary')).toContainText('BTC');
  await page.locator('.guide-primary').click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'BTC');
  await expect(page.getByLabel('가격 기준', { exact: true })).toHaveValue('reference');
});

test('a guide activates a real drawing tool and Help follows the selected analysis', async ({
  page,
}) => {
  await page.goto('/learn/tool-measure?asset=ETH&price_source=binance');
  await openApply(page);
  await page.locator('.guide-primary').click();
  const tool = page.getByRole('button', { name: '구간 측정', exact: true });
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const box = (await chart(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.35, box.y + 130);
  await expect(page.locator('.drawing-overlay circle')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.55, box.y + 160);
  await expect(page.locator('.drawing-overlay text')).toContainText('%');
  await page.reload();
  await expect(page.locator('.drawing-overlay text')).toContainText('%');
  await page.keyboard.press('Escape');
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('.drawing-overlay line')).toHaveCount(0);
  await page.getByRole('button', { name: '평행 채널', exact: true }).click();
  const channelBox = (await chart(page).boundingBox())!;
  await page.mouse.click(channelBox.x + channelBox.width * 0.25, channelBox.y + 80);
  await page.mouse.click(channelBox.x + channelBox.width * 0.65, channelBox.y + 120);
  await page.mouse.click(channelBox.x + channelBox.width * 0.45, channelBox.y + 160);
  await expect(page.locator('.drawing-overlay line')).toHaveCount(2);
  await page.getByLabel('차트 시각화', { exact: true }).selectOption('rainbow');
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await expect(page.locator('.guide-title')).toContainText('가격 위치 밴드');
});

for (const width of [320, 390, 768, 1000, 1280, 1440]) {
  test(`guides and pattern controls are accessible at ${width}px in both themes`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/learn?asset=DOGE',
      '/learn/pattern-bullish-engulfing?asset=DOGE',
      '/learn/rainbow?asset=DOGE',
      '/?asset=DOGE&price_source=upbit&period=all&patterns=doji',
    ]) {
      await page.goto(path);
      if (path.startsWith('/?'))
        await expect(chart(page)).toHaveAttribute('data-observations', '1100');
      else await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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
    await page.getByRole('button', { name: '캔들 패턴 1', exact: true }).click();
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(scan.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '캔들 패턴 1', exact: true })).toBeFocused();
  });
}

test('guide remains usable at 200 percent zoom with keyboard and missing observations', async ({
  page,
}) => {
  await page.route('**/api/v1/network-catalog?asset=ETH', async (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/learn/net-mvrv?asset=ETH');
  await expect(page.locator('.guide-method')).toContainText('시가총액');
  await expect(page.locator('.guide-apply')).toHaveCount(0);
  await openApply(page);
  await expect(page.locator('.guide-apply')).toContainText('실제 관측이 아직 없습니다');
  await expect(page.locator('.guide-primary')).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const method = page.getByRole('link', { name: '계산식·조건', exact: true });
  await method.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.guide-method')).toBeFocused();
  await page.reload();
  await expect(page.locator('.guide-method')).toBeVisible();
  await expect(page.locator('.guide-apply')).toHaveCount(0);
});

test('reading shortcuts stay in the dictionary, formulas are open and learning does not fetch chart data', async ({
  page,
}) => {
  const chartRequests: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/(reference|candles|network-catalog|network-series|derivatives)\?/.test(r.url()))
      chartRequests.push(r.url());
  });
  await page.goto('/learn?asset=DOGE&price_source=upbit');
  const links = await page
    .locator('.learn-presets a')
    .evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  expect(links.every((href) => href?.startsWith('/learn/'))).toBe(true);
  await page.getByRole('link', { name: /가격 위치 밴드 읽기/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('가격 위치 밴드');
  await expect(page.locator('.guide-method')).toContainText('σ = √');
  await expect(page.locator('.guide-example')).toContainText('+0.91');
  await expect(page.locator('.guide-example')).toContainText('111.63');
  await expect(page.locator('.guide-reading')).toContainText('−1.3 ≤ z < −0.55');
  await expect(page.locator('canvas, [data-chart-kind], .guide-primary')).toHaveCount(0);
  await page.getByRole('link', { name: '숫자로 읽어보기', exact: true }).click();
  await expect(page.locator('#example')).toBeFocused();
  const related = page
    .locator('.guide-related')
    .getByRole('link', { name: '볼린저밴드', exact: true });
  await related.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('볼린저밴드');
  // Let the common route focus callback run before checking the final target.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(chartRequests).toEqual([]);
  await page.goBack();
  await expect(page.locator('.guide-method')).toContainText('N = 730');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await openApply(page);
  await expect(page.locator('.guide-primary')).toContainText('DOGE · Upbit KRW');
  await page.locator('.guide-primary').click();
  await expect(page.locator('[data-chart-kind="position"]')).toBeVisible();
});

test('chart application keeps the selected control visible and focused when its context changes', async ({
  page,
}) => {
  await page.goto('/learn/rainbow?asset=BTC&price_source=reference');
  await openApply(page);
  for (const [name, value] of [
    ['사전 코인', 'ETH'],
    ['사전 가격 기준', 'binance'],
    ['사전 코인', 'DOGE'],
  ]) {
    const control = page.getByLabel(name, { exact: true });
    await control.focus();
    await control.selectOption(value);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(control).toBeFocused();
    const bounds = (await control.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await expect(page.locator('.guide-primary')).toContainText('DOGE · Binance USDT');
});

test('reader reflows in a narrow desktop container, including expanded chart controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const id of ['rainbow', 'net-mvrv', 'pattern-bullish-engulfing']) {
    await page.goto(`/learn/${id}?asset=ETH`);
    await expect(page.locator('.guide-article')).toBeVisible();
    // Desktop media queries still apply, but the available reading area is narrow.
    await page.addStyleTag({ content: '.learn-page { max-width: 320px; }' });
    await openApply(page);
    const toc = await page.locator('.guide-toc').boundingBox();
    const article = await page.locator('.guide-article').boundingBox();
    expect(toc!.y + toc!.height).toBeLessThanOrEqual(article!.y);
    expect(article!.width).toBeGreaterThanOrEqual(319);
    expect(
      await page.locator('.guide-article').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    for (const select of await page.locator('.guide-apply select').all()) {
      const bounds = (await select.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(article!.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(article!.x + article!.width);
    }
  }
});

test('every existing guide renders an explanation and worked example without a chart', async ({
  page,
}) => {
  test.setTimeout(180000);
  for (const article of GUIDE_ARTICLES) {
    await page.goto('/learn/' + article.id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(article.title);
    await expect(page.locator('.guide-method li').first()).toBeVisible();
    await expect(page.locator('.guide-example li').first()).toBeVisible();
    await expect(page.locator('canvas, [data-chart-kind], .guide-apply')).toHaveCount(0);
  }
});
