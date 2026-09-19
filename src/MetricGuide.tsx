import { Link } from 'react-router-dom';
import { METRIC_GUIDES } from '../shared/metric-guides';
import { METRICS } from '../shared/catalog';
export function MetricGuide({ id, expanded = false }: { id: string; expanded?: boolean }) {
  const guide = METRIC_GUIDES[id === 'ema' ? 'sma' : id];
  if (!guide) return null;
  return (
    <details className="metric-guide" open={expanded || undefined}>
      <summary>
        <span>읽는 방법</span>
        {guide.question}
      </summary>
      <div className="guide-columns">
        <div>
          <h3>먼저 볼 것</h3>
          <p>{guide.read}</p>
          <p className="guide-example">{guide.example}</p>
        </div>
        <div>
          <h3>함께 볼 것</h3>
          <p>{guide.pair}</p>
          <div className="guide-related">
            {guide.related.map((key) => (
              <Link key={key} to={'/metrics/' + key}>
                {METRICS.find((m) => m.id === key)?.title} ↗
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
