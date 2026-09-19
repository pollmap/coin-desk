import { describe, expect, it } from 'vitest';
import { comparisonDateSubmission } from '../src/ComparePage';

const now = Date.parse('2026-09-20T00:00:00Z') / 1000;
const controls = (from?: string, to?: string) => {
  const form = new FormData();
  if (from !== undefined) form.set('from', from);
  if (to !== undefined) form.set('to', to);
  return form;
};

describe('comparison date form submission', () => {
  it('submits dates in the actual controls without needing a prior draft-state change', () => {
    // Reproduction: URL has period=all, date picker/autofill changes native controls,
    // then Apply must read those values even if no React change event was delivered.
    const form = controls();
    form.set('from', '2021-01-01');
    form.set('to', '2024-12-31');
    expect(comparisonDateSubmission(form, now)).toEqual({
      from: '2021-01-01',
      to: '2024-12-31',
    });
    // Revalidation and unrelated renders must not consume or erase the inputs.
    expect(comparisonDateSubmission(form, now)).toEqual({
      from: '2021-01-01',
      to: '2024-12-31',
    });
    expect(form.get('from')).toBe('2021-01-01');
    expect(form.get('to')).toBe('2024-12-31');
  });

  it('uses the latest edit when replacing an already applied range', () => {
    const form = controls('2021-01-01', '2024-12-31');
    form.set('from', '2020-02-29');
    form.set('to', '2025-01-31');
    expect(comparisonDateSubmission(form, now)).toEqual({
      from: '2020-02-29',
      to: '2025-01-31',
    });
  });

  it('rejects missing, impossible, reversed and future dates without changing controls', () => {
    for (const form of [
      controls(),
      controls('', ''),
      controls('2021-01-01'),
      controls('2021-02-29', '2024-12-31'),
      controls('2025-01-01', '2024-12-31'),
      controls('2021-01-01', '2026-09-21'),
    ]) {
      const before = [...form.entries()];
      expect(comparisonDateSubmission(form, now).error).toBeTruthy();
      expect([...form.entries()]).toEqual(before);
    }
  });
});
