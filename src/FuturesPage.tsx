import { Link, useParams } from 'react-router-dom';
import { DerivativesPanel } from './DerivativesPanel';
import { AssetLogo } from './AssetLogo';
import { AssetSections } from './AssetSections';

export function FuturesPage() {
  const id = useParams().asset?.toUpperCase();
  if (id !== 'BTC' && id !== 'DOGE' && id !== 'ETH')
    return (
      <div className="empty-state">
        지원하지 않는 선물입니다. <Link to="/futures/BTC">BTC 선물</Link>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <h1>{id} 선물</h1>
        <span>Bybit · USDT 무기한 계약</span>
      </div>
      <nav className="asset-switcher" aria-label="선물 코인 선택">
        {(['BTC', 'DOGE', 'ETH'] as const).map((asset) => (
          <Link
            key={asset}
            to={'/futures/' + asset}
            className={asset === id ? 'selected' : ''}
            aria-current={asset === id ? 'page' : undefined}
          >
            <AssetLogo asset={asset} size={19} />
            <b>{asset}</b>
          </Link>
        ))}
      </nav>
      <AssetSections asset={id} current="futures" />
      <DerivativesPanel key={id} asset={id} dedicated />
    </>
  );
}
