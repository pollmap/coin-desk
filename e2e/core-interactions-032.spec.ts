import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('primary shortcuts are price, MVRV and Supertrend, and navigate in the same chart', async ({
  page,
}) => {
  await page.goto(
    '/coins/BTC?metric=view:price&price_source=upbit&period=1y&chart_from=1704067200&chart_to=1725148800',
  );
  const shortcuts = page.getByRole('navigation', { name: '자주 보는 지표' });
  await expect(shortcuts.getByRole('link')).toHaveText(['가격', 'MVRV', '슈퍼트렌드']);
  const original = page.url();
  await shortcuts.getByRole('link', { name: '가격', exact: true }).click();
  expect(page.url()).toBe(original);
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const chooser = page.getByRole('dialog', { name: '지표 선택', exact: true });
  await chooser.locator('.indicator-picker-results a[aria-current="page"]').click();
  await expect(chooser).not.toBeVisible();
  expect(page.url()).toBe(original);
  for (const [name, metric] of [
    ['MVRV', 'net:mvrv'],
    ['슈퍼트렌드', 'view:supertrend'],
    ['가격', 'view:price'],
  ]) {
    await shortcuts.getByRole('link', { name, exact: true }).click();
    await expect(page.locator('.indicator-workspace')).toHaveAttribute('data-indicator', metric);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-chart-kind="analysis"]')).toHaveAttribute(
      'data-range-ready',
      '1',
    );
  }
  expect(page.context().pages()).toHaveLength(1);
  await expect(page.locator('.analysis-reading-date,.indicator-provenance')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '데이터 정보', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CSV|내보내기|공유/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^관측 신호/ })).toHaveCount(0);
  await page.goto('/coins/ONDO?metric=rsi&price_source=upbit');
  await expect(shortcuts.getByRole('link')).toHaveText(['가격', '슈퍼트렌드']);
  await expect(shortcuts.getByRole('link', { name: 'RSI', exact: true })).toHaveCount(0);
});

for (const width of [320, 390, 1280]) {
  test(`indicator chooser reflows in its portal, keeps IME input and returns focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/coins/BTC?metric=view:price&price_source=upbit');
    const trigger = page.getByRole('button', { name: /지표 변경$/ });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '지표 선택', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    if (width < 768) await expect(dialog).toHaveClass(/desk-dialog-sheet/);
    const search = dialog.getByRole('textbox', { name: '지표 검색' });
    await expect(search).toBeFocused();
    await expect(dialog.getByRole('combobox', { name: '지표 목적' })).toHaveValue('가격과 추세');
    await expect(dialog.getByRole('group', { name: '지표 분류' })).toHaveCount(0);
    const original = page.url();
    await search.dispatchEvent('compositionstart', { data: '가' });
    await search.fill('가치평가');
    await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await search.dispatchEvent('compositionend', { data: '가치평가' });
    expect(page.url()).toBe(original);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: '지표 목적' })).toHaveValue('all');
    await expect(dialog.getByRole('link', { name: 'MVRV 배', exact: true })).toBeVisible();
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const links = [...element.querySelectorAll('.indicator-picker-results a')];
      return {
        x: rect.x,
        right: rect.right,
        y: rect.y,
        bottom: rect.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        rowHeight: links[0]?.getBoundingClientRect().height,
        controlHeights: [...element.querySelectorAll('input,select,button')].map(
          (control) => control.getBoundingClientRect().height,
        ),
        portal: !element.closest('.product-desk'),
      };
    });
    expect(geometry.portal).toBe(true);
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.y).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    if (width < 768) expect(geometry.bottom).toBe(geometry.viewportHeight);
    expect(geometry.rowHeight).toBeGreaterThanOrEqual(56);
    for (const height of geometry.controlHeights)
      expect(height).toBeGreaterThanOrEqual(width < 768 ? 44 : 40);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`chooser-${width}-${theme}.png`) });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });
}

test('dictionary rows are concise and illustrations are distinct from real data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/learn?asset=DOGE');
  const metadata = page.locator('.learn-row-meta small');
  await expect(metadata.first()).toBeVisible();
  for (const text of await metadata.allTextContents()) {
    expect(text.length).toBeLessThan(30);
    expect(text).not.toContain('BTC · DOGE · ETH');
  }
  for (const [id, kind] of [
    ['net-mvrv', 'mvrv'],
    ['supertrend', 'supertrend'],
    ['rainbow', 'bands'],
    ['ribbon', 'ribbon'],
  ]) {
    await page.goto(`/learn/${id}?asset=DOGE&price_source=upbit`);
    const concept = page.locator(`.indicator-concept[data-concept="${kind}"]`);
    await expect(concept).toBeVisible();
    await expect(concept.getByRole('img')).toHaveAttribute('aria-label', /.+/);
    await expect(concept).toContainText('설명용 예시');
    await expect(concept).toContainText('현재 데이터가 아닙니다');
    await concept.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(concept.locator('figcaption')).toBeVisible();
    await concept.screenshot({ path: test.info().outputPath(`concept-${kind}.png`) });
    await expect(page.locator('[data-chart-kind="analysis"]')).toHaveCount(0);
    await expect(page.locator('.guide-supported-assets')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '데이터·지원 범위' })).toHaveCount(0);
    expect(
      await page
        .locator('.guide-toc a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(['#meaning', '#method', '#example', '#limits']);
    expect(new URL(page.url()).searchParams.get('asset')).toBe('DOGE');
    expect(new URL(page.url()).searchParams.get('price_source')).toBe('upbit');
    await expect(page.locator('.guide-method li').first()).toBeVisible();
    await expect(page.locator('.guide-example li').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('global search cannot open a second modal over the indicator chooser', async ({ page }) => {
  await page.goto('/coins/BTC?metric=view:price&price_source=upbit');
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const chooser = page.getByRole('dialog', { name: '지표 선택', exact: true });
  await chooser.getByRole('button', { name: '지표 선택 닫기', exact: true }).focus();
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(chooser).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chooser).not.toBeVisible();
  await page.getByRole('button', { name: /지표 변경$/ }).focus();
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog', { name: '코인·지표 검색', exact: true })).toBeVisible();
});

test('hashrate picker and dictionary keep the selected network units and formula', async ({
  page,
}) => {
  for (const asset of ['DASH', 'ZEC']) {
    await page.goto(`/coins/${asset}?metric=net:hashrate&price_source=binance`);
    await page.getByRole('button', { name: /지표 변경$/ }).click();
    const chooser = page.getByRole('dialog', { name: '지표 선택', exact: true });
    await chooser.getByRole('textbox', { name: '지표 검색' }).fill('해시');
    await expect(
      chooser.getByRole('link', { name: '평균 해시레이트 GH/s', exact: true }),
    ).toBeVisible();
    for (const unit of await chooser.locator('.indicator-picker-meta small').allTextContents())
      expect(unit).toBe('GH/s');
    await page.keyboard.press('Escape');
    await page.goto(`/learn/net-hashrate?asset=${asset}`);
    await expect(page.locator('.guide-method')).toContainText('1 GH/s');
    await expect(page.locator('.guide-method')).toContainText('10⁹');
    await expect(page.locator('.guide-method')).not.toContainText('1 TH/s');
    await expect(page.locator('.guide-example')).toContainText('2 GH/s');
    await page.locator('.guide-use > summary').click();
    await expect(page.getByLabel('사전 코인', { exact: true })).toHaveValue(asset);
    expect(new URL(page.url()).searchParams.get('asset')).toBe(asset);
    await expect(page.locator('.guide-primary')).toContainText(asset);
  }
});
