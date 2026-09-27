import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const png = readFileSync('public/brand/favicon-32.png');
test('private backup restores text, recipe and hashed original media in an empty browser', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }),
  );
  await page.goto('/workspace/library');
  await page.getByLabel('원본 이미지도 보관').check();
  const post = {
    post_id: '987654321',
    account: 'fixture',
    text: 'BTC original',
    date_utc: '2025-01-15T00:00:00Z',
    images: [{ file: 'chart.png' }],
    recipe: {
      asset: 'BTC',
      view: 'ribbon',
      source: 'reference',
      verified: true,
      indicators: ['sma200'],
    },
  };
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles([
      {
        name: 'posts.jsonl',
        mimeType: 'application/x-ndjson',
        buffer: Buffer.from(JSON.stringify(post) + '\n'),
      },
      { name: 'chart.png', mimeType: 'image/png', buffer: png },
    ]);
  await expect(page.locator('.library-status')).toContainText('이미지 보관 1');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '백업 저장', exact: true }).click();
  const path = await (await downloaded).path();
  expect(path).toBeTruthy();
  const data = await readFile(path!, 'utf8');
  expect(data).toContain('"sha256"');
  const ctx = await browser.newContext({ baseURL });
  const restored = await ctx.newPage();
  await restored.goto('/workspace/library');
  await restored.locator('input[type=file][accept=".jsonl"]').setInputFiles(path!);
  await expect(restored.locator('.library-status')).toContainText('1건 복원했습니다.');
  await restored.locator('.library-row').click();
  await expect(restored.locator('.original-text')).toHaveText('BTC original');
  await expect(restored.getByRole('img', { name: '보관한 원본 차트 · 작성자 해석' })).toBeVisible();
  expect(
    await restored.getByRole('link', { name: '내 차트로 열기', exact: true }).getAttribute('href'),
  ).toContain('indicators=sma200');
  await restored.locator('input[type=file][accept=".jsonl"]').setInputFiles({
    name: 'corrupt.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from(data.replace(/"sha256":"[a-f0-9]+"/g, '"sha256":"bad"')),
  });
  await expect(restored.locator('.library-status')).toContainText('해시 불일치');
  await expect(restored.getByRole('img', { name: '보관한 원본 차트 · 작성자 해석' })).toBeVisible();
  await expect(restored.locator('.library-row')).toHaveCount(1);
  await ctx.close();
});
test('quota failure preserves previous records and can be retried', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(StorageManager.prototype, 'estimate', {
      configurable: true,
      value: async () => ({ usage: 1, quota: 1 }),
    }),
  );
  await page.goto('/workspace/library');
  expect((await page.evaluate(() => navigator.storage.estimate())).quota).toBe(1);
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles([
      {
        name: 'rows.jsonl',
        mimeType: 'application/x-ndjson',
        buffer: Buffer.from(
          JSON.stringify({
            post_id: '111111',
            account: 'fixture',
            text: 'preserve this row',
            images: [{ file: 'chart.png' }],
          }) + '\n',
        ),
      },
      { name: 'chart.png', mimeType: 'image/png', buffer: png },
    ]);
  await expect(page.locator('.library-status')).toContainText('오류 1');
  await expect(page.locator('.library-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.library-row')).toContainText('preserve this row');
});
