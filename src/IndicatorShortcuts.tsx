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
  const ids = ['view:price', 'net:mvrv', 'rsi', 'futures:funding'];
  const definitions = navigationIndicators(asset, selected);
  if (!ids.includes(selected) && definitions.some((d) => d.id === selected)) ids.push(selected);
  return (
    <nav className="indicator-shortcuts" aria-label="자주 보는 지표">
      {ids
        .map((id) => definitions.find((d) => d.id === id))
        .filter((d) => !!d)
        .map((d) => (
          <Link
            key={d.id}
            to={indicatorUrl(asset, d.id, params)}
            aria-current={selected === d.id ? 'page' : undefined}
          >
            {(
              {
                'view:price': '가격',
                'net:mvrv': 'MVRV',
                'view:rainbow': '가격 위치',
                'view:btc_rainbow': '레인보우',
                rsi: 'RSI',
                'futures:funding': '펀딩률',
              } as Record<string, string>
            )[d.id] ?? d.title}
          </Link>
        ))}
    </nav>
  );
}
