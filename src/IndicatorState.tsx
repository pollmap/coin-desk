import type { IndicatorAvailability } from '../shared/indicator-catalog';
export const STATE_LABELS: Record<IndicatorAvailability, string> = {
  ready: '',
  delayed: '갱신 지연',
  unsupported: '지원하지 않는 지표',
  'insufficient-history': '이 지표를 표시할 수 없습니다',
  pending: '이 지표를 표시할 수 없습니다',
  loading: '불러오는 중',
  error: '불러오기 실패',
};
export function IndicatorState({
  state,
  onRetry,
}: {
  state: IndicatorAvailability;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="indicator-state"
      data-state={state}
      role={state === 'error' ? 'alert' : 'status'}
    >
      <strong>{STATE_LABELS[state]}</strong>
      {onRetry && state === 'error' && <button onClick={onRetry}>다시 시도</button>}
    </div>
  );
}
