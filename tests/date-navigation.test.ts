import { describe, expect, it } from 'vitest';
import {
  availableWindow,
  readDateWindow,
  navigateWindow,
  parseUtcDate,
  selectDateWindow,
} from '../shared/date-navigation';
const day = 86400;
const start = Date.parse('2024-01-01T00:00:00Z') / 1000;
const times = Array.from({ length: 366 }, (_, i) => start + i * day);
describe('UTC chart navigation using actual observations', () => {
  it('restores only finite, ordered, overlapping shared ranges', () => {
    expect(readDateWindow(new URLSearchParams('chart_from=NaN&chart_to=Infinity'))).toBeNull();
    expect(readDateWindow(new URLSearchParams('chart_from=9&chart_to=8'))).toBeNull();
    const range = readDateWindow(
      new URLSearchParams(`chart_from=${times[10]}&chart_to=${times[20]}`),
    );
    expect(availableWindow(times, range)).toEqual({ from: times[10], to: times[20] });
    expect(
      availableWindow(times, { from: times.at(-1)! + day, to: times.at(-1)! + 2 * day }),
    ).toBeNull();
  });
  it('rejects impossible dates and accepts leap days', () => {
    expect(parseUtcDate('2023-02-29')).toBeNull();
    expect(parseUtcDate('2024-02-30')).toBeNull();
    expect(parseUtcDate('2024-02-29')).toBe(start + 59 * day);
  });
  it('centers a useful window and snaps missing days without inventing values', () => {
    const gapped = times.filter((t) => t !== start + 100 * day);
    const result = selectDateWindow(gapped, '2024-04-10');
    expect(result.selected).toBe(start + 99 * day);
    expect(result.range!.from).toBeLessThan(result.selected!);
    expect(result.range!.to).toBeGreaterThan(result.selected!);
    expect(gapped.filter((t) => t >= result.range!.from && t <= result.range!.to)).toHaveLength(90);
  });
  it('rejects unavailable dates, inverted periods and periods without observations', () => {
    expect(selectDateWindow(times, '2025-01-01').error).toBeTruthy();
    expect(selectDateWindow(times, '2024-04-01', '2024-03-01').error).toBeTruthy();
    expect(selectDateWindow(times, '2024-01-01', '2024-01-01').error).toBeTruthy();
    expect(selectDateWindow([], '2024-01-01').error).toBeTruthy();
  });
  it('includes all intraday observations on the ending UTC date', () => {
    const intraday = [start + 3600, start + 86399, start + day, start + day * 2];
    expect(selectDateWindow(intraday, '2024-01-01', '2024-01-01').range).toEqual({
      from: intraday[0],
      to: intraday[1],
    });
    expect(selectDateWindow(intraday, '2024-01-01').selected).toBe(intraday[0]);
  });
  it('zooms and moves a fixed observation window without exceeding actual history', () => {
    const range = { from: times[100], to: times[199] };
    const zoom = navigateWindow(times, range, 'in')!;
    expect((zoom.to - zoom.from) / day + 1).toBe(50);
    const latest = navigateWindow(times, zoom, 'latest')!;
    expect(latest.to).toBe(times.at(-1));
    expect((latest.to - latest.from) / day + 1).toBe(50);
    expect(navigateWindow(times, latest, 'forward')).toEqual(latest);
    expect(navigateWindow(times, { from: times[0], to: times[1] }, 'in')).toEqual({
      from: times[0],
      to: times[1],
    });
  });
});
