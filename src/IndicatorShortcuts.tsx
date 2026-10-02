import { Link } from 'react-router-dom';
import { navigationIndicators } from '../shared/indicator-catalog';
import { indicatorUrl } from '../shared/indicator-catalog';
import type { Asset } from '../shared/types';
export function IndicatorShortcuts({
  asset,
  selected,
  params,
}: {
  asset: Asset;
  selected: string;
  params: URLSearchParams;
}) {
  const ids = ['net:mvrv', 'view:rainbow', 'view:btc_rainbow', 'rsi', 'futures:funding'];
  return (
    <nav className="indicator-shortcuts" aria-label="자주 보는 지표">
      {navigationIndicators(asset, selected)
        .filter((d) => ids.includes(d.id))
        .map((d) => (
          <Link
            key={d.id}
            to={indicatorUrl(asset, d.id, params)}
            aria-current={selected === d.id ? 'page' : undefined}
          >
            {d.title}
          </Link>
        ))}
    </nav>
  );
}
