import { Link, useSearchParams } from 'react-router-dom';
import { ChartNoAxesCombined, Activity, ChartPie, ArrowLeftRight } from 'lucide-react';
import { assetLink, priceBasis } from '../shared/analysis-workspace';
import type { Asset } from '../shared/types';
export function AssetSections({ asset, current }: { asset: Asset; current: string }) {
  const [params] = useSearchParams();
  const context = new URLSearchParams(params);
  context.set('asset', asset);
  context.set('price_source', priceBasis(params));
  const sections = [
    { id: 'history', label: '가격·기술', path: '/', Icon: ChartNoAxesCombined },
    { id: 'onchain', label: '온체인', path: '/onchain/' + asset, Icon: Activity },
    { id: 'futures', label: '선물', path: '/futures/' + asset, Icon: ArrowLeftRight },
    { id: 'dominance', label: '시장 비중', path: '/dominance', Icon: ChartPie },
  ];
  return (
    <nav className="asset-sections" aria-label={asset + ' 분석 화면'}>
      {sections.map(({ id, label, path, Icon }) => {
        const q = new URLSearchParams(context);
        if (id !== current) {
          q.delete('panels');
          q.delete('metric');
          q.delete('signal');
          q.delete('visual');
        }
        return (
          <Link
            key={id}
            to={assetLink(path, asset, q)}
            className={(current === 'chart' ? 'history' : current) === id ? 'selected' : ''}
            aria-current={(current === 'chart' ? 'history' : current) === id ? 'page' : undefined}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
