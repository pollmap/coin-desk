import { useRef, useState } from 'react';
import { applyRibbon, ribbonSettings, RIBBON_PRESETS, RIBBON_COLORS } from '../shared/ribbon';

export function RibbonControls({
  indicators,
  onChange,
}: {
  indicators: string[];
  onChange: (value: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(() => ribbonSettings(indicators)),
    [error, setError] = useState('');
  const close = () => {
    dialog.current?.close();
    opener.current?.focus();
  };
  return (
    <>
      <button
        ref={opener}
        onClick={() => {
          setDraft(ribbonSettings(indicators));
          setError('');
          dialog.current?.showModal();
        }}
      >
        리본 설정
      </button>
      <dialog
        ref={dialog}
        className="pattern-config ribbon-config"
        aria-labelledby="ribbon-title"
        onClose={() => opener.current?.focus({ preventScroll: true })}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <header>
          <h2 id="ribbon-title">이동평균 리본</h2>
          <button aria-label="리본 설정 닫기" onClick={close}>
            닫기
          </button>
        </header>
        <div className="ribbon-presets">
          {RIBBON_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                setDraft({ kind: p.kind, periods: p.periods.join(', ') });
                setError('');
              }}
            >
              {p.name}
              <small>
                {p.kind.toUpperCase()} {p.periods.join(' · ')}
              </small>
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const result = applyRibbon(indicators, draft.kind, draft.periods);
            if (result.error) {
              setError(result.error);
              return;
            }
            onChange(result.value);
            close();
          }}
        >
          <label>
            계산 방식
            <select
              aria-label="리본 계산 방식"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'sma' | 'ema' })}
            >
              <option value="sma">SMA · 단순 이동평균</option>
              <option value="ema">EMA · 지수 이동평균</option>
            </select>
          </label>
          <label>
            기간 · 선택한 봉 기준
            <input
              aria-label="리본 기간"
              value={draft.periods}
              onChange={(e) => setDraft({ ...draft, periods: e.target.value })}
              aria-describedby="ribbon-help"
            />
          </label>
          <p id="ribbon-help">
            <small>
              주봉에서 7은 7주입니다. 확정 종가로 계산하며 누락 구간에서 다시 시작합니다. 일·주 기준
              지표는 유지합니다.
            </small>
          </p>
          <div className="ribbon-colors" aria-hidden="true">
            {draft.periods
              .split(/[\s,·]+/)
              .filter(Boolean)
              .slice(0, 10)
              .map((p, i) => (
                <span key={i} style={{ borderColor: RIBBON_COLORS[i] }}>
                  {p}
                </span>
              ))}
          </div>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={close}>
              취소
            </button>
            <button type="submit">차트에 적용</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
