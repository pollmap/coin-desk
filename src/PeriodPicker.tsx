import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, ChevronDown } from 'lucide-react';
import { PERIOD_OPTIONS } from '../shared/ranges';
import type { Period } from '../shared/types';
import './period-picker.css';
export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (v: Period) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = PERIOD_OPTIONS.find((period) => period.id === value)?.label ?? '전체';
  return (
    <div className="period-picker">
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
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger className="period-mobile-select" aria-label={'조회 기간 · ' + label}>
          {label}
          <ChevronDown size={12} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={5} align="start" className="period-menu-positioner">
            <Menu.Popup className="period-menu-popup" aria-label="조회 기간">
              <Menu.RadioGroup value={value}>
                {PERIOD_OPTIONS.map((period) => (
                  <Menu.RadioItem
                    key={period.id}
                    value={period.id}
                    className="period-menu-item"
                    closeOnClick
                    onClick={() => {
                      // Re-selecting a period is also an explicit viewport reset.
                      // A native select does not fire change for its current option.
                      onChange(period.id);
                      setOpen(false);
                    }}
                  >
                    <span>{period.label}</span>
                    <Menu.RadioItemIndicator>
                      <Check size={15} aria-hidden="true" />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
