export interface DateWindow {
  from: number;
  to: number;
}
export function readDateWindow(params: URLSearchParams): DateWindow | null {
  const from = Number(params.get('chart_from')),
    to = Number(params.get('chart_to'));
  return params.has('chart_from') &&
    params.has('chart_to') &&
    Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    from > 0 &&
    to > from &&
    to < 8640000000000
    ? { from, to }
    : null;
}
export function availableWindow(
  times: number[],
  range: DateWindow | null | undefined,
): DateWindow | null {
  if (!range) return null;
  const selected = times.filter((t) => t >= range.from && t <= range.to);
  return selected.length >= 2 ? { from: selected[0], to: selected[selected.length - 1] } : null;
}
export const utcDate = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);

export function parseUtcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z') / 1000;
  return Number.isFinite(time) && utcDate(time) === value ? time : null;
}

/** Sorted actual observations only. Ties resolve to the earlier observation. */
export function nearestDateIndex(times: number[], target: number): number {
  if (!times.length) return -1;
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  if (lo === times.length) return lo - 1;
  return target - times[lo - 1] <= times[lo] - target ? lo - 1 : lo;
}

export function observationWindow(
  times: number[],
  center: number,
  count: number,
): DateWindow | null {
  if (times.length < 2) return null;
  const size = Math.min(times.length, Math.max(2, Math.round(count)));
  const start = Math.max(0, Math.min(times.length - size, Math.round(center - (size - 1) / 2)));
  return { from: times[start], to: times[start + size - 1] };
}

export function navigateWindow(
  times: number[],
  current: DateWindow,
  action: 'in' | 'out' | 'back' | 'forward' | 'latest',
) {
  const first = nearestDateIndex(times, current.from),
    last = nearestDateIndex(times, current.to);
  const count = Math.max(2, last - first + 1),
    center = (first + last) / 2;
  if (action === 'in' || action === 'out')
    return observationWindow(times, center, count * (action === 'in' ? 0.5 : 2));
  if (action === 'latest') return observationWindow(times, times.length - 1, count);
  return observationWindow(
    times,
    center + (action === 'back' ? -1 : 1) * Math.max(1, Math.floor(count * 0.7)),
    count,
  );
}

export function selectDateWindow(
  times: number[],
  start: string,
  end?: string,
): { range?: DateWindow; selected?: number; error?: string } {
  const from = parseUtcDate(start),
    to = end === undefined ? null : parseUtcDate(end);
  if (from === null || (end !== undefined && to === null))
    return { error: '올바른 날짜를 입력해 주세요.' };
  if (!times.length) return { error: '확보한 관측이 없습니다.' };
  if (end === undefined) {
    if (from + 86400 <= times[0] || from > times[times.length - 1])
      return { error: '확보한 데이터 기간 안에서 선택해 주세요.' };
    const index = nearestDateIndex(times, from);
    // At most 90 observations; preserve gaps instead of inventing a daily value.
    return { range: observationWindow(times, index, 90) ?? undefined, selected: times[index] };
  }
  if (to! < from) return { error: '종료일은 시작일보다 빠를 수 없습니다.' };
  const selected = times.filter((t) => t >= from && t < to! + 86400);
  if (selected.length < 2) return { error: '실제 관측이 2개 이상 있는 기간을 선택해 주세요.' };
  return { range: { from: selected[0], to: selected[selected.length - 1] }, selected: selected[0] };
}
