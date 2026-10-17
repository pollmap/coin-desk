import { useMemo } from 'react';
import { PathPlot } from './AnalysisLab';
import type { Seasonality } from '../shared/advanced-analysis';

export function DashboardSeasonality({ result }: { result: Seasonality }) {
  const paths = useMemo(
    () => [
      {
        name: '중앙값',
        data: result.summary.map((p) => ({ time: p.day, value: p.median })),
        color: 'var(--accent)',
      },
      {
        name: '평균',
        data: result.summary.map((p) => ({ time: p.day, value: p.mean })),
        color: '#b76d28',
      },
      { name: '올해', data: result.current, color: '#3167b9' },
    ],
    [result],
  );
  if (!result.summary.length)
    return <div className="coin-dashboard-empty">완전한 3개 연도의 가격이 필요합니다.</div>;
  return (
    <PathPlot
      paths={paths}
      calendar
      band={{
        low: result.summary.map((p) => ({ time: p.day, value: p.low })),
        high: result.summary.map((p) => ({ time: p.day, value: p.high })),
      }}
    />
  );
}
