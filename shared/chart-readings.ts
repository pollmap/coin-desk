import type { Point } from './types';

export interface ReadingColumn {
  title: string;
  unit: string;
  source: string;
  data: readonly Point[];
}

export function readingDigits(value: number | undefined) {
  const magnitude = Math.abs(value ?? 0);
  return magnitude === 0 || magnitude >= 0.1
    ? 2
    : Math.min(12, Math.max(6, 2 - Math.floor(Math.log10(magnitude))));
}

/** Exact timestamps only: no carry-forward or interpolation across missing observations. */
export function readingIndex(columns: readonly ReadingColumn[]) {
  const maps = columns.map(
    (c) => new Map(c.data.filter((p) => Number.isFinite(p.value)).map((p) => [p.time, p.value])),
  );
  const times = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  return { times, maps };
}

export function adjacentObservation(
  times: readonly number[],
  time: number | null,
  direction: -1 | 1,
) {
  if (!times.length) return null;
  if (time === null) return direction < 0 ? times.at(-1)! : times[0];
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const index = direction < 0 ? lo - 1 : lo + (times[lo] === time ? 1 : 0);
  return times[Math.max(0, Math.min(times.length - 1, index))];
}

export function readingsCsv(
  columns: readonly ReadingColumn[],
  range?: { from: number; to: number },
) {
  const { times, maps } = readingIndex(columns);
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  return (
    '\uFEFF' +
    [
      ['date_utc', ...columns.map((c) => quote(`관측: ${c.title} · ${c.unit} · ${c.source}`))].join(
        ',',
      ),
      ...times
        .filter((t) => !range || (t >= range.from && t <= range.to))
        .map((t) =>
          [new Date(t * 1000).toISOString(), ...maps.map((m) => m.get(t) ?? '')].join(','),
        ),
    ].join('\r\n')
  );
}
