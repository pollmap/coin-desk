import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
const Indicators = lazy(() =>
  import('./IndicatorComparisonPage').then((m) => ({ default: m.IndicatorComparisonPage })),
);
const Performance = lazy(() => import('./ComparePage').then((m) => ({ default: m.ComparePage })));
export function ComparisonWorkspace() {
  const params = new URLSearchParams(useLocation().search);
  // Explicit legacy performance settings retain their existing interpretation.
  const indicator = params.get('mode') === 'indicator' || !params.toString();
  return (
    <Suspense fallback={<p role="status">비교를 여는 중…</p>}>
      {indicator ? <Indicators /> : <Performance />}
    </Suspense>
  );
}
