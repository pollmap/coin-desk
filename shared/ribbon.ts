import { indicatorSpec, validIndicators } from './indicators';

export const RIBBON_PRESETS = [
  { name: '기본 추세', kind: 'sma', periods: [7, 25, 50, 100] },
  { name: '장기 추세', kind: 'sma', periods: [20, 50, 100, 200] },
  { name: '빠른 반응', kind: 'ema', periods: [8, 13, 21, 34, 55, 89] },
] as const;
export const RIBBON_COLORS = [
  '#d17a33',
  '#ba9847',
  '#6ea344',
  '#349c91',
  '#4d99d2',
  '#877fd0',
  '#b76caf',
  '#c67582',
  '#718f9e',
  '#8b8754',
];

export function ribbonSettings(ids: string[]) {
  const lines = ids
    .map(indicatorSpec)
    .filter((s) => s && ['sma', 'ema'].includes(s.kind) && s.basis === 'bar');
  return {
    kind: lines[0]?.kind === 'ema' ? ('ema' as const) : ('sma' as const),
    periods: lines.length ? lines.map((s) => s!.period).join(', ') : '7, 25, 50, 100',
  };
}

/** Replace only bar-based moving averages; preserve daily/weekly overlays and oscillators. */
export function applyRibbon(
  ids: string[],
  kind: string,
  input: string,
): { value: string[]; error?: string } {
  const tokens = input.trim().split(/[\s,·]+/);
  const periods = tokens.map(Number);
  if (
    !['sma', 'ema'].includes(kind) ||
    tokens.length < 2 ||
    tokens.length > 10 ||
    tokens.some((s) => !/^\d+$/.test(s)) ||
    periods.some((p) => p < 2 || p > 1000) ||
    new Set(periods).size !== periods.length
  )
    return { value: ids, error: '중복 없는 2~1,000 정수 기간을 2~10개 입력하세요.' };
  const kept = validIndicators(ids).filter((id) => {
    const s = indicatorSpec(id)!;
    return s.basis !== 'bar' || !['sma', 'ema'].includes(s.kind);
  });
  if (kept.length + periods.length > 10)
    return {
      value: ids,
      error: '기존 지표를 포함해 최대 10개입니다. 기간 수를 줄이거나 다른 지표를 제거하세요.',
    };
  return { value: [...periods.sort((a, b) => a - b).map((p) => `${kind}:${p}:bar`), ...kept] };
}
