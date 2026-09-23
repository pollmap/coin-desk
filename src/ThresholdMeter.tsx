import { THRESHOLDS, thresholdState } from '../shared/thresholds';
import { metricValue } from './lib';

export function ThresholdMeter({ id, value, unit }: { id: string; value?: number; unit: string }) {
  const definition = THRESHOLDS[id];
  if (!definition?.boundaries.length || value === undefined || !Number.isFinite(value)) return null;
  const boundaries = definition.boundaries.map((b) => b.value);
  const lo = boundaries[0],
    hi = boundaries.at(-1)!;
  const pad = Math.max(hi - lo, Math.abs(lo) * 0.5, 0.5) * 0.4;
  const min = Math.min(value, lo - pad),
    max = Math.max(value, hi + pad);
  const x = (v: number) => ((v - min) / (max - min)) * 100;
  const state = thresholdState(id, value);
  return (
    <div
      className="threshold-meter"
      aria-label={`현재 ${metricValue(value, unit)} · ${state?.label ?? ''} · 원래 지표 단위`}
    >
      <div className="meter-heading">
        <span>현재 위치</span>
        <b style={{ color: state?.color }}>{state?.label}</b>
        <span>{metricValue(value, unit)}</span>
      </div>
      <div className="meter-track">
        {definition.bands.map((b) => (
          <span
            key={b.label}
            title={`${b.label} · ${b.range}`}
            style={{
              left: x(b.lower ?? min) + '%',
              width: Math.max(0, x(b.upper ?? max) - x(b.lower ?? min)) + '%',
              background: b.color,
            }}
          />
        ))}
        <i style={{ left: x(value) + '%' }} />
      </div>
      <div className="meter-ticks">
        {definition.boundaries.map((b) => (
          <span key={b.value} style={{ left: x(b.value) + '%' }}>
            {metricValue(b.value, unit)}
          </span>
        ))}
      </div>
      <small>
        원래 지표 값 · 참고 구간 ·{' '}
        {definition.boundaries.length === 1 ? '손익 기준' : '매수·매도 확정 신호 아님'}
      </small>
    </div>
  );
}
