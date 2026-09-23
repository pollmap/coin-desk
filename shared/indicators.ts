import { INDICATORS } from './catalog';
export interface IndicatorSpec {
  id: string;
  kind: 'sma' | 'ema' | 'rsi' | 'bb' | 'macd';
  period: number;
  basis: 'bar' | 'd' | 'w';
  multiplier: number;
  slowPeriod?: number;
  signalPeriod?: number;
  label: string;
  color: string;
}
const aliases: Record<string, string> = {
  sma128: 'sma:128:d',
  sma200: 'sma:200:d',
  sma365: 'sma:365:d',
  sma200w: 'sma:200:w',
  rsi: 'rsi:14:bar',
  bb: 'bb:20:bar:2',
  macd: 'macd:12:bar',
};
export function indicatorSpec(id: string): IndicatorSpec | null {
  if (typeof id !== 'string' || id.length > 40) return null;
  const normalized = aliases[id] || id;
  if (normalized.startsWith('macd:')) {
    const parts = normalized.split(':');
    const fast = Number(parts[1]),
      slow = Number(parts[3] ?? 26),
      signal = Number(parts[4] ?? 9);
    if (
      ![3, 5].includes(parts.length) ||
      parts[2] !== 'bar' ||
      ![parts[1], parts[3] ?? '26', parts[4] ?? '9'].every((v) => /^\d+$/.test(v)) ||
      ![fast, slow, signal].every((v) => Number.isInteger(v) && v >= 2 && v <= 1000) ||
      fast >= slow
    )
      return null;
    return {
      id,
      kind: 'macd',
      period: fast,
      slowPeriod: slow,
      signalPeriod: signal,
      basis: 'bar',
      multiplier: 2,
      label: `MACD ${fast}·${slow}·${signal}`,
      color: '#55c4ba',
    };
  }
  const [kind, p, basis = 'bar', k = '2', extra] = (aliases[id] || id).split(':');
  const period = Number(p),
    multiplier = Number(k);
  if (
    extra !== undefined ||
    !['sma', 'ema', 'rsi', 'bb', 'macd'].includes(kind) ||
    !/^\d+$/.test(p || '') ||
    !Number.isInteger(period) ||
    period < 2 ||
    period > 1000 ||
    !['bar', 'd', 'w'].includes(basis) ||
    !Number.isFinite(multiplier) ||
    multiplier < 0.5 ||
    multiplier > 5
  )
    return null;
  if (['rsi', 'bb', 'macd'].includes(kind) && basis !== 'bar') return null;
  if (kind === 'macd' && period !== 12) return null;
  const preset = INDICATORS.find((i) => i.id === id);
  const suffix = basis === 'd' ? '일' : basis === 'w' ? '주' : '봉';
  const label =
    kind === 'bb'
      ? `BB ${period} · ${multiplier}σ`
      : kind === 'macd'
        ? 'MACD 12·26·9'
        : kind === 'rsi'
          ? `RSI ${period}`
          : `${kind.toUpperCase()} ${period}${suffix}`;
  return {
    id,
    kind: kind as IndicatorSpec['kind'],
    period,
    basis: basis as IndicatorSpec['basis'],
    multiplier,
    label: preset?.label || label,
    color:
      preset?.color ||
      (['sma', 'ema'].includes(kind)
        ? ['#70b8db', '#efb765', '#c19fe5', '#55c4ba', '#dc8ebb'][Math.floor(period / 10) % 5]
        : undefined) ||
      { sma: '#70b8db', ema: '#efb765', rsi: '#aa92e7', bb: '#8995a8', macd: '#55c4ba' }[
        kind as 'sma'
      ],
  };
}
export function validIndicators(input: unknown): string[] {
  if (!Array.isArray(input)) return ['sma200', 'sma200w'];
  const seen = new Set<string>();
  return [...new Set(input)]
    .filter((id): id is string => {
      const s = indicatorSpec(id);
      if (!s) return false;
      const key = ['rsi', 'bb', 'macd'].includes(s.kind)
        ? s.kind
        : `${s.kind}:${s.period}:${s.basis}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

/** Preset aliases and an equivalent custom period refer to the same chart line. */
export function indicatorIdentity(id: string): string | null {
  const s = indicatorSpec(id);
  return s
    ? `${s.kind}:${s.period}:${s.basis}${s.kind === 'bb' ? ':' + s.multiplier : s.kind === 'macd' ? ':' + s.slowPeriod + ':' + s.signalPeriod : ''}`
    : null;
}

export function addIndicator(
  input: string[],
  candidate: string,
  replaceId?: string,
): { value: string[]; error?: string } {
  const spec = indicatorSpec(candidate);
  if (!spec)
    return {
      value: input,
      error: '기간은 2~1,000 정수, MACD 단기는 장기보다 작게, 표준편차 배수는 0.5~5로 입력하세요.',
    };
  const identity = indicatorIdentity(candidate);
  const remaining = validIndicators(input).filter(
    (id) =>
      id !== replaceId &&
      indicatorIdentity(id) !== identity &&
      !(['rsi', 'bb', 'macd'].includes(spec.kind) && indicatorSpec(id)?.kind === spec.kind),
  );
  if (remaining.length >= 10)
    return {
      value: input,
      error: '지표는 최대 10개까지 표시할 수 있습니다. 기존 지표를 제거하거나 수정하세요.',
    };
  return { value: validIndicators([...remaining, candidate]) };
}
