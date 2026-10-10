import { useState } from 'react';
import { validSupertrendOption, type SupertrendSettings } from '../shared/supertrend';
export function SupertrendControls({
  settings,
  onChange,
}: {
  settings: SupertrendSettings;
  onChange: (patch: Record<string, string>) => void;
}) {
  const [period, setPeriod] = useState(String(settings.period)),
    [multiplier, setMultiplier] = useState(String(settings.multiplier)),
    [error, setError] = useState('');
  return (
    <form
      className="supertrend-settings"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !validSupertrendOption('st_period', period) ||
          !validSupertrendOption('st_multiplier', multiplier)
        ) {
          setError('ATR 기간은 2~1,000, 배수는 0.5~10으로 입력하세요.');
          return;
        }
        setError('');
        onChange({ st_period: period, st_multiplier: multiplier });
      }}
    >
      <label>
        ATR 기간{' '}
        <input
          aria-label="슈퍼트렌드 ATR 기간"
          type="number"
          min="2"
          max="1000"
          step="1"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
      </label>
      <label>
        배수{' '}
        <input
          aria-label="슈퍼트렌드 배수"
          type="number"
          min="0.5"
          max="10"
          step="0.01"
          value={multiplier}
          onChange={(e) => setMultiplier(e.target.value)}
        />
      </label>
      <button type="submit">설정 적용</button>
      {error && <span role="alert">{error}</span>}
    </form>
  );
}
