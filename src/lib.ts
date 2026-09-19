import type { CandleResponse, SeriesResponse } from '../shared/types';
export { periodStart } from '../shared/ranges';
export function priceDigits(value: number, unit = 'USDT'): number {
  const magnitude = Math.abs(value);
  return magnitude === 0
    ? 2
    : magnitude < 0.01
      ? Math.min(12, Math.max(8, 2 - Math.floor(Math.log10(magnitude))))
      : magnitude < 1
        ? 5
        : unit === 'KRW' && magnitude >= 100
          ? 0
          : 2;
}
export function money(value: number | null | undefined, unit = 'USDT'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = priceDigits(value, unit);
  return (
    (unit === 'KRW' ? '₩' : '$') +
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  );
}
export function numeric(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : new Intl.NumberFormat('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(v);
}
export function metricValue(v: number | null | undefined, unit: string) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return unit === 'USD'
    ? money(v)
    : unit === '비율'
      ? v === null || v === undefined
        ? '—'
        : numeric(v * 100) + '%'
      : numeric(v) + (unit === '배' ? '×' : '');
}
export function dateLabel(t: number | null | undefined, withTime = false) {
  if (!t) return '데이터 대기';
  return (
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(new Date(t * 1000)) + (withTime ? ' KST' : '')
  );
}
export function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem('btc-desk.v1.' + key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem('btc-desk.v1.' + key, JSON.stringify(value));
    return true;
  } catch {
    window.dispatchEvent(new Event('coin-desk-storage-error'));
    return false;
  }
}
export async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.headers.get('content-type')?.includes('application/json')) {
      throw new Error(
        r.status === 429
          ? '요청이 많습니다. 잠시 후 다시 확인해 주세요.'
          : '데이터 서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
    let data: { error?: string } | null;
    try {
      data = (await r.json()) as { error?: string } | null;
    } catch (error) {
      // Preserve caller/timeout cancellation while hiding parser fragments from bad proxies.
      if (controller.signal.aborted) throw error;
      throw new Error('데이터 서버의 JSON 응답이 손상되었습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (!r.ok)
      throw new Error(
        typeof data?.error === 'string'
          ? data.error.slice(0, 250)
          : '데이터를 불러오지 못했습니다.',
      );
    if (!data || typeof data !== 'object') throw new Error('올바른 데이터 응답이 아닙니다.');
    return data as T;
  } catch (e) {
    if (timedOut) throw new Error('응답이 20초를 넘었습니다. 다시 시도해 주세요.');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function pages<T extends CandleResponse | SeriesResponse>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  // After discovering the first cursor, fetch bounded date windows concurrently.
  // This keeps the initial price chart from waiting on every page serially.
  const base = new URL(url, 'https://btc-desk.invalid');
  const first = await json<T>(url, signal);
  if (first.nextCursor === null) return first;
  const interval = base.searchParams.get('interval') || '1d';
  const span = (interval === '1h' || interval === '4h' ? 3600 : 86400) * 900;
  const end = Number(base.searchParams.get('to') || Math.floor(Date.now() / 1000) + 86400);
  const windows: string[] = [];
  for (let start = first.nextCursor; start < end; start += span) {
    if (windows.length >= 40) throw new Error('조회 가능한 데이터 범위를 초과했습니다.');
    const part = new URL(base);
    part.searchParams.set('from', String(start));
    part.searchParams.set('to', String(Math.min(start + span, end)));
    windows.push(part.pathname + part.search);
  }
  for (let i = 0; i < windows.length; i += 4) {
    const chunks = await Promise.all(
      windows.slice(i, i + 4).map((part) => sequentialPages<T>(part, signal)),
    );
    for (const page of chunks) {
      first.data.push(...(page.data as never[]));
      if ('price' in first && 'price' in page) first.price.push(...page.price);
      first.meta.stale ||= page.meta.stale;
      first.meta.gapCount = (first.meta.gapCount || 0) + (page.meta.gapCount || 0);
    }
  }
  // Calendar aggregation windows may overlap one week/month; keep the fuller bar.
  first.data = [...new Map(first.data.map((point) => [point.time, point])).values()].sort(
    (a, b) => a.time - b.time,
  ) as T['data'];
  if ('price' in first)
    first.price = [...new Map(first.price.map((point) => [point.time, point])).values()].sort(
      (a, b) => a.time - b.time,
    );
  first.nextCursor = null;
  return first;
}
async function sequentialPages<T extends CandleResponse | SeriesResponse>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  let result: T | undefined;
  let cursor = 0;
  for (let i = 0; i < 40; i++) {
    const pageUrl = new URL(url, 'https://btc-desk.invalid');
    if (cursor) pageUrl.searchParams.set('from', String(cursor));
    const page = await json<T>(pageUrl.pathname + pageUrl.search, signal);
    if (!result) result = page;
    else {
      result.data.push(...(page.data as never[]));
      if ('price' in result && 'price' in page) result.price.push(...page.price);
      result.meta.stale ||= page.meta.stale;
      result.meta.gapCount = (result.meta.gapCount || 0) + (page.meta.gapCount || 0);
    }
    if (page.nextCursor === null) {
      result.nextCursor = null;
      return result;
    }
    if (page.nextCursor <= cursor) throw new Error('데이터 페이지가 진행되지 않았습니다.');
    cursor = page.nextCursor;
  }
  throw new Error('조회 가능한 데이터 범위를 초과했습니다.');
}
