import { describe, expect, it } from 'vitest';
import { kstInputDate, selectChartDates, zoomChartRange } from '../src/chart-range';
const t = (date: string) => Date.parse(date) / 1000;

describe('exact chart date controls', () => {
  it('zooming in never widens an already tiny or single-observation selection', () => {
    expect(zoomChartRange({ from: 5, to: 5 }, 0.7)).toBeNull();
    expect(zoomChartRange({ from: 5, to: 5.5 }, 0.7)).toBeNull();
    expect(zoomChartRange({ from: 0, to: 10 }, 0.5)).toEqual({ from: 2.5, to: 7.5 });
  });
  it('zooming out can leave a single-observation selection and rejects invalid coordinates', () => {
    expect(zoomChartRange({ from: 5, to: 5 }, 1.4)).toEqual({ from: 4.5, to: 5.5 });
    expect(zoomChartRange({ from: NaN, to: 10 }, 2)).toBeNull();
    expect(zoomChartRange({ from: 10, to: 5 }, 2)).toBeNull();
  });
  const rows = [
    { time: t('2024-02-28T15:00:00Z') },
    { time: t('2024-02-29T14:59:59Z') },
    { time: t('2024-02-29T15:00:00Z') },
    { time: t('2024-03-03T00:00:00Z') },
  ];
  it('uses KST dates and includes both ends of a selected leap day', () => {
    expect(kstInputDate(rows[0].time)).toBe('2024-02-29');
    expect(selectChartDates(rows, '2024-02-29', '2024-02-29').selection).toEqual({
      firstIndex: 0,
      lastIndex: 1,
      from: rows[0].time,
      to: rows[1].time,
      count: 2,
      clipped: false,
    });
  });
  it('reports a gap rather than selecting or interpolating adjacent dates', () => {
    expect(selectChartDates(rows, '2024-03-02', '2024-03-02').error).toContain(
      '실제 관측이 없습니다',
    );
  });
  it('accepts a single observation without inventing a second point', () => {
    const result = selectChartDates(rows, '2024-03-03', '2024-03-03').selection;
    expect(result?.count).toBe(1);
    expect(result?.from).toBe(result?.to);
  });
  it('clips a wider request to real observations and states that it clipped', () => {
    const selection = selectChartDates(rows, '2020-01-01', '2030-01-01').selection;
    expect(selection).toMatchObject({
      from: rows[0].time,
      to: rows.at(-1)!.time,
      count: 4,
      clipped: true,
    });
  });
  it('rejects nonexistent dates, reverse order, missing values and empty data', () => {
    expect(selectChartDates(rows, '2023-02-29', '2024-03-01').error).toContain('올바른 날짜');
    expect(selectChartDates(rows, '2024-03-01', '2024-02-29').error).toContain('종료일');
    expect(selectChartDates(rows, '', '').error).toContain('올바른 날짜');
    expect(selectChartDates([], '2024-01-01', '2024-01-02').error).toContain('실제 관측 데이터');
  });
  it('selects a weekly or monthly bar by its start date, not its closing date', () => {
    const months = [{ time: t('2024-01-01T00:00:00Z') }, { time: t('2024-02-01T00:00:00Z') }];
    expect(selectChartDates(months, '2024-01-15', '2024-01-31').error).toContain(
      '실제 관측이 없습니다',
    );
    expect(selectChartDates(months, '2024-02-01', '2024-02-29').selection?.count).toBe(1);
  });
});
