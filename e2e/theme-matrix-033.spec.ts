import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('theme catalog covers 150 identities and confirmed matrix loads only on demand', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/?market=binance');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  expect(requests.filter((u) => /\/themes|\/theme-market/.test(u))).toEqual([]);
  const catalog = await (await page.request.get('/api/v1/themes')).json();
  expect(catalog.themes.length).toBe(31);
  expect(
    new Set(
      catalog.themes.flatMap((t: { members: { asset: string }[] }) =>
        t.members.map((m) => m.asset),
      ),
    ).size,
  ).toBe(150);
  await page.getByRole('button', { name: '테마', exact: true }).click();
  await expect(page.locator('.theme-row')).toHaveCount(31);
  await expect(page.locator('.theme-map-point')).toHaveCount(12);
  const firstIds = await page
    .locator('.theme-map-point')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  const beforeAxes = await page.locator('.theme-map-axis').allTextContents();
  await page
    .getByRole('navigation', { name: '매트릭스 테마 탐색' })
    .getByRole('button', { name: '다음', exact: true })
    .click();
  await expect(page.locator('.theme-map-point')).toHaveCount(12);
  expect(
    await page
      .locator('.theme-map-point')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
  ).not.toEqual(firstIds);
  expect(await page.locator('.theme-map-axis').allTextContents()).toEqual(beforeAxes);
  expect(requests.filter((u) => u.includes('/api/v1/theme-market?'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Upbit · 원화', exact: true }).click();
  await expect
    .poll(() => requests.filter((u) => u.includes('/theme-market?market=upbit')).length)
    .toBe(1);
  await expect(page.locator('.theme-row')).toHaveCount(31);
  await expect(page.locator('main')).not.toContainText(
    /수집 시각|확인일|계산 버전|분류 근거|확보 시작|원천 기준/,
  );
  await expect(page.getByRole('button', { name: /공유|내보내기|데이터 정보/ })).toHaveCount(0);
});

for (const width of [320, 390, 768, 1000, 1280, 1440, 1920])
  test(`three matrix quadrants, accessible selection and themes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Deliberate test inputs exercise all three labels. Never served to production.
    await page.route('**/api/v1/theme-market?*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const points = body.themes.points.slice(0, 3);
      expect(points).toHaveLength(3);
      const values = [
        [8, 2, 'up-volume-up', 'up-high'],
        [-6, 1.8, 'down-volume-up', 'down-high'],
        [4, 0.5, 'volume-down', 'up-low'],
      ];
      body.themes.points = points.map((p: object, i: number) => ({
        ...p,
        x: values[i][0],
        y: values[i][1],
        status: values[i][2],
        quadrant: values[i][3],
      }));
      await route.fulfill({ response, json: body });
    });
    await page.goto('/?view=themes&market=binance');
    await expect(page.locator('.theme-map-point')).toHaveCount(3);
    const map = page.getByRole('group', { name: '테마 가격 변화와 거래량 매트릭스' });
    await expect(map).toContainText('7일 가격 변화');
    await expect(map).toContainText('거래량 배수');
    const points = map.getByRole('button');
    expect(await points.nth(0).getAttribute('aria-label')).toContain('상승');
    expect(await points.nth(1).getAttribute('aria-label')).toContain('조정');
    expect(await points.nth(2).getAttribute('aria-label')).toContain('거래량 감소');
    const transforms = await points.evaluateAll((nodes) =>
      nodes.map((e) =>
        e
          .getAttribute('transform')!
          .match(/[\d.-]+/g)!
          .map(Number),
      ),
    );
    expect(transforms[0][0]).toBeGreaterThan(transforms[1][0]);
    expect(transforms[0][1]).toBeLessThan(transforms[2][1]);
    for (const rect of await page.locator('.theme-map-point rect').all()) {
      expect(Number(await rect.getAttribute('width'))).toBeGreaterThanOrEqual(44);
      expect(Number(await rect.getAttribute('height'))).toBeGreaterThanOrEqual(44);
    }
    for (const dark of [false, true]) {
      if (dark) await page.getByRole('button', { name: '어두운 테마로 변경' }).click();
      // Assert rendered geometry, not only SVG attributes: global button CSS
      // must never replace the observation's coordinate transform.
      const positions = await points.evaluateAll((nodes) =>
        nodes.map((node) => {
          const group = node as SVGGElement;
          const [x, y] = group
            .getAttribute('transform')!
            .match(/[\d.-]+/g)!
            .map(Number);
          const expected = new DOMPoint(x, y).matrixTransform(
            group.ownerSVGElement!.getScreenCTM()!,
          );
          const actual = group.querySelector('circle')!.getBoundingClientRect();
          return {
            dx: Math.abs(actual.x + actual.width / 2 - expected.x),
            dy: Math.abs(actual.y + actual.height / 2 - expected.y),
          };
        }),
      );
      for (const position of positions) {
        expect(position.dx).toBeLessThanOrEqual(1);
        expect(position.dy).toBeLessThanOrEqual(1);
      }
      const firstPointTop = Math.min(
        ...(await map
          .locator('.theme-map-point circle')
          .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top))),
      );
      for (const zone of await map
        .locator('.theme-map-zone')
        .all()
        .then((nodes) => nodes.slice(0, 2))) {
        const box = (await zone.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(firstPointTop);
      }
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await points.nth(0).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/theme=/);
    await expect(page.locator('.theme-row')).toHaveCount(1);
    await expect(page.locator('.theme-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.theme-members a').first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`theme-matrix-${width}.png`) });
    const member = await page.locator('.theme-members a').first().getAttribute('href');
    await page.locator('.theme-members a').first().click();
    expect(new URL(page.url()).pathname).toBe(new URL(member!, 'http://fixture').pathname);
    expect(new URL(page.url()).searchParams.has('metric')).toBe(false);
    await expect(page.locator('.coin-dashboard')).toHaveAttribute(
      'data-asset',
      new URL(member!, 'http://fixture').pathname.split('/').at(-1)!,
    );
    await expect(
      page.locator('.coin-dashboard-card[data-metric="view:price"] [data-chart-kind="analysis"]'),
    ).toHaveAttribute('data-range-ready', '1');
  });

test('failed or unavailable matrix shows one action, never manufactured neutral coordinates', async ({
  page,
}) => {
  await page.route('**/api/v1/theme-market?*', (r) =>
    r.fulfill({ status: 503, json: { error: 'INTERNAL_FIXTURE_DIAGNOSTIC' } }),
  );
  await page.goto('/?view=themes&market=binance');
  await expect(page.getByRole('alert')).toContainText('테마 흐름을 열지 못했습니다.');
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1);
  await expect(page.locator('.theme-map-point')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('INTERNAL_FIXTURE_DIAGNOSTIC');
  await expect(page.getByText('불러오는 중…', { exact: true })).toHaveCount(0);
});

test('theme members disclose a venue change before opening another market', async ({ page }) => {
  await page.goto('/?view=themes&theme=memes&market=upbit');
  const member = page.locator('.theme-members li').filter({ hasText: 'BOME' });
  await expect(member).toContainText('Binance USDT');
  await member.getByRole('link').click();
  await expect(page).toHaveURL(/coins\/BOME\?/);
  await expect(page).toHaveURL(/market=binance/);
  await expect(page).toHaveURL(/price_source=reference/);
  await expect(page.locator('.detail-quote')).toContainText('Binance · USDT');
  await expect(
    page.locator('.coin-dashboard-card[data-metric="view:price"] .coin-dashboard-card-reading'),
  ).toContainText('USD');
  await expect(
    page.locator('.coin-dashboard-card[data-metric="view:price"] [data-chart-kind="analysis"]'),
  ).toHaveAttribute('data-asset', 'BOME');
  await expect(
    page.locator('.coin-dashboard-card[data-metric="view:price"] [data-chart-kind="analysis"]'),
  ).toHaveAttribute('data-range-ready', '1');
});

test('failed refresh retains theme names but removes previous prices and states', async ({
  page,
}) => {
  await page.clock.install();
  let failed = false;
  await page.route('**/api/v1/theme-market?*', async (route) => {
    if (failed) await route.fulfill({ status: 503, json: { error: 'PRIVATE_REFRESH_ERROR' } });
    else await route.continue();
  });
  await page.goto('/?view=themes&market=binance');
  await expect(page.locator('.theme-row')).toHaveCount(31);
  await expect(page.locator('.theme-map-point')).toHaveCount(12);
  expect(await page.locator('.theme-summary').count()).toBeGreaterThan(10);
  failed = true;
  await page.clock.fastForward(60000 + 1000);
  await expect(page.getByRole('alert')).toContainText('테마 흐름을 열지 못했습니다.');
  await expect(page.locator('.theme-row')).toHaveCount(31);
  await expect(
    page.locator('.theme-map-point,.theme-summary,.theme-state,.theme-member-change'),
  ).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('PRIVATE_REFRESH_ERROR');
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1);
});

test('independent theme requests present one loading state and one failure action', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const url of ['**/api/v1/themes', '**/api/v1/theme-market?*'])
    await page.route(url, async (route) => {
      await gate;
      await route.fulfill({ status: 503, json: { error: 'PRIVATE_DUAL_ERROR' } });
    });
  await page.goto('/?view=themes&market=binance');
  const section = page.getByRole('region', { name: '테마 탐색' });
  try {
    await expect(section.getByRole('status')).toHaveCount(1);
    await expect(section.getByRole('status')).toHaveText('불러오는 중…');
  } finally {
    release();
  }
  await expect(section.getByRole('alert')).toHaveCount(1);
  await expect(section.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1);
  await expect(section.getByRole('status')).toHaveCount(0);
  await expect(section).not.toContainText('PRIVATE_DUAL_ERROR');
});
