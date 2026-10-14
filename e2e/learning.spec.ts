import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { GUIDE_ARTICLES } from '../shared/learning-catalog';
import { detectPatterns } from '../shared/candle-patterns';
import type { Candle } from '../shared/types';
test.describe.configure({ mode: 'parallel' });
const chart = (page: Page) => page.locator('[data-chart-kind="analysis"]');
const openApply = (page: Page) => page.locator('.guide-use > summary').click();
async function actualCandles(page: Page, asset: string, market: string): Promise<Candle[]> {
  const rows: Candle[] = [];
  let from = 0;
  for (let count = 0; count < 8; count++) {
    const response = await page.request.get(
      '/api/v1/candles?' +
        new URLSearchParams({ asset, market, interval: '1d', from: String(from), limit: '1000' }),
    );
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.meta.market).toBe(market);
    rows.push(...body.data);
    if (body.nextCursor === null) return rows;
    expect(body.nextCursor).toBeGreaterThan(from);
    from = body.nextCursor;
  }
  throw new Error('Bounded fixture history exceeded');
}
async function noOperationalPanels(page: Page) {
  await expect(
    page.locator(
      '.analysis-reading-date,.indicator-provenance,.guide-supported-assets,.guide-data',
    ),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CSV|내보내기|공유/ })).toHaveCount(0);
}

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
  await expect(page.getByLabel('사전 가격 기준', { exact: true })).toHaveValue('reference');
  await expect(page.locator('.guide-apply')).toContainText(
    '이 가격 기준에는 표시할 수 없습니다. 다른 가격 기준을 선택해 주세요.',
  );
  await expect(page.locator('.guide-primary')).toHaveCount(2);
  const alternatives = await page
    .locator('.guide-primary')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
  expect(alternatives.every((href) => new URL(href).searchParams.get('asset') === 'DOGE')).toBe(
    true,
  );
  expect(alternatives.map((href) => new URL(href).searchParams.get('price_source')).sort()).toEqual(
    ['binance', 'upbit'],
  );
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
  expect(
    detectPatterns(await actualCandles(page, 'DOGE', 'upbit'), ['bullish-engulfing'], 'none'),
  ).toEqual([]);
  await expect(page.getByRole('region', { name: '캔들 패턴 관찰' })).toHaveCount(0);
  await noOperationalPanels(page);
  const picker = page.getByRole('button', { name: '캔들 패턴 1', exact: true });
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await picker.click();
  await expect(page.getByRole('dialog', { name: '캔들 패턴' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeFocused();
});

test('confirmed pattern calculations and legacy bookmarks survive save and resizing without public date lists or sharing UI', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/learn/pattern-doji?asset=DOGE&price_source=upbit&period=all');
  await openApply(page);
  await page.locator('.guide-primary').click();
  await expect(chart(page)).toHaveAttribute('data-observations', '1100');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  expect((await chart(page).boundingBox())!.y).toBeLessThanOrEqual(240);
  const input = await actualCandles(page, 'DOGE', 'upbit');
  const hits = detectPatterns(input, ['doji'], 'sma50');
  expect(hits).toHaveLength(1100);
  // The bounded test DB uses equal open/close bars, so every finalized bar meets
  // the doji body/range condition. No source substitution or future bars are used.
  expect(hits.every((hit) => hit.body === 0 && hit.confirmedAt <= Date.now() / 1000)).toBe(true);
  await expect(page.getByRole('region', { name: '캔들 패턴 관찰' })).toHaveCount(0);
  const first = Number(await chart(page).getAttribute('data-visible-from'));
  const selected = hits.at(-1)!;
  const bookmarked = new URL(page.url());
  bookmarked.searchParams.set('pattern_focus', selected.id);
  bookmarked.searchParams.set('reading_date', String(selected.time));
  await page.goto(bookmarked.href);
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect
    .poll(async () => Number(await chart(page).getAttribute('data-visible-from')))
    .toBeGreaterThan(first);
  const latest = await page.locator('.analysis-reading-value').innerText();
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect
    .poll(async () => Number(await chart(page).getAttribute('data-visible-from')))
    .toBeGreaterThan(first);
  const focusedFrom = await chart(page).getAttribute('data-visible-from');
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(chart(page)).toHaveAttribute('data-visible-from', focusedFrom!);
  const url = new URL(page.url());
  url.searchParams.set('chart_from', focusedFrom!);
  url.searchParams.set('chart_to', (await chart(page).getAttribute('data-visible-to'))!);
  await page.goto(url.href);
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  await expect(chart(page)).toHaveAttribute(
    'data-visible-from',
    url.searchParams.get('chart_from')!,
  );
  await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
  await noOperationalPanels(page);
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름', { exact: true }).fill('도지 조건 확인');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('button', { name: '분석 저장 닫기', exact: true }).click();
  await page.goto('/workspace');
  await page.getByRole('link', { name: /도지 조건 확인/ }).click();
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  expect(new URL(page.url()).searchParams.get('patterns')).toBe('doji');
  expect(new URL(page.url()).searchParams.get('reading_date')).toBe(String(selected.time));
  await expect(chart(page)).toHaveAttribute('data-visible-from', focusedFrom!);
  // Selection focus is a legacy URL state, not a saved-workspace field.
  // Reapply it explicitly to verify asset changes still clear the old asset's selection.
  const reopen = new URL(page.url());
  reopen.searchParams.set('pattern_focus', selected.id);
  await page.goto(reopen.href);
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  expect(new URL(page.url()).searchParams.get('pattern_focus')).toBe(selected.id);
  await page.getByRole('button', { name: /코인 변경/ }).click();
  await page.getByRole('searchbox', { name: '코인 검색' }).fill('ETH');
  await page.getByRole('searchbox', { name: '코인 검색' }).press('Enter');
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
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await page
    .getByRole('dialog', { name: '지표 설명', exact: true })
    .getByText('주의할 점', { exact: true })
    .click();
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await expect(page.locator('.guide-title')).toContainText('MVRV');
  await expect(page.locator('.guide-supported-assets,.guide-data')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('asset')).toBe('ETH');
  await openApply(page);
  await expect(page.getByLabel('사전 가격 기준', { exact: true })).toHaveValue('upbit');
  await page.goto('/learn/powerlaw?asset=DOGE&price_source=upbit');
  await openApply(page);
  await expect(page.locator('.guide-apply')).toContainText('DOGE에는 제공하지 않습니다');
  await expect(page.locator('.guide-primary')).toContainText('BTC');
  await page.locator('.guide-primary').click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'BTC');
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await expect(page.getByLabel('가격 기준', { exact: true })).toHaveValue('reference');
});

test.describe('deferred explanation lesson input', () => {
  test.use({ hasTouch: true });
  test('lesson loading never exposes moving actions or retargets a native close, and guide context stays intact', async ({
    page,
  }) => {
    type Input = { type: string; trusted: boolean; label: string | null; summary?: string };
    await page.addInitScript(() => {
      const events: Input[] = [];
      Object.assign(window, { nativeLessonEvents: events });
      for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend'])
        document.addEventListener(
          type,
          (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target?.closest('.desk-dialog')) return;
            events.push({
              type,
              trusted: event.isTrusted,
              label: target.closest('button')?.getAttribute('aria-label') ?? null,
              summary: target.closest('summary')?.textContent ?? undefined,
            });
          },
          true,
        );
    });
    let releaseLesson: (() => Promise<void>) | undefined;
    await page.route('**/*IndicatorMethod*', async (route) => {
      const response = await route.fetch();
      releaseLesson = () => route.fulfill({ response });
    });
    const inputs = () =>
      page.evaluate(
        () => (window as unknown as Window & { nativeLessonEvents: Input[] }).nativeLessonEvents,
      );
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ]) {
      releaseLesson = undefined;
      await page.setViewportSize(viewport);
      await page.goto('/learn/net-mvrv?asset=ETH&price_source=upbit');
      await openApply(page);
      await page.locator('.guide-primary').click();
      await expect(chart(page)).toHaveAttribute('data-asset', 'ETH');
      await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
      const range = [
        await chart(page).getAttribute('data-visible-from'),
        await chart(page).getAttribute('data-visible-to'),
      ];
      const canvas = await chart(page).locator('canvas').first().elementHandle();
      const latest = await page.locator('.analysis-reading-value').innerText();
      const trigger = page.getByRole('button', { name: /^지표 설명/ });
      if (viewport.width < 768) await trigger.tap();
      else await trigger.click();
      await expect.poll(() => Boolean(releaseLesson)).toBe(true);
      const dialog = page.getByRole('dialog', { name: '지표 설명', exact: true });
      await expect(dialog).toHaveClass(/desk-dialog-reading/);
      await expect(dialog.locator('.indicator-concept')).toBeVisible();
      await expect(dialog.getByText('주의할 점', { exact: true })).toHaveCount(0);
      await expect(dialog.getByText('계산식·기호', { exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('link', { name: '현재 분석 설명', exact: true })).toHaveCount(
        0,
      );
      const close = dialog.getByRole('button', { name: '지표 설명 닫기', exact: true });
      const closeBefore = (await close.boundingBox())!;
      const dialogBefore = (await dialog.boundingBox())!;
      await page.mouse.move(
        closeBefore.x + closeBefore.width / 2,
        closeBefore.y + closeBefore.height / 2,
      );
      await page.mouse.down();
      await releaseLesson!();
      await expect(dialog.locator('.indicator-method').first()).toBeVisible();
      const closeAfter = await close.boundingBox();
      const dialogAfter = await dialog.boundingBox();
      expect(closeAfter).toEqual(closeBefore);
      expect(dialogAfter).toEqual(dialogBefore);
      await page.mouse.up();
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      const closeEvents = await inputs();
      for (const type of ['pointerdown', 'pointerup', 'click'])
        expect(closeEvents.filter((event) => event.type === type).at(-1)).toMatchObject({
          trusted: true,
          label: '지표 설명 닫기',
        });

      if (viewport.width < 768) await trigger.tap();
      else await trigger.click();
      const caution = dialog.getByText('주의할 점', { exact: true });
      await caution.scrollIntoViewIfNeeded();
      const cautionBefore = (await caution.boundingBox())!;
      await page.mouse.move(
        cautionBefore.x + cautionBefore.width / 2,
        cautionBefore.y + cautionBefore.height / 2,
      );
      await page.mouse.down();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(await caution.boundingBox()).toEqual(cautionBefore);
      await page.mouse.up();
      await expect(caution.locator('..')).toHaveAttribute('open', '');
      await expect(dialog.getByRole('link', { name: '현재 분석 설명', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      if (viewport.width < 768) {
        await trigger.tap();
        await close.tap();
        await expect(dialog).not.toBeVisible();
        await expect(trigger).toBeFocused();
        expect(
          (await inputs()).some(
            (event) =>
              event.type === 'touchstart' && event.trusted && event.label === '지표 설명 닫기',
          ),
        ).toBe(true);
      }
      await expect(page.locator('.analysis-reading-value')).toHaveText(latest);
      await expect(chart(page)).toHaveAttribute('data-visible-from', range[0]!);
      await expect(chart(page)).toHaveAttribute('data-visible-to', range[1]!);
      expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
      await trigger.click();
      await caution.focus();
      await page.keyboard.press('Enter');
      await expect(caution.locator('..')).toHaveAttribute('open', '');
      await dialog.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
      await expect(page.locator('.guide-title')).toContainText('MVRV');
      expect(new URL(page.url()).searchParams.get('asset')).toBe('ETH');
      expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
      await test.info().attach(`lesson-native-targets-${viewport.width}.json`, {
        body: Buffer.from(
          JSON.stringify({
            viewport,
            closeBefore,
            closeAfter,
            dialogBefore,
            dialogAfter,
            cautionBefore,
            range,
            events: closeEvents,
          }),
        ),
        contentType: 'application/json',
      });
    }
  });
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
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  await page.getByLabel('지표 검색', { exact: true }).fill('가격 위치');
  await page
    .getByRole('navigation', { name: '지표 목록', exact: true })
    .getByRole('link', { name: /^가격 위치 밴드/ })
    .click();
  await page.getByRole('button', { name: /^지표 설명/ }).click();
  await page
    .getByRole('dialog', { name: '지표 설명', exact: true })
    .getByText('주의할 점', { exact: true })
    .click();
  await page.getByRole('link', { name: '현재 분석 설명', exact: true }).click();
  await expect(page.locator('.guide-title')).toContainText('가격 위치 밴드');
});

test('guide text follows the theme background without a low-contrast transition', async ({
  page,
}) => {
  await page.goto('/learn/pattern-bullish-engulfing?asset=DOGE');
  await expect(page.locator('.guide-use > summary')).toBeVisible();
  const samples = await page.evaluate(async () => {
    const summary = document.querySelector('.guide-use > summary')!;
    const colors: { actual: string; expected: string }[] = [];
    for (const theme of ['dark', 'light']) {
      // Read the old style before changing the same attribute used by the theme control.
      getComputedStyle(summary).color;
      document.documentElement.dataset.theme = theme;
      for (let frame = 0; frame < 3; frame++) {
        await new Promise(requestAnimationFrame);
        colors.push({
          actual: getComputedStyle(summary).color,
          expected: getComputedStyle(document.querySelector('.guide-article')!).color,
        });
      }
    }
    return colors;
  });
  for (const sample of samples) expect(sample.actual).toBe(sample.expected);
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
    await page.getByRole('button', { name: '더보기', exact: true }).click();
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
  const catalogRequests: string[] = [];
  await page.route('**/api/v1/network-catalog?asset=ETH', async (route) => {
    catalogRequests.push(route.request().url());
    await route.fulfill({ json: { data: [] } });
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/learn/net-mvrv?asset=ETH');
  await expect(page.locator('.guide-method')).toContainText('시가총액');
  await expect(page.locator('.guide-apply')).toHaveCount(0);
  await openApply(page);
  await expect.poll(() => catalogRequests.length).toBe(1);
  await expect(page.getByLabel('사전 코인', { exact: true })).toHaveValue('ETH');
  await expect(page.locator('.guide-apply').getByRole('status')).toHaveText(
    '이 지표를 표시할 수 없습니다. 다른 지표를 선택해 주세요.',
  );
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
  await expect(page).toHaveURL(/#example$/);
  await expect(page.locator('#example')).toBeFocused();
  await expect(page.locator('#example')).toBeInViewport();
  await openApply(page);
  await expect(page.locator('.guide-primary')).toContainText('DOGE · Upbit KRW');
  await page.locator('.guide-primary').click();
  await expect(page.locator('[data-chart-kind="analysis"]')).toBeVisible();
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
    await expect(page.locator('.guide-supported-assets,.guide-data')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '데이터·지원 범위' })).toHaveCount(0);
    await expect(page.locator('.guide-toc a')).toHaveCount(4);
    expect(
      await page
        .locator('.guide-toc a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(['#meaning', '#method', '#example', '#limits']);
  }
});
