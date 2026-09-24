import { Link } from 'react-router-dom';
import { isNetworkAsset } from '../shared/network-catalog';
import type { Asset } from '../shared/types';

export function AssetSections({ asset, current }: { asset: Asset; current: string }) {
  const sections = [
    { id: 'history', label: '전체 가격', to: '/?asset=' + asset + '&period=all' },
    { id: 'chart', label: '기술적 분석', to: '/chart/' + asset + '?period=all' },
    ...(isNetworkAsset(asset) ? [{ id: 'onchain', label: '온체인', to: '/onchain/' + asset }] : []),
    ...(['BTC', 'DOGE', 'ETH'].includes(asset)
      ? [{ id: 'futures', label: '선물', to: '/futures/' + asset }]
      : []),
  ];
  return (
    <nav className="asset-sections" aria-label={asset + ' 분석 화면'}>
      {sections.map((item) => (
        <Link
          key={item.id}
          to={item.to}
          className={current === item.id ? 'selected' : ''}
          aria-current={current === item.id ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
