import { expect, it } from 'vitest';
// The packaged extension runs the same pure protocol checks.
// @ts-expect-error JavaScript MV3 module has no external TypeScript declaration.
import { allowedSite, allowedSource, validNonce, mediaUrl } from '../extension/protocol.js';
it('binds only the public/local library route and rejects lookalike origins', () => {
  expect(allowedSite('https://coin-desk.pages.dev/workspace/library')).toBe(true);
  expect(allowedSite('http://127.0.0.1:5173/workspace/library')).toBe(true);
  for (const u of [
    'https://coin-desk.pages.dev.evil.com/workspace/library',
    'https://evil.com',
    'https://coin-desk.pages.dev/coins',
    'https://coin-desk.pages.dev@evil.com/workspace/library',
  ])
    expect(allowedSite(u)).toBe(false);
});
it('never accepts private messages/settings or non-X collection', () => {
  expect(allowedSource('https://x.com/i/history')).toBe(false);
  expect(allowedSource('https://x.com/i/history', 'account')).toBe(false);
  expect(allowedSource('https://x.com/i/history', 'bookmarks')).toBe(true);
  for (const u of [
    'https://x.com/i/bookmarks',
    'https://x.com/i/lists/123/members',
    'https://x.com/token_night',
    'https://x.com/user/status/123',
  ])
    expect(allowedSource(u)).toBe(true);
  for (const u of [
    'https://x.com/messages',
    'https://x.com/settings',
    'https://x.com/i/api/graphql',
    'https://evil.com/user',
    'javascript:alert(1)',
  ])
    expect(allowedSource(u)).toBe(false);
  expect(mediaUrl('https://pbs.twimg.com/media/a.jpg')).toBeTruthy();
  expect(mediaUrl('https://pbs.twimg.com/profile_images/a.jpg')).toBeNull();
  expect(validNonce('not-a-nonce')).toBe(false);
});
