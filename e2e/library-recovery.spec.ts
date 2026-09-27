import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const png = readFileSync('public/brand/favicon-32.png');

test('Chrome image transfer resumes after reload and still rejects unreferenced media', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.bridgeNonce = null;
    w.bridgeAcks = {};
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type === 'CD_LIBRARY_HELLO') w.bridgeNonce = event.data.nonce;
      if (event.data?.type === 'CD_LIBRARY_ACK') w.bridgeAcks[event.data.sequence] = event.data;
    });
  });
  const connect = async () => {
    await page.getByRole('button', { name: 'Chrome 연결', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).bridgeNonce)).toBeTruthy();
  };
  const send = async (sequence: number, payload: Record<string, unknown>) => {
    await page.evaluate(
      ({ sequence, payload }) => {
        window.postMessage(
          { ...payload, sequence, nonce: (window as any).bridgeNonce },
          location.origin,
        );
      },
      { sequence, payload },
    );
    await expect
      .poll(() => page.evaluate((n) => (window as any).bridgeAcks[n], sequence))
      .toBeTruthy();
    return page.evaluate((n) => (window as any).bridgeAcks[n], sequence);
  };
  await page.goto('/workspace/library');
  await connect();
  expect(
    await send(0, {
      type: 'CD_LIBRARY_CHUNK',
      rows: [
        {
          post_id: '778899',
          account: 'fixture',
          text: 'BTC resumable image',
          images: [{ url: 'https://pbs.twimg.com/media/fixture.png' }],
        },
      ],
    }),
  ).not.toHaveProperty('error');
  const image = {
    type: 'CD_LIBRARY_MEDIA',
    key: 'x:778899:0',
    mime: 'image/png',
    total: png.length,
    offset: 0,
  };
  expect(
    await send(1, { ...image, data: png.subarray(0, 10).toString('base64') }),
  ).not.toHaveProperty('error');
  await page.reload();
  await connect();
  expect(
    await send(0, { ...image, key: 'x:unknown:0', data: png.toString('base64') }),
  ).toHaveProperty('error');
  expect(await send(1, { ...image, data: png.toString('base64') })).not.toHaveProperty('error');
  expect(await send(2, { type: 'CD_LIBRARY_DONE', failed: 0 })).not.toHaveProperty('error');
  await expect(page.locator('.library-row')).toHaveCount(1);
  await page.locator('.library-row').click();
  await expect(page.getByRole('img', { name: '보관한 원본 차트 · 작성자 해석' })).toBeVisible();
  await page.reload();
  await page.locator('.library-row').click();
  await expect(page.getByRole('img', { name: '보관한 원본 차트 · 작성자 해석' })).toBeVisible();
});
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
