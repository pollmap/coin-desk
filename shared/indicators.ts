import { INDICATORS } from './catalog';
export interface IndicatorSpec {
  id: string;
  kind: 'sma' | 'ema' | 'rsi' | 'bb' | 'macd';
  period: number;
  basis: 'bar' | 'd' | 'w';
  multiplier: number;
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
