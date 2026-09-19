import type { Point } from '../shared/types';
import { THRESHOLDS, realizedPosition, thresholdState } from '../shared/thresholds';
import { dateLabel, metricValue, numeric } from './lib';
import './thresholds.css';

/** Compact observation context above the plot; detailed source and limitations stay below. */
export function ThresholdSummary({
  id,
  unit,
  point,
  comparison,
  selected = false,
  stale = false,
}: {
  id: string;
  unit: string;
  point?: Point;
  comparison?: Point;
  selected?: boolean;
  stale?: boolean;
}) {
  const definition = THRESHOLDS[id];
  if (!definition) return null;
  const position = definition.comparison ? realizedPosition(point, comparison) : null;
  const state = definition.comparison ? position : thresholdState(id, point?.value);
  return (
    <div className="threshold-summary" aria-label="관측 구간 요약" data-zone={state?.label}>
      <span>
        {selected ? '선택 관측' : '최근 관측'}
        {point ? ' · ' + dateLabel(point.time) : ''}
        {stale ? ' · 지연' : ''}
      </span>
      <b title={point ? `원자료 값: ${point.value}` : undefined}>
        {metricValue(point?.value, unit)}
      </b>
      <strong style={state ? { color: state.color } : undefined}>
        {state?.label ?? (definition.comparison ? '같은 날짜 가격 대기' : '값 대기')}
      </strong>
      <small>
        {definition.comparison
          ? position
            ? `추정 가격 / 실현가격 ${numeric(position.ratio)}× · 일치 1×`
            : '추정 가격과 실현가격 · 같은 USD 축'
          : '경계 ' +
            definition.boundaries.map((boundary) => metricValue(boundary.value, unit)).join(' / ')}
      </small>
    </div>
  );
}
