import { useId, useRef, useState } from 'react';
import { INDICATORS } from '../shared/catalog';
import { addIndicator, indicatorIdentity, indicatorSpec } from '../shared/indicators';
import './chart-improvements.css';

export function IndicatorEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState('sma'),
    [period, setPeriod] = useState('20'),
    [basis, setBasis] = useState('d'),
    [multiplier, setMultiplier] = useState('2');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | undefined>();
  const [feedback, setFeedback] = useState('');
  const editorId = useId();
  const periodInput = useRef<HTMLInputElement>(null);
  function add() {
    const id =
      kind === 'macd'
        ? 'macd'
        : `${kind}:${period}:${['sma', 'ema'].includes(kind) ? basis : 'bar'}${kind === 'bb' ? ':' + multiplier : ''}`;
    const result = addIndicator(value, id, editing);
    if (result.error) {
      setError(result.error);
      setFeedback('');
      return;
    }
    onChange(result.value);
    setFeedback(`${indicatorSpec(id)?.label} ${editing ? '수정' : '추가'} 완료`);
    setEditing(undefined);
    setError('');
  }
  const toggle = (id: string) => {
    const matching = value.find((v) => indicatorIdentity(v) === indicatorIdentity(id));
    const result = matching
      ? { value: value.filter((v) => v !== matching), error: undefined }
      : addIndicator(value, id);
    if (result.error) {
      setError(result.error);
      setOpen(true);
      setFeedback('');
      return;
    }
    onChange(result.value);
    setError('');
    setFeedback(`${indicatorSpec(id)?.label} ${matching ? '제거' : '추가'} 완료`);
  };
  function preset(next: string[]) {
    onChange(next);
    setEditing(undefined);
    setError('');
    setFeedback('프리셋을 적용했습니다.');
  }
  return (
    <>
      <div className="indicator-row">
        {INDICATORS.map((i) => (
          <button
            key={i.id}
            className={
              value.some((id) => indicatorIdentity(id) === indicatorIdentity(i.id)) ? 'active' : ''
            }
            aria-pressed={value.some((id) => indicatorIdentity(id) === indicatorIdentity(i.id))}
            onClick={() => toggle(i.id)}
          >
            <span
              style={{
                background: value.some((id) => indicatorIdentity(id) === indicatorIdentity(i.id))
                  ? i.color
                  : undefined,
              }}
            />
            {i.label}
          </button>
        ))}
        {value
          .filter(
            (id) => !INDICATORS.some((i) => indicatorIdentity(i.id) === indicatorIdentity(id)),
          )
          .map((id) => (
            <button
              className="active"
              key={id}
              onClick={() => toggle(id)}
              title="클릭해 제거"
              aria-label={indicatorSpec(id)?.label + ' 제거'}
            >
              <span style={{ background: indicatorSpec(id)?.color }} />
              {indicatorSpec(id)?.label} ×
            </button>
          ))}
        <button
          className="indicator-config"
          aria-expanded={open}
          aria-controls={editorId}
          onClick={() => setOpen(!open)}
        >
          지표 설정 {open ? '−' : '+'}
        </button>
      </div>
      {open ? (
        <section id={editorId} className="indicator-editor" aria-label="기술지표 설정">
          <div className="preset-row">
            <b>프리셋</b>
            <button onClick={() => preset(['sma200', 'sma200w'])}>기본 · 200일/200주</button>
            <button onClick={() => preset(['sma128', 'sma200', 'sma365', 'sma200w'])}>
              매직 라인
            </button>
            <button onClick={() => preset(['ema:20:bar', 'ema:50:bar', 'rsi', 'macd'])}>
              단기 추세 · EMA/RSI/MACD
            </button>
            <button onClick={() => preset(['sma:20:d', 'sma:50:d', 'sma200', 'bb', 'rsi'])}>
              중기 추세 · 20/50/200일
            </button>
            <button onClick={() => preset([])}>모두 끄기</button>
          </div>
          {value.length ? (
            <div className="selected-indicator-list" aria-label="현재 지표 수정">
              {value.map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    const spec = indicatorSpec(id);
                    if (!spec) return;
                    setEditing(id);
                    setKind(spec.kind);
                    setPeriod(String(spec.period));
                    setBasis(spec.basis);
                    setMultiplier(String(spec.multiplier));
                    setError('');
                    setFeedback(`${spec.label} 값을 바꾼 후 수정 적용을 누르세요.`);
                    requestAnimationFrame(() => periodInput.current?.focus());
                  }}
                >
                  {indicatorSpec(id)?.label} 수정
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="indicator-fields"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label>
              지표
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="sma">단순 이동평균 SMA</option>
                <option value="ema">지수 이동평균 EMA</option>
                <option value="rsi">RSI</option>
                <option value="bb">볼린저밴드</option>
                <option value="macd">MACD 12·26·9</option>
              </select>
            </label>
            {kind !== 'macd' ? (
              <label>
                기간
                <input
                  type="number"
                  min="2"
                  max="1000"
                  step="1"
                  value={period}
                  ref={periodInput}
                  required
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </label>
            ) : null}
            {['sma', 'ema'].includes(kind) ? (
              <label>
                계산 단위
                <select value={basis} onChange={(e) => setBasis(e.target.value)}>
                  <option value="d">일봉 종가</option>
                  <option value="w">주봉 종가</option>
                  <option value="bar">선택한 봉 간격</option>
                </select>
              </label>
            ) : null}
            {kind === 'bb' ? (
              <label>
                표준편차 배수
                <input
                  type="number"
                  min="0.5"
                  max="5"
                  step="0.1"
                  value={multiplier}
                  required
                  onChange={(e) => setMultiplier(e.target.value)}
                />
              </label>
            ) : null}
            <button className="primary-button" type="submit">
              {editing ? '수정 적용' : '차트에 추가'}
            </button>
            {editing ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setFeedback('새 지표 추가로 전환했습니다.');
                }}
              >
                수정 취소
              </button>
            ) : null}
          </form>
          <p>
            일·주 이동평균은 확정된 종가로 계산합니다. RSI·볼린저밴드·MACD는 선택한 봉 간격을
            사용하며, 진행 중인 봉의 값은 바뀔 수 있습니다. 서로 다른 단위의 지표를 구분해 읽으세요.
            설정은 이 브라우저와 공유 링크에 저장됩니다.
          </p>
          {error ? (
            <p role="alert" className="amber">
              {error}
            </p>
          ) : null}
          {feedback ? <p role="status">{feedback}</p> : null}
        </section>
      ) : null}
    </>
  );
}
