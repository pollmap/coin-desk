import { useState } from 'react';
import type { Asset } from '../shared/types';
import { ASSETS } from '../shared/catalog';
import './asset-logo.css';

export function AssetLogo({ asset, size = 24 }: { asset: Asset; size?: number }) {
  const [failedAsset, setFailedAsset] = useState<Asset | null>(null);
  const item = ASSETS.find((entry) => entry.id === asset);
  if (!item || failedAsset === asset)
    return (
      <span
        className="asset-logo fallback"
        style={{ width: size, height: size, background: item?.color }}
        aria-hidden="true"
      >
        {asset[0]}
      </span>
    );
  return (
    <img
      className="asset-logo"
      src={item.logo}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      key={asset}
      onError={() => setFailedAsset(asset)}
    />
  );
}
