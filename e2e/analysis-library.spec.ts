import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const chart = (page: import('@playwright/test').Page) =>
  page.locator('[data-chart-kind="analysis"]');
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
});
test('initial full range survives resize and late panes; drawing is scoped and keyboard cancellable', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?asset=DOGE&metric=view:price&price_source=upbit&period=all');
  await expect(chart(page)).toHaveAttribute('data-observations', '1100');
  await expect(chart(page)).toHaveAttribute('data-range-ready', '1');
  const from = Number(await chart(page).getAttribute('data-visible-from')),
    to = Number(await chart(page).getAttribute('data-visible-to'));
  expect((to - from) / 86400).toBeGreaterThan(1095);
  expect((await chart(page).boundingBox())!.y).toBeLessThanOrEqual(260);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect
    .poll(async () => Number(await chart(page).getAttribute('data-visible-from')))
    .toBe(from);
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await page.getByRole('button', { name: '수평선', exact: true }).click();
  const box = (await chart(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + 90);
  await expect(page.locator('.drawing-overlay line')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: '더보기', exact: true }).click();
  await expect(page.locator('.drawing-overlay line')).toHaveCount(1);
  await page.getByLabel('가격 기준', { exact: true }).selectOption('binance');
  await expect(page.locator('.drawing-overlay line')).toHaveCount(0);
  await expect(page.getByLabel('봉 간격', { exact: true })).toBeVisible();
  await page.getByLabel('가격 기준', { exact: true }).selectOption('reference');
  await page.getByLabel('봉 간격', { exact: true }).selectOption('1M');
  await expect(chart(page)).toHaveAttribute('data-observations', /^[1-9]\d$/);
  expect(errors).toEqual([]);
});
test('library import, duplicate/change retention, private chart link and responsive access', async ({
  page,
}) => {
  const post = {
    account: 'fixture_analyst',
    post_id: '123456789',
    date_utc: '2025-05-02T10:00:00Z',
    post_url: 'https://x.com/fixture_analyst/status/123456789',
    text: 'DOGE RSI 차트 검토',
    images: [],
  };
  await page.goto('/workspace/library');
  const upload = async (p: unknown) => {
    await expect(page.getByRole('button', { name: '파일 가져오기', exact: true })).toBeEnabled();
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: 'posts.jsonl',
        mimeType: 'application/x-ndjson',
        buffer: Buffer.from(JSON.stringify(p) + '\n'),
      });
  };
  await upload(post);
  await expect(page.locator('.library-heading')).toContainText('1건');
  await upload(post);
  await expect(page.locator('.library-status')).toContainText('중복 1');
  await upload({ ...post, text: 'DOGE RSI revised' });
  await expect(page.locator('.library-status')).toContainText('변경 1');
  await page.getByRole('searchbox', { name: '개인 자료 검색' }).fill('fixture_analyst');
  await page.locator('.library-row').click();
  await expect(page.locator('.original-text')).toHaveText('DOGE RSI revised');
  await page.getByText('수집 경로·변경 이력', { exact: true }).click();
  await expect(page.getByText(/변경 보관 1건/)).toBeVisible();
  await page.getByLabel('코인', { exact: true }).selectOption('DOGE');
  await page.getByLabel('연결 봉 간격').selectOption('1w');
  await page.getByRole('button', { name: '연결 확인·저장', exact: true }).click();
  const link = page.getByRole('link', { name: '내 차트로 열기', exact: true });
  const href = await link.getAttribute('href');
  expect(href).toContain('asset=DOGE');
  expect(href).toContain('interval=1w');
  expect(href).toContain('chart_to=');
  expect(href).not.toContain('123456789');
  expect(href).not.toContain('fixture_analyst');
  await link.click();
  await expect(chart(page)).toHaveAttribute('data-asset', 'DOGE');
  await expect(page.locator('.analysis-evidence')).toContainText('DOGE RSI revised');
  await page.goto('/workspace/library');
  await expect(page.locator('.library-row')).toHaveCount(1);
  await page.locator('.library-row').click();
  await page.getByLabel('연결 분석 영역', { exact: true }).selectOption('onchain');
  await page.getByLabel('연결 주 지표', { exact: true }).selectOption('net:mvrv');
  await page.getByRole('button', { name: '연결 확인·저장', exact: true }).click();
  await expect(link).toHaveAttribute('href', /\/onchain\/DOGE\?/);
  await link.click();
  await expect(chart(page)).toHaveAttribute('data-primary-metric', 'net:mvrv');
  await expect(page.locator('.analysis-evidence')).toContainText('DOGE RSI revised');
  await page.goto('/workspace/library');
  for (const width of [320, 390, 768, 1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
});
test('unknown extension nonce and malformed rows never enter the library', async ({ page }) => {
  await page.goto('/workspace/library');
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'CD_LIBRARY_CHUNK',
        nonce: 'wrong',
        sequence: 0,
        rows: [{ post_id: '111', account: 'bad', text: 'BAD' }],
      },
      location.origin,
    ),
  );
  await page.getByRole('button', { name: 'Chrome 연결', exact: true }).click();
  await expect(page.locator('.library-row')).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '파일 가져오기', exact: true }).click();
  await (await chooser).setFiles({
    name: 'bad.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from('{corrupt}\n'),
  });
  await expect(page.locator('.library-status')).toContainText('오류 1');
  await expect(page.locator('.library-row')).toHaveCount(0);
});
test('analysis recipes replace the main chart with calculated views', async ({ page }) => {
  await page.goto('/?asset=BTC&price_source=reference&period=all');
  await page.getByRole('button', { name: '지표 변경', exact: true }).click();
  await page.getByLabel('지표 검색', { exact: true }).fill('이동평균 리본');
  await page
    .getByRole('navigation', { name: '지표 목록', exact: true })
    .getByRole('link', { name: '이동평균 리본 가격', exact: true })
    .click();
  await expect(page.locator('.analysis-legend')).toContainText('SMA 7봉');
  await page.getByRole('button', { name: '지표 변경', exact: true }).click();
  await page.getByLabel('지표 검색', { exact: true }).fill('반감기 사이클');
  await page
    .getByRole('navigation', { name: '지표 목록', exact: true })
    .getByRole('link', { name: '반감기 사이클 가격', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'BTC 반감기 사이클' })).toBeVisible();
  await page.getByRole('button', { name: '지표 변경', exact: true }).click();
  await page.getByLabel('지표 검색', { exact: true }).fill('계절성');
  await page
    .getByRole('navigation', { name: '지표 목록', exact: true })
    .getByRole('link', { name: '계절성 가격', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'BTC 계절성' })).toBeVisible();
  await expect(page.getByLabel('봉 간격', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '지표 추가', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '지표 변경', exact: true }).click();
  await page.getByLabel('지표 검색', { exact: true }).fill('상대강도·상관');
  await page
    .getByRole('navigation', { name: '지표 목록', exact: true })
    .getByRole('link', { name: '상대강도·상관 가격', exact: true })
    .click();
  await expect(page.getByLabel('비교 기준', { exact: true })).toBeVisible();
  await expect(chart(page)).toBeVisible();
  await page.getByLabel('비교 기준', { exact: true }).selectOption('ratio');
  await expect(page.locator('.analysis-legend')).toContainText('BTC/coin');
});

test('seasonality waits for the price history before reporting sample availability', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/reference?asset=BTC**', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/?asset=BTC&price_source=reference&period=all&visual=seasonality');
  await expect(page.getByText('지표 이력을 불러오고 있습니다…')).toBeVisible();
  await expect(page.getByText(/현재 0개입니다/)).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'BTC 계절성' })).toBeVisible();
});
