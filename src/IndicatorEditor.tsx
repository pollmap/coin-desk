import { useState } from 'react';
import { INDICATORS } from '../shared/catalog';
import { indicatorSpec, validIndicators } from '../shared/indicators';

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
  function add() {
    const id =
      kind === 'macd'
        ? 'macd'
        : `${kind}:${period}:${['sma', 'ema'].includes(kind) ? basis : 'bar'}${kind === 'bb' ? ':' + multiplier : ''}`;
    const spec = indicatorSpec(id);
    if (!spec) {
      setError('기간은 2~1,000의 정수, 표준편차 배수는 0.5~5로 입력하세요.');
      return;
    }
    const remaining = value.filter(
      (v) => !(['rsi', 'bb', 'macd'].includes(kind) && indicatorSpec(v)?.kind === kind),
    );
    if (remaining.length >= 10) {
      setError('지표는 최대 10개까지 표시할 수 있습니다.');
      return;
    }
    onChange(validIndicators([...remaining, id]));
    setError('');
  }
  const toggle = (id: string) => {
    const kind = indicatorSpec(id)?.kind;
    const rest = ['rsi', 'bb', 'macd'].includes(kind || '')
      ? value.filter((v) => indicatorSpec(v)?.kind !== kind)
      : value;
    onChange(value.includes(id) ? value.filter((v) => v !== id) : validIndicators([...rest, id]));
  };
  return (
    <>
      <div className="indicator-row">
        {INDICATORS.map((i) => (
          <button
            key={i.id}
            className={value.includes(i.id) ? 'active' : ''}
            aria-pressed={value.includes(i.id)}
            onClick={() => toggle(i.id)}
          >
            <span style={{ background: value.includes(i.id) ? i.color : undefined }} />
            {i.label}
          </button>
        ))}
        {value
          .filter((id) => !INDICATORS.some((i) => i.id === id))
          .map((id) => (
            <button className="active" key={id} onClick={() => toggle(id)} title="클릭해 제거">
              <span style={{ background: indicatorSpec(id)?.color }} />
              {indicatorSpec(id)?.label} ×
            </button>
          ))}
        <button className="indicator-config" aria-expanded={open} onClick={() => setOpen(!open)}>
          지표 설정 {open ? '−' : '+'}
        </button>
      </div>
      {open ? (
        <section className="indicator-editor" aria-label="기술지표 설정">
          <div className="preset-row">
            <b>프리셋</b>
            <button onClick={() => onChange(['sma200', 'sma200w'])}>기본 · 200일/200주</button>
            <button onClick={() => onChange(['sma128', 'sma200', 'sma365', 'sma200w'])}>
              매직 라인
            </button>
            <button onClick={() => onChange(['ema:20:bar', 'ema:50:bar', 'rsi', 'macd'])}>
              단기 추세 · EMA/RSI/MACD
            </button>
            <button onClick={() => onChange([])}>모두 끄기</button>
          </div>
          <div className="indicator-fields">
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
                  onChange={(e) => setMultiplier(e.target.value)}
                />
              </label>
            ) : null}
            <button className="primary-button" onClick={add}>
              차트에 추가
            </button>
          </div>
          <p>
            일·주 이동평균은 확정된 종가로 계산합니다. RSI·볼린저밴드·MACD는 선택한 봉 간격을
            사용합니다. 설정은 이 브라우저와 공유 링크에 저장됩니다.
          </p>
          {error ? (
            <p role="alert" className="amber">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
