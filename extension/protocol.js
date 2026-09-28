export function allowedSite(url) {
  try {
    const u = new URL(url);
    return (
      (u.origin === 'https://coin-desk.pages.dev' ||
        (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) &&
      u.pathname === '/workspace/library'
    );
  } catch {
    return false;
  }
}
export function allowedSource(url, mode) {
  try {
    const u = new URL(url);
    return (
      u.origin === 'https://x.com' &&
      ((/^\/[A-Za-z0-9_]{1,15}(?:\/status\/\d+|\/with_replies)?\/?$/.test(u.pathname) &&
        !/^\/(messages|settings|compose|login|logout|home|notifications)\b/.test(u.pathname)) ||
        /^\/i\/(bookmarks|lists\/\d+(?:\/members)?)\/?$/.test(u.pathname) ||
        (mode === 'bookmarks' && /^\/i\/history\/?$/.test(u.pathname)))
    );
  } catch {
    return false;
  }
}
export function validNonce(n) {
  return typeof n === 'string' && /^[a-f0-9-]{36}$/.test(n);
}
export function mediaUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === 'https://pbs.twimg.com' && u.pathname.startsWith('/media/') ? u.href : null;
  } catch {
    return null;
  }
}
