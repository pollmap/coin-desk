import { PERIOD_OPTIONS } from '../shared/ranges';
import type { Period } from '../shared/types';
export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (v: Period) => void;
}) {
  return (
    <div className="segments" aria-label="조회 기간">
      {PERIOD_OPTIONS.map((p) => (
        <button
          key={p.id}
          aria-pressed={value === p.id}
          className={value === p.id ? 'selected' : ''}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
