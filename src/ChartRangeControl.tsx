import { useEffect, useState } from 'react';
import { dateLabel } from './lib';
import { kstInputDate, selectChartDates, type ChartDateSelection } from './chart-range';

export function ChartRangeControl({
  rows,
  resetKey,
  onApply,
  onReset,
  hourly = false,
}: {
  rows: ReadonlyArray<{ time: number }>;
  resetKey: string;
  onApply: (selection: ChartDateSelection) => void;
  onReset: () => void;
  hourly?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    setMessage('');
    setError('');
    setApplied(false);
  }, [resetKey]);
  const first = rows[0]?.time;
  const last = rows.at(-1)?.time;
  return (
    <details className="chart-range-editor">
      <summary>
        날짜 범위 직접 선택 {applied ? <span className="range-applied">직접 선택 기준</span> : null}
      </summary>
      <p className="range-availability">
        제공 기간 {first === undefined ? '데이터 대기' : `${dateLabel(first)} ~ ${dateLabel(last)}`}{' '}
        · {rows.length.toLocaleString()}개 실제 관측{hourly ? ' · 시간봉은 최근 90일' : ''}
      </p>
      <form
        key={resetKey}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const start = String(fields.get('start') || '');
          const end = String(fields.get('end') || '');
          const result = selectChartDates(rows, start, end);
          if (!result.selection) {
            setError(result.error || '선택할 구간이 없습니다.');
            return;
          }
          onApply(result.selection);
          setApplied(true);
          setError('');
          setMessage(
            `${dateLabel(result.selection.from)} ~ ${dateLabel(result.selection.to)} · ${result.selection.count.toLocaleString()}개 실제 관측${result.selection.clipped ? ' · 제공 기간과 겹치는 부분만 적용했습니다.' : ''}`,
          );
        }}
      >
        <label>
          시작일 (KST)
          <input
            type="date"
            name="start"
            min={first === undefined ? undefined : kstInputDate(first)}
            max={last === undefined ? undefined : kstInputDate(last)}
            required
          />
        </label>
        <label>
          종료일 (KST)
          <input
            type="date"
            name="end"
            min={first === undefined ? undefined : kstInputDate(first)}
            max={last === undefined ? undefined : kstInputDate(last)}
            required
          />
        </label>
        <button type="submit" disabled={!rows.length}>
          선택 기간 적용
        </button>
        <button
          type="button"
          disabled={!rows.length}
          onClick={(event) => {
            event.currentTarget.form?.reset();
            onReset();
            setError('');
            setApplied(false);
            setMessage('수집된 전체 이력으로 맞췄습니다.');
          }}
        >
          전체 이력 보기
        </button>
      </form>
      {error ? (
        <p role="alert" className="range-error">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="range-result">
          마지막 적용: {message}
        </p>
      ) : null}
      <p className="range-note">
        날짜는 관측·봉 시작 시각의 KST 날짜입니다. 주·월봉도 시작일로 선택합니다. 상단 기간을 바꾸면
        직접 선택이 해제됩니다.
      </p>
    </details>
  );
}
