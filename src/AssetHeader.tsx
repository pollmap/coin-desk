import { useEffect } from 'react';
import { save } from './lib';
import { useNavigate } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import type { Asset } from '../shared/types';
import { AssetLogo } from './AssetLogo';
import { AssetSections } from './AssetSections';

/** One coin selector and one section navigation on every coin page. */
export function AssetHeader({
  asset,
  current,
  subtitle,
  assets = ASSETS.map((a) => a.id),
  href,
}: {
  asset: Asset;
  current: string;
  subtitle: string;
  assets?: readonly Asset[];
  href: (asset: Asset) => string;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    save('lastAsset', asset);
  }, [asset]);
  const coin = ASSETS.find((a) => a.id === asset)!;
  return (
    <div className="asset-header">
      <div className="asset-heading">
        <AssetLogo asset={asset} size={34} />
        <div className="asset-heading-name">
          <h1>
            {coin.name} <span>{asset}</span>
          </h1>
          <p>{subtitle}</p>
        </div>
        <label className="asset-select-label">
          <span>코인 변경</span>
          <select
            aria-label="분석 코인 선택"
            value={asset}
            onChange={(e) => navigate(href(e.target.value as Asset))}
          >
            {ASSETS.filter((a) => assets.includes(a.id)).map((a) => (
              <option value={a.id} key={a.id}>
                {a.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <AssetSections asset={asset} current={current} />
    </div>
  );
}
