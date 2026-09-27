import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import {
  navigateWindow,
  selectDateWindow,
  utcDate,
  type DateWindow,
} from '../shared/date-navigation';
import './date-navigator.css';

export function DateNavigator({
  times,
  visible,
  selected,
  onRange,
  onSelect,
  onReset,
}: {
  times: number[];
  visible: DateWindow | null;
  selected?: number;
  onRange: (range: DateWindow) => void;
  onSelect: (time: number) => void;
  onReset: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [mode, setMode] = useState<'date' | 'range'>('date');
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const current =
    visible ?? (times.length ? { from: times[0], to: times[times.length - 1] } : null);
  const enabled = times.length >= 2 && current !== null;
  function open() {
    if (!enabled) return;
    setStart(utcDate(selected ?? current.to));
    setEnd(utcDate(current.to));
    setError('');
    setMode('date');
    dialog.current?.showModal();
    dateInput.current?.focus();
  }
  function close() {
    dialog.current?.close();
    opener.current?.focus();
  }
  function navigate(action: Parameters<typeof navigateWindow>[2]) {
    if (!current) return;
    const next = navigateWindow(times, current, action);
    if (action === 'latest') onSelect(times[times.length - 1]);
    if (next) onRange(next);
    setNotice('');
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === 'g' &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        opener.current?.click();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  return (
    <div className="date-navigation">
      <div className="date-navigation-actions" role="group" aria-label="차트 날짜 탐색">
        <button
          ref={opener}
          className="date-jump"
          disabled={!enabled}
          onClick={open}
          title="날짜로 이동 (Alt+G)"
          aria-keyshortcuts="Alt+G"
        >
          <CalendarDays size={16} />
          날짜로 이동
        </button>
        <div className="date-navigation-step">
          <button
            disabled={!enabled || current.from <= times[0]}
            onClick={() => navigate('back')}
            aria-label="이전 구간"
            title="이전 구간"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            disabled={!enabled || current.to >= times[times.length - 1]}
            onClick={() => navigate('forward')}
            aria-label="다음 구간"
            title="다음 구간"
          >
            <ChevronRight size={18} />
          </button>
          <button
            disabled={!enabled}
            onClick={() => navigate('in')}
            aria-label="차트 확대"
            title="확대"
          >
            <Plus size={18} />
          </button>
          <button
            disabled={!enabled}
            onClick={() => navigate('out')}
            aria-label="차트 축소"
            title="축소"
          >
            <Minus size={18} />
          </button>
        </div>
        <button
          disabled={!enabled}
          onClick={() => {
            onReset();
            setNotice('');
          }}
        >
          전체 보기
        </button>
        <button disabled={!enabled} onClick={() => navigate('latest')}>
          최신 구간
        </button>
      </div>
      <div className="date-navigation-caption">
        <span aria-label="표시 기간">
          {current ? `${utcDate(current.from)} — ${utcDate(current.to)} · UTC` : '관측 대기'}
        </span>
        <span role="status">{notice}</span>
      </div>
      <dialog
        ref={dialog}
        className="date-dialog"
        aria-labelledby={id}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => opener.current?.focus()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const result = selectDateWindow(
              times,
              String(form.get('start') ?? ''),
              mode === 'range' ? String(form.get('end') ?? '') : undefined,
            );
            if (result.error) {
              setError(result.error);
              return;
            }
            if (result.selected !== undefined) onSelect(result.selected);
            if (result.range) onRange(result.range);
            setNotice(
              mode === 'date' ? `${utcDate(result.selected!)} 관측 선택` : '선택 기간 표시',
            );
            close();
          }}
        >
          <div className="date-dialog-heading">
            <h2 id={id}>차트 날짜 탐색</h2>
            <button type="button" onClick={close} aria-label="날짜 탐색 닫기">
              <X size={20} />
            </button>
          </div>
          <div className="date-dialog-modes" role="group" aria-label="날짜 선택 방식">
            <button
              type="button"
              aria-pressed={mode === 'date'}
              onClick={() => {
                setMode('date');
                setError('');
              }}
            >
              날짜로 이동
            </button>
            <button
              type="button"
              aria-pressed={mode === 'range'}
              onClick={() => {
                setMode('range');
                setStart(current ? utcDate(current.from) : '');
                setError('');
              }}
            >
              기간 선택
            </button>
          </div>
          <label>
            {mode === 'date' ? '이동할 날짜 (UTC)' : '시작일 (UTC)'}
            <input
              ref={dateInput}
              name="start"
              required
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setError('');
              }}
            />
          </label>
          {mode === 'range' && (
            <label>
              종료일 (UTC)
              <input
                name="end"
                required
                type="date"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setError('');
                }}
              />
            </label>
          )}
          <p>
            {times.length
              ? `${utcDate(times[0])} — ${utcDate(times[times.length - 1])}`
              : '관측 대기'}
            <br />
            {mode === 'date'
              ? '가장 가까운 실제 관측과 주변 구간을 표시합니다.'
              : '선택한 날짜에 확보된 실제 관측만 표시합니다.'}
          </p>
          {error && (
            <p className="date-error" role="alert">
              {error}
            </p>
          )}
          <div className="date-dialog-footer">
            <button type="button" onClick={close}>
              취소
            </button>
            <button type="submit" className="date-apply">
              {mode === 'date' ? '이동' : '기간 적용'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
