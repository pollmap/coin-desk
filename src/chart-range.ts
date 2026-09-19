export function kstInputDate(time: number): string {
  return new Date((time + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

/** Zooming a one-observation selection must never zoom outward when '+' is pressed. */
export function zoomChartRange(
  range: { from: number; to: number },
  factor: number,
): { from: number; to: number } | null {
  if (
    ![range.from, range.to, factor].every(Number.isFinite) ||
    factor <= 0 ||
    range.from > range.to
  )
    return null;
  const center = (range.from + range.to) / 2;
  const previousHalf = (range.to - range.from) / 2;
  const half = Math.max(0.5, previousHalf * factor);
  if (factor < 1 && half >= previousHalf) return null;
  return { from: center - half, to: center + half };
}

function kstDayStart(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00+09:00') / 1000;
  return Number.isFinite(time) && kstInputDate(time) === value ? time : null;
}

export interface ChartDateSelection {
  firstIndex: number;
  lastIndex: number;
  from: number;
  to: number;
  count: number;
  clipped: boolean;
}

/** Selects real observations by their KST start date, with an inclusive end date. */
export function selectChartDates(
  rows: ReadonlyArray<{ time: number }>,
  startDate: string,
  endDate: string,
): { selection?: ChartDateSelection; error?: string } {
  const start = kstDayStart(startDate);
  const endDay = kstDayStart(endDate);
  if (start === null || endDay === null)
    return { error: '시작일과 종료일을 올바른 날짜로 입력하세요.' };
  if (start > endDay) return { error: '종료일은 시작일과 같거나 이후여야 합니다.' };
  if (!rows.length) return { error: '아직 선택할 실제 관측 데이터가 없습니다.' };
  const lower = (time: number) => {
    let lo = 0,
      hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const firstIndex = lower(start);
  const lastIndex = lower(endDay + 86400) - 1;
  if (firstIndex > lastIndex)
    return { error: '이 날짜 구간에는 실제 관측이 없습니다. 아래 제공 기간을 확인하세요.' };
  return {
    selection: {
      firstIndex,
      lastIndex,
      from: rows[firstIndex].time,
      to: rows[lastIndex].time,
      count: lastIndex - firstIndex + 1,
      clipped: startDate < kstInputDate(rows[0].time) || endDate > kstInputDate(rows.at(-1)!.time),
    },
  };
}
