/** The formatter and the scale must use the same smallest displayed increment. */
export function chartPrecision(values: readonly number[], digits: (value: number) => number) {
  let precision = 0;
  for (const value of values) {
    if (Number.isFinite(value)) precision = Math.max(precision, digits(value));
  }
  precision = Math.min(12, Math.max(0, precision));
  return { precision, minMove: 10 ** -precision };
}

/** Keep one mobile pane clear of fixed navigation; scrolling never changes its height. */
export function mobileChartHeight(viewportHeight: number, documentTop: number, navigation: number) {
  return Math.max(240, Math.min(330, Math.floor(viewportHeight - documentTop - navigation - 8)));
}

export interface InspectionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const kstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function chartDate(time: number, intraday = false) {
  const parts = kstFormatter.formatToParts(new Date(time * 1000));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return (
    `${value('year')}-${value('month')}-${value('day')}` +
    (intraday ? ` ${value('hour')}:${value('minute')}` : '')
  );
}

export function chartTick(time: number, type: number) {
  const formatted = chartDate(time, true);
  if (type === 0) return formatted.slice(0, 4);
  if (type === 1) return formatted.slice(0, 7);
  if (type === 2) return formatted.slice(5, 10);
  return formatted.slice(11);
}

/** Position within the plot and on-screen area, never on either axis or under a finger. */
export function inspectionPosition(
  point: { x: number; y: number },
  bounds: InspectionBounds,
  size: { width: number; height: number },
  touch: boolean,
) {
  const padding = 6;
  const width = Math.min(size.width, Math.max(1, bounds.width - 2 * padding));
  const height = Math.min(size.height, Math.max(1, bounds.height - 2 * padding));
  let left = point.x + 14;
  if (left + width > bounds.left + bounds.width - padding) left = point.x - width - 14;
  let top = point.y - height - (touch ? 32 : 14);
  if (!touch && top < bounds.top + padding) top = point.y + 14;
  return {
    left: Math.max(
      bounds.left + padding,
      Math.min(left, bounds.left + bounds.width - width - padding),
    ),
    top: Math.max(
      bounds.top + padding,
      Math.min(top, bounds.top + bounds.height - height - padding),
    ),
    maxWidth: Math.max(1, bounds.width - 2 * padding),
  };
}

export function logicalRangeChanged(
  before: { from: number; to: number } | null,
  after: { from: number; to: number } | null,
) {
  return (
    !!before &&
    !!after &&
    (Math.abs(before.from - after.from) > 1e-6 || Math.abs(before.to - after.to) > 1e-6)
  );
}

export interface LogicalViewAnchor {
  time: number;
  offset: number;
  width: number;
}

/** Pan by bars, not calendar time: boundary clamping must never zoom the chart. */
export function boundedLogicalPan(
  range: { from: number; to: number },
  target: number,
  first: number,
  last: number,
) {
  const width = range.to - range.from;
  if (
    ![range.from, range.to, target, first, last].every(Number.isFinite) ||
    width <= 0 ||
    last < first
  )
    return null;
  const from =
    width <= last - first
      ? Math.max(first, Math.min(last - width, target - width / 2))
      : target <= (first + last) / 2
        ? first
        : last - width;
  return { from, to: from + width };
}

/** The stable observation anchor can move to another index after a prepend or correction. */
export function restoreLogicalView(anchor: LogicalViewAnchor, currentAnchorIndex: number) {
  return {
    from: currentAnchorIndex + anchor.offset,
    to: currentAnchorIndex + anchor.offset + anchor.width,
  };
}
