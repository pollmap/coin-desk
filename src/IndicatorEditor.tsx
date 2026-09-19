import { useEffect, useId, useRef, useState } from 'react';
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
  const [panel, setPanel] = useState<'presets' | 'edit' | 'active'>('presets');
  const editorId = useId();
  const periodInput = useRef<HTMLInputElement>(null);
  const tabs = [
    { id: 'presets', label: '프리셋' },
    { id: 'edit', label: '직접 설정' },
    { id: 'active', label: `적용 중 (${value.length})` },
  ] as const;
  const identities = new Set(value.map(indicatorIdentity));
  useEffect(() => {
    if (editing && !value.includes(editing)) setEditing(undefined);
  }, [editing, value]);
  function defaults(nextKind = kind) {
    setKind(nextKind);
    setPeriod(nextKind === 'rsi' ? '14' : nextKind === 'macd' ? '12' : '20');
    setBasis(['sma', 'ema'].includes(nextKind) ? 'd' : 'bar');
    setMultiplier('2');
    setError('');
  }
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
    setPanel('active');
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
      setPanel('active');
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
    setPanel('active');
  }
  return (
    <>
      <div className="indicator-row">
        {INDICATORS.filter((i) => identities.has(indicatorIdentity(i.id))).map((i) => (
          <button
            key={i.id}
            className="active"
            aria-pressed={true}
            title={i.label + ' 제거'}
            onClick={() => toggle(i.id)}
          >
            <span
              style={{
                background: i.color,
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
        <span className="indicator-count">
          {value.length ? `${value.length}/10개 표시` : '선택한 지표 없음'}
        </span>
      </div>
      {open ? (
        <section id={editorId} className="indicator-editor" aria-label="기술지표 설정">
          <div
            className="indicator-tabs"
            role="tablist"
            aria-label="지표 설정 방식"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex((tab) => tab.id === panel);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              setPanel(tabs[next].id);
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                id={`${editorId}-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={panel === tab.id}
                aria-controls={`${editorId}-content`}
                tabIndex={panel === tab.id ? 0 : -1}
                onClick={() => setPanel(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            id={`${editorId}-content`}
            role="tabpanel"
            aria-labelledby={`${editorId}-${panel}`}
            tabIndex={0}
          >
            {panel === 'presets' ? (
              <>
                <p>
                  자주 쓰는 구성을 한 번에 적용합니다. 현재 표시 중인 지표 구성은 선택한 프리셋으로
                  바뀝니다.
                </p>
                <div className="preset-row indicator-preset-grid">
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
                </div>
              </>
            ) : null}
            {panel === 'active' ? (
              <>
                <p>
                  현재 차트에 적용된 지표입니다. 기간·배수를 고치거나 필요한 지표만 남길 수
                  있습니다.
                </p>
                {value.length ? (
                  <div
                    className="selected-indicator-list indicator-active-list"
                    aria-label="현재 지표 수정"
                  >
                    {value.map((id) => (
                      <div className="indicator-active-item" key={id}>
                        <span style={{ color: indicatorSpec(id)?.color }}>
                          {indicatorSpec(id)?.label}
                        </span>
                        <button
                          aria-label={indicatorSpec(id)?.label + ' 수정'}
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
                            setPanel('edit');
                            requestAnimationFrame(() => periodInput.current?.focus());
                          }}
                        >
                          수정
                        </button>
                        <button
                          onClick={() => toggle(id)}
                          aria-label={indicatorSpec(id)?.label + ' 제거'}
                        >
                          제거
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>현재 선택된 지표가 없습니다. 프리셋을 고르거나 직접 설정에서 추가하세요.</p>
                )}
                {value.length ? (
                  <button className="indicator-clear" onClick={() => preset([])}>
                    표시 지표 모두 끄기
                  </button>
                ) : null}
              </>
            ) : null}
            {panel === 'edit' ? (
              <>
                <p>
                  {editing
                    ? `${indicatorSpec(editing)?.label} 수정 중 · 적용 전까지 현재 차트는 유지됩니다.`
                    : '기간·계산 단위를 정하고 차트에 추가하세요. 최대 10개까지 표시할 수 있습니다.'}
                </p>
                <form
                  className="indicator-fields"
                  onSubmit={(e) => {
                    e.preventDefault();
                    add();
                  }}
                >
                  <label>
                    지표
                    <select value={kind} onChange={(e) => defaults(e.target.value)}>
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
                  <button
                    type="button"
                    className="indicator-defaults"
                    onClick={() => {
                      defaults();
                      setFeedback(
                        '이 지표의 기본값을 불러왔습니다. 적용 버튼을 누르면 차트가 바뀝니다.',
                      );
                    }}
                  >
                    기본값 불러오기
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
                  사용하며, 진행 중인 봉의 값은 바뀔 수 있습니다. 서로 다른 단위의 지표를 구분해
                  읽으세요. 설정은 이 브라우저와 공유 링크에 저장됩니다.
                </p>
              </>
            ) : null}
          </div>
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
