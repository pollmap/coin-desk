import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DerivativesPanel } from './DerivativesPanel';
import { AssetHeader } from './AssetHeader';

export function FuturesPage() {
  const [params] = useSearchParams();
  const id = useParams().asset?.toUpperCase();
  if (id !== 'BTC' && id !== 'DOGE' && id !== 'ETH')
    return (
      <div className="empty-state">
        지원하지 않는 선물입니다. <Link to="/futures/BTC">BTC 선물</Link>
      </div>
    );
  return (
    <>
      <AssetHeader
        asset={id}
        current="futures"
        subtitle="선물 · Bybit USDT 무기한 계약"
        assets={['BTC', 'DOGE', 'ETH']}
        href={(asset) =>
          '/futures/' +
          asset +
          '?' +
          new URLSearchParams({
            metric: params.get('metric') || 'funding',
            interval: params.get('interval') || '1d',
          })
        }
      />
      <DerivativesPanel key={id} asset={id} dedicated />
    </>
  );
}
