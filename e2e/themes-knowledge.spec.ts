import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('market only loads themes on demand and restores theme/exchange after analysis', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/')) calls.push(r.url());
  });
  await page.goto('/?market=binance&sort=volume');
  await expect(page.locator('.market-table tbody tr')).toHaveCount(50);
  expect(calls.filter((u) => /\/themes|\/knowledge|\/overview|\/network/.test(u))).toEqual([]);
  await page.getByRole('button', { name: '테마', exact: true }).click();
  await expect(page.getByLabel('정렬', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'RWA 관련 1', exact: true }).click();
  await expect(page.locator('.theme-row')).toHaveCount(1);
  await page.getByText('ONDO 분류 근거').click();
  await expect(page.locator('.theme-row')).toContainText('거버넌스');
  await expect(page.locator('.theme-row')).toContainText('편집 분류');
  await page.locator('.theme-row').getByRole('link', { name: /온도/ }).click();
  await expect(page.locator('[data-chart-kind=analysis]')).toHaveAttribute('data-asset', 'ONDO');
  await expect(page).toHaveURL(/metric=rsi/);
  await page.goBack();
  await expect(page).toHaveURL(/theme=rwa/);
  await expect(page.getByRole('button', { name: 'Binance · USDT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.theme-row')).toHaveCount(1);
  expect(calls.filter((u) => u.includes('/api/v1/themes'))).toHaveLength(1);
});

for (const width of [320, 390, 768, 1440])
  test(`relationship evidence, keyboard, map and chart ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const calls: string[] = [];
    page.on('request', (r) => calls.push(r.url()));
    await page.goto('/coins/ONDO?metric=rsi&price_source=binance&period=1y');
    const canvas = page.locator('[data-chart-kind=analysis]');
    await expect(canvas).toHaveAttribute('data-range-ready', '1');
    const before = await canvas.getAttribute('data-visible-from');
    expect(calls.filter((u) => u.includes('/api/v1/knowledge'))).toHaveLength(0);
    await page.getByRole('button', { name: '코인·프로젝트 관계 보기' }).click();
    const dialog = page.getByRole('dialog', { name: 'ONDO 관계와 근거' });
    await expect(dialog.getByRole('heading', { name: /온도/ })).toBeVisible();
    await expect(dialog).toContainText('국채나 이자 수익청구권이 아닙니다');
    await expect(dialog.locator('.knowledge-list li')).toHaveCount(4);
    await dialog.getByRole('button', { name: '관계 지도', exact: true }).click();
    await expect(dialog.locator('.react-flow__node')).toHaveCount(5);
    await dialog
      .locator('.knowledge-list')
      .getByRole('button', { name: /RSI 14/ })
      .first()
      .click();
    await expect(dialog.getByRole('link', { name: 'ONDO RSI 14 차트 열기' })).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
      [],
    );
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: '코인·프로젝트 관계 보기' })).toBeFocused();
    await expect(canvas).toHaveAttribute('data-visible-from', before!);
    await page.getByRole('button', { name: /테마로 변경/ }).click();
    await page.getByRole('button', { name: '코인·프로젝트 관계 보기' }).click();
    await dialog.getByRole('button', { name: '관계 지도', exact: true }).click();
    await expect(dialog.locator('.react-flow__node')).toHaveCount(5);
    const darkScan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(darkScan.violations.map((v) => v.id)).toEqual([]);
    await dialog
      .locator('.knowledge-list')
      .getByRole('button', { name: /RSI 14/ })
      .first()
      .click();
    await dialog.getByRole('link', { name: 'ONDO RSI 14 차트 열기' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/price_source=binance/);
  });

test('purpose search, pinned date, explanation and save preserve the chosen chart', async ({
  page,
}) => {
  await page.goto('/coins/BTC');
  const canvas = page.locator('[data-chart-kind=analysis]');
  await expect(canvas).toHaveAttribute('data-range-ready', '1');
  await page.getByRole('button', { name: /지표 변경$/ }).click();
  const picker = page.getByRole('dialog', { name: '지표 선택' });
  await picker.getByLabel('지표 검색').fill('시장가격 온체인');
  await expect(picker.getByRole('link', { name: 'MVRV 배', exact: true })).toBeVisible();
  await picker.getByRole('link', { name: 'MVRV 배', exact: true }).click();
  await expect(picker).not.toBeVisible();
  const hoverRect = (await canvas.boundingBox())!;
  await page.mouse.move(hoverRect.x + hoverRect.width * 0.7, hoverRect.y + 100);
  await expect(page.locator('.analysis-reading-date')).toContainText('미리 보기');
  await expect(page.getByRole('button', { name: '최근값 보기', exact: true })).not.toBeVisible();
  expect((await canvas.boundingBox())!.y).toBe(hoverRect.y);
  await canvas.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.analysis-reading-date')).toContainText('날짜 고정');
  const fixed = await page.locator('.analysis-reading-date').innerText();
  const rect = (await canvas.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + 100);
  await expect(page.locator('.analysis-reading-date')).toHaveText(fixed);
  await page.getByRole('button', { name: '지표 설명', exact: true }).click();
  await expect(page.locator('.indicator-selected-context')).toContainText(
    fixed
      .match(/\d{4}-\d{2}-\d{2}/)![0]
      .replaceAll('-', '. ')
      .replace(/$/, '.'),
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '최근값 보기', exact: true }).click();
  await expect(page.locator('.analysis-reading-date')).toContainText('최근 확정값');
  await page.getByRole('button', { name: '분석 저장', exact: true }).click();
  await page.getByLabel('작업공간 이름').fill('가치 확인');
  await page.getByRole('button', { name: '현재 구성 저장', exact: true }).click();
  await page.getByRole('link', { name: /가치 확인/ }).click();
  await expect(page.getByRole('dialog', { name: '분석 저장' })).not.toBeVisible();
  await expect(canvas).toHaveAttribute('data-primary-metric', 'net:mvrv');
});
