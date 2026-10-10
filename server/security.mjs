export const CONTENT_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://pbs.twimg.com; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
export function securityHeaders(headers, { https = false, mode = 'report-only' } = {}) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set(
    mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    CONTENT_POLICY,
  );
  if (https) headers.set('Strict-Transport-Security', 'max-age=31536000');
}
/** Do not trust Host/X-Forwarded-For. Local reverse proxies share a conservative global budget. */
export function requestBudget({ now = Date.now, perClient = 240, global = 3000 } = {}) {
  let window = 0,
    total = 0;
  const clients = new Map();
  return (address) => {
    const minute = Math.floor(now() / 60000);
    if (minute !== window) {
      window = minute;
      total = 0;
      clients.clear();
    }
    const count = (clients.get(address) ?? 0) + 1;
    if (clients.size >= 4096 && !clients.has(address)) return false;
    clients.set(address, count);
    return ++total <= global && count <= perClient;
  };
}
