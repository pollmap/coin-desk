import { Link } from 'react-router-dom';
import { ListFilter, ArrowLeftRight, ChartPie } from 'lucide-react';
import type { Market } from '../shared/types';

/** The same three destinations, in the same order, throughout the market workspace. */
export function MarketNavigation({
  current,
  market,
  assets = ['BTC', 'DOGE', 'ETH'],
}: {
  current: 'coins' | 'compare' | 'dominance';
  market: Market;
  assets?: string[];
}) {
  const query = new URLSearchParams({ market });
  return (
    <nav className="market-navigation" aria-label="시장 분석">
      {[
        { id: 'coins', label: '코인 시세', icon: ListFilter, url: '/coins?' + query },
        {
          id: 'compare',
          label: '성과 비교',
          icon: ArrowLeftRight,
          url:
            '/compare?' + new URLSearchParams({ market, assets: assets.join(','), period: 'all' }),
        },
        { id: 'dominance', label: '시장 비중', icon: ChartPie, url: '/dominance?' + query },
      ].map(({ id, label, icon: Icon, url }) => (
        <Link key={id} to={url} aria-current={current === id ? 'page' : undefined}>
          <Icon size={17} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
