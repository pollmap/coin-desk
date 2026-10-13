import { Link } from 'react-router-dom';
import { navigationIndicators } from '../shared/indicator-catalog';
import { indicatorFamily, indicatorUrl } from '../shared/indicator-catalog';
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
  const ids = ['view:price', 'net:mvrv', 'view:supertrend'];
  const definitions = navigationIndicators(asset, selected);
  return (
    <nav className="indicator-shortcuts" aria-label="자주 보는 지표">
      {ids
        .map((id) => definitions.find((d) => indicatorFamily(d.id) === indicatorFamily(id)))
        .filter((d) => !!d)
        .map((d) => (
          <Link
            key={d.id}
            to={selected === d.id ? `/coins/${asset}?${params}` : indicatorUrl(asset, d.id, params)}
            aria-current={selected === d.id ? 'page' : undefined}
            onClick={(event) => {
              if (
                selected === d.id &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              )
                event.preventDefault();
            }}
          >
            {(
              {
                'view:price': '가격',
                'net:mvrv': 'MVRV',
                'btc:mvrv': 'MVRV',
                'view:supertrend': '슈퍼트렌드',
              } as Record<string, string>
            )[d.id] ?? d.title}
          </Link>
        ))}
    </nav>
  );
}
