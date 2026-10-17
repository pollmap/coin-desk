import { Link, useSearchParams } from 'react-router-dom';
import { indicatorDefinition } from '../shared/indicator-catalog';
import { COMPARISON_METRICS } from '../shared/indicator-comparison';
export function ComparisonModes({ mode }: { mode: 'indicator' | 'performance' }) {
  const [params] = useSearchParams();
  const metric = params.get('metric') ?? 'net:mvrv';
  const indicators = new URLSearchParams({
    mode: 'indicator',
    assets: params.get('assets')?.split(',').slice(0, 3).join(',') ?? 'BTC,ETH',
    metric: (COMPARISON_METRICS as readonly string[]).includes(metric) ? metric : 'net:mvrv',
    period: params.get('period') ?? '5y',
  });
  const source = indicatorDefinition(indicators.get('metric')!)!.comparison!.source;
  indicators.set(
    'source',
    source === 'price'
      ? ['reference', 'upbit', 'binance'].includes(params.get('source') ?? '')
        ? params.get('source')!
        : (params.get('market') ?? 'binance')
      : source,
  );
  const performance = new URLSearchParams({
    mode: 'performance',
    assets: params.get('assets') ?? 'BTC,DOGE,ETH',
    market:
      params.get('market') ??
      (['binance', 'upbit'].includes(params.get('source') ?? '') ? params.get('source')! : 'upbit'),
    period: params.get('period') ?? '1y',
  });
  return (
    <nav className="comparison-modes" aria-label="비교 방식">
      <Link aria-current={mode === 'indicator' ? 'page' : undefined} to={'/compare?' + indicators}>
        같은 지표 비교
      </Link>
      <Link
        aria-current={mode === 'performance' ? 'page' : undefined}
        to={'/compare?' + performance}
      >
        가격 성과 비교
      </Link>
    </nav>
  );
}
