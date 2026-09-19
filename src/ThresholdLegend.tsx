import type { CSSProperties } from 'react';
import type { Point } from '../shared/types';
import { THRESHOLDS, realizedPosition, thresholdState } from '../shared/thresholds';
import { dateLabel, money, numeric, metricValue } from './lib';
import './thresholds.css';

export function ThresholdLegend({
  id,
  point,
  comparison,
  readingLabel = '최근 관측',
  showReading = true,
  compact = false,
  stale = false,
  dataSource,
  unit,
}: {
  id: string;
  point?: Point;
  comparison?: Point;
  readingLabel?: string;
  showReading?: boolean;
  compact?: boolean;
  stale?: boolean;
  dataSource?: string;
  unit?: string;
}) {
  const definition = THRESHOLDS[id];
  if (!definition) return null;
  const position = definition.comparison ? realizedPosition(point, comparison) : null;
  const state = definition.comparison ? position : thresholdState(id, point?.value);
  return (
    <section
      className={'threshold-legend' + (compact ? ' threshold-compact' : '')}
      aria-label="지표 참고 구간"
    >
      {showReading ? (
        <div className="threshold-current">
          <span>
            {readingLabel}
            {point ? ` · ${dateLabel(point.time, id === 'rsi')}` : ''}
            {stale ? ' · 지연 데이터' : ''}
          </span>
          <strong style={state ? { color: state.color } : undefined}>
            {state?.label ?? (definition.comparison ? '같은 날짜 가격 대기' : '값 대기')}
          </strong>
          {point ? (
            <b title={`원자료 값: ${point.value}`}>
              {unit
                ? metricValue(point.value, unit)
                : definition.comparison
                  ? money(point.value, 'USD')
                  : numeric(point.value * (id === 'nupl' ? 100 : 1)) +
                    (id === 'nupl'
                      ? '%'
                      : (id.includes('mvrv') && id !== 'mvrv_z') || id === 'sopr_24h'
                        ? '×'
                        : id === 'mvrv_z'
                          ? ' Z'
                          : '')}
            </b>
          ) : null}
          {position ? (
            <span>
              추정 가격 / 실현가격 {numeric(position.ratio)}× · {position.percent > 0 ? '+' : ''}
              {numeric(position.percent)}%
            </span>
          ) : null}
        </div>
      ) : null}
      {definition.bands.length ? (
        <ul className="threshold-band-legend" aria-label="색 구간과 경계값">
          {definition.bands.map((band) => (
            <li
              key={band.range}
              style={{ '--zone-color': band.color } as CSSProperties}
              data-active={state?.label === band.label || undefined}
            >
              <i aria-hidden="true" />
              <span>{band.label}</span>
              <b>{band.range}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="threshold-comparison">
          같은 날짜의 추정 USD 가격을 실현가격과 비교합니다. 1× = 같은 가격
        </p>
      )}
      <div className="threshold-sources">
        {dataSource ? <span>관측 원천: {dataSource}</span> : null}
        <span>기준 원문</span>
        {definition.sources.map((source) => (
          <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
            {source.title} ↗
          </a>
        ))}
      </div>
      {compact ? (
        <details className="threshold-note">
          <summary>참고 구간의 한계</summary>
          <p>{definition.note}</p>
        </details>
      ) : (
        <p className="threshold-note">{definition.note}</p>
      )}
    </section>
  );
}
