import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('extension current-post reader captures only visible target text and public chart URLs', async ({
  page,
}) => {
  await page.route('https://x.com/**', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<main><article><a href="/fixture/status/123"><time datetime="2025-01-01T00:00:00Z"></time></a><div data-testid="tweetText">BTC visible</div><button data-testid="tweet-text-show-more-link">더 보기</button><img src="https://pbs.twimg.com/media/fixture.png"></article><article><a href="/other/status/456"><time></time></a><div data-testid="tweetText">unrelated reply</div></article></main>',
    }),
  );
  await page.route('https://pbs.twimg.com/**', (r) => r.abort());
  await page.goto('https://x.com/fixture/status/123');
  await page.evaluate(() => {
    const w = window as any;
    w.testMessages = [];
    w.chrome = {
      runtime: {
        id: 'fixture-extension',
        onMessage: {
          addListener: (cb: unknown) => {
            w.testListener = cb;
          },
        },
        sendMessage: async (m: unknown) => {
          w.testMessages.push(m);
          return { ok: true };
        },
      },
    };
  });
  await page.addScriptTag({ content: await readFile('extension/x-reader.js', 'utf8') });
  await page.evaluate(() => {
    const w = window as any;
    w.testListener({ type: 'START', mode: 'post' }, { id: 'fixture-extension' }, () => {});
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).testMessages.some((m: any) => m.type === 'DONE')),
    )
    .toBe(true);
  const messages = await page.evaluate(() => (window as any).testMessages);
  const rows = messages.filter((m: any) => m.type === 'ROWS').flatMap((m: any) => m.rows);
  expect(rows).toHaveLength(1);
  expect(rows[0].post_id).toBe('123');
  expect(rows[0].text).toBe('BTC visible');
  expect(rows[0].text_truncated).toBe(true);
  expect(rows[0].images[0].url).toContain('pbs.twimg.com/media/');
  expect(rows[0].images).toHaveLength(1);
  expect(Object.keys(rows[0]).join(' ')).not.toMatch(/cookie|token|password/);
});

test('X history redirect only reads the selected bookmarks tab and keeps quoted media separate', async ({
  page,
}) => {
  await page.route('https://x.com/**', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<meta charset="utf-8"><main><div role="tab" aria-selected="true">북마크</div><article><a href="/fixture/status/123"><time></time></a><div data-testid="tweetText">BTC parent</div><img src="https://pbs.twimg.com/media/parent.png"><div role="link"><a href="/quoted/status/456"><time></time></a><div data-testid="tweetText">DOGE quoted</div><img src="https://pbs.twimg.com/media/quote.png"></div></article></main>',
    }),
  );
  await page.route('https://pbs.twimg.com/**', (r) => r.abort());
  await page.goto('https://x.com/i/history');
  await page.evaluate(() => {
    const w = window as any;
    w.testMessages = [];
    w.chrome = {
      runtime: {
        id: 'fixture',
        onMessage: { addListener: (fn: unknown) => (w.runReader = fn) },
        sendMessage: async (m: any) => {
          w.testMessages.push(m);
          if (m.type === 'ROWS') w.runReader({ type: 'STOP' }, { id: 'fixture' }, () => {});
          return { ok: true };
        },
      },
    };
  });
  await page.addScriptTag({ content: await readFile('extension/x-reader.js', 'utf8') });
  await page.evaluate(() =>
    (window as any).runReader({ type: 'START', mode: 'bookmarks' }, { id: 'fixture' }, () => {}),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).testMessages.some((m: any) => m.type === 'DONE')),
    )
    .toBe(true);
  const rows = await page.evaluate(() =>
    (window as any).testMessages.filter((m: any) => m.type === 'ROWS').flatMap((m: any) => m.rows),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe('BTC parent');
  expect(rows[0].images).toEqual([{ url: 'https://pbs.twimg.com/media/parent.png' }]);
  await page.evaluate(() => {
    document.querySelector('[role="tab"]')!.textContent = '마음에 들어요';
    (window as any).testMessages = [];
    (window as any).runReader({ type: 'START', mode: 'bookmarks' }, { id: 'fixture' }, () => {});
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).testMessages.find((m: any) => m.type === 'DONE')?.status),
    )
    .toBe('failed');
  expect(
    await page.evaluate(() => (window as any).testMessages.some((m: any) => m.type === 'ROWS')),
  ).toBe(false);
});
test('extension bridge binds one library page, acknowledges persisted chunks and rejects a wrong nonce', async ({
  page,
}) => {
  await page.goto('/workspace/library');
  await page.evaluate(() => {
    const w = window as any;
    w.testBound = null;
    w.chrome = {
      runtime: {
        id: 'fixture-extension',
        onMessage: {
          addListener: (cb: unknown) => {
            w.testTransfer = cb;
          },
        },
        sendMessage: async (m: unknown) => {
          w.testBound = m;
          return { ok: true };
        },
      },
    };
  });
  await page.addScriptTag({ content: await readFile('extension/site-bridge.js', 'utf8') });
  await page.getByRole('button', { name: 'Chrome 연결', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testBound?.nonce)).toBeTruthy();
  await expect(page.locator('.library-status')).toContainText('Chrome 연결 확인');
  const result = await page.evaluate(async () => {
    const w = window as any;
    return await new Promise((resolve) =>
      w.testTransfer(
        {
          type: 'TRANSFER',
          nonce: w.testBound.nonce,
          sequence: 0,
          rows: [{ post_id: '456789', account: 'fixture', text: 'ETH verified bridge' }],
        },
        { id: 'fixture-extension' },
        resolve,
      ),
    );
  });
  expect(result).toEqual({ ok: true });
  await expect(page.locator('.library-row')).toContainText('ETH verified bridge');
  const rejected = await page.evaluate(async () => {
    const w = window as any;
    return await new Promise((resolve) =>
      w.testTransfer(
        { type: 'TRANSFER', nonce: 'wrong', sequence: 1, rows: [] },
        { id: 'fixture-extension' },
        resolve,
      ),
    );
  });
  expect(rejected).toHaveProperty('error');
  await page.evaluate(async () => {
    const w = window as any;
    await new Promise((resolve) =>
      w.testTransfer(
        { type: 'TRANSFER_DONE', nonce: w.testBound.nonce, sequence: 2, images: 0, failed: 0 },
        { id: 'fixture-extension' },
        resolve,
      ),
    );
  });
  await page.reload();
  await expect(page.locator('.library-row')).toHaveCount(1);
});
