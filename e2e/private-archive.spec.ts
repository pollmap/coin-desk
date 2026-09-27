/** Opt-in local data check. Never runs against personal archives in public CI. */
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
test('local archive folder imports full metadata and image references without publishing them', async ({
  page,
}) => {
  const root = process.env.COIN_DESK_PRIVATE_IMPORT_DIR;
  test.skip(!root, 'Local private archive explicitly supplied only');
  test.setTimeout(600000);
  await page.goto('/workspace/library');
  await page.locator('input[webkitdirectory]').setInputFiles(resolve(root!));
  await expect(page.locator('.library-heading')).toContainText('6,248건', { timeout: 540000 });
  await expect(page.locator('.library-status')).toContainText('오류 0');
  await expect(page.locator('.library-status')).toContainText('이미지 보관 4408');
  await expect(page.locator('.library-status')).toContainText('미연결 0');
  const start = Date.now();
  await page.getByRole('searchbox', { name: '개인 자료 검색' }).fill('BTC');
  await expect(page.locator('.library-row').first()).toBeVisible();
  expect(Date.now() - start).toBeLessThan(5000);
  expect(await page.locator('.library-row').count()).toBeLessThanOrEqual(15);
  await page.reload();
  await expect(page.locator('.library-heading')).toContainText('6,248건');
});
