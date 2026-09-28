import { Link, useSearchParams } from 'react-router-dom';
import { guideForMetric, guideHref } from '../shared/learning-catalog';
import { METRIC_GUIDES } from '../shared/metric-guides';
import { METRICS } from '../shared/catalog';
import { ThresholdLegend } from './ThresholdLegend';
export function MetricGuide({
  id,
  compact = false,
  expanded = false,
  showThresholds = true,
}: {
  id: string;
  compact?: boolean;
  expanded?: boolean;
  showThresholds?: boolean;
}) {
  const guide = METRIC_GUIDES[id === 'ema' ? 'sma' : id];
  const [params] = useSearchParams();
  const article = guideForMetric(METRICS.some((m) => m.id === id) ? 'btc:' + id : id);
  if (!guide) return null;
  return (
    <details className="metric-guide" open={expanded || undefined}>
      <summary>
        <span>읽는 방법</span>
        {compact ? null : guide.question}
      </summary>
      {showThresholds ? <ThresholdLegend id={id} showReading={false} /> : null}
      <div className="guide-columns">
        <div>
          <h3>먼저 볼 것</h3>
          <p>{guide.read}</p>
          <p className="guide-example">{guide.example}</p>
          {article && <Link to={guideHref(article.id, params)}>계산식과 예시 자세히 읽기 →</Link>}
        </div>
        <div>
          <h3>함께 볼 것</h3>
          <p>{guide.pair}</p>
          <div className="guide-related">
            {guide.related.map((key) => (
              <Link key={key} to={guideHref('btc-' + key, params)}>
                {METRICS.find((m) => m.id === key)?.title} 설명 →
              </Link>
            ))}
          </div>
        </div>
        <div>
          <h3>해석의 한계</h3>
          <p>{guide.caveat}</p>
          <a href={guide.source} target="_blank" rel="noreferrer">
            정의·참고 원문 ↗
          </a>
        </div>
      </div>
    </details>
  );
}
