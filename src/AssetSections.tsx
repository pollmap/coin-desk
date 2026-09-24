import { useMarket } from './useMarket';
import { Link, useSearchParams } from 'react-router-dom';
import type { Asset } from '../shared/types';

export function AssetSections({ asset, current }: { asset: Asset; current: string }) {
  const [params] = useSearchParams();
  const { market } = useMarket();
  const context = new URLSearchParams({ market, period: params.get('period') || 'all' });
  for (const key of ['log', 'interval', 'indicators'])
    if (params.has(key)) context.set(key, params.get(key)!);
  const sections = [
    { id: 'history', label: '전체 가격', to: '/?asset=' + asset + '&' + context },
    { id: 'chart', label: '기술적 분석', to: '/chart/' + asset + '?' + context },
    { id: 'onchain', label: '온체인', to: '/onchain/' + asset + '?' + context },
    { id: 'futures', label: '선물', to: '/futures/' + asset + '?' + context },
    { id: 'dominance', label: '도미넌스', to: '/dominance?asset=' + asset },
    { id: 'research', label: '리서치', to: '/research?asset=' + asset },
    { id: 'events', label: '역사', to: '/history?asset=' + asset },
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
