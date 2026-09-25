import { indicatorSpec, validIndicators } from './indicators';
import { bollinger, ema, macd, rsi, sma, DAY } from './math';
import type { Point } from './types';
function segments(points: Point[], step: number) {
  const output: Point[][] = [];
  for (const p of points) {
    const group = output.at(-1);
    const previous = group?.at(-1);
    const d = previous ? new Date(previous.time * 1000) : null;
    const adjacent =
      d &&
      (step === 32 * DAY
        ? p.time === Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
        : p.time - previous!.time === step);
    if (!group || !adjacent) output.push([p]);
    else group.push(p);
  }
  return output;
}
export function workspaceIndicators(
  points: Point[],
  daily: Point[],
  ids: string[],
  unit: string,
  barStep = DAY,
) {
  const days = new Set(daily.map((p) => p.time));
  const weekly = daily.filter(
    (p) =>
      new Date(p.time * 1000).getUTCDay() === 0 &&
      Array.from({ length: 7 }, (_, i) => p.time - i * DAY).every((t) => days.has(t)),
  );
  return validIndicators(ids).flatMap((id) => {
    const spec = indicatorSpec(id)!;
    const input = spec.basis === 'w' ? weekly : spec.basis === 'd' ? daily : points;
    const step = spec.basis === 'w' ? 7 * DAY : spec.basis === 'd' ? DAY : barStep;
    const series: Point[][] = [];
    for (const group of segments(input, step)) {
      const calculated =
        spec.kind === 'bb'
          ? (() => {
              const b = bollinger(group, spec.period, spec.multiplier);
              return [b.middle, b.upper, b.lower];
            })()
          : spec.kind === 'macd'
            ? (() => {
                const m = macd(group, spec.period, spec.slowPeriod, spec.signalPeriod);
                return [m.line, m.signal, m.histogram];
              })()
            : [(spec.kind === 'rsi' ? rsi : spec.kind === 'ema' ? ema : sma)(group, spec.period)];
      calculated.forEach((data, i) => {
        series[i] ??= [];
        series[i].push(...data);
      });
    }
    return series.map((data, i) => ({
      id: id + ':' + i,
      title:
        spec.label +
        (series.length > 1
          ? ' ' + (spec.kind === 'bb' ? ['중앙', '상단', '하단'] : ['MACD', '신호선', '차이'])[i]
          : ''),
      unit: spec.kind === 'rsi' ? 'RSI' : unit,
      source: '선택 가격 원천',
      formula: `${spec.label} · ${spec.basis === 'w' ? '완료된 주' : spec.basis === 'd' ? '확정 일봉' : '선택 봉'} · 결측 구간에서 계산 재시작`,
      data,
      color: i ? ['#b3a3df', '#6eaad3'][i - 1] : spec.color,
      overlay: !['rsi', 'macd'].includes(spec.kind),
      pane: spec.kind === 'macd' ? id : undefined,
      thresholds:
        spec.kind === 'rsi' ? [30, 70] : spec.kind === 'macd' && i === 0 ? [0] : undefined,
      step,
    }));
  });
}
