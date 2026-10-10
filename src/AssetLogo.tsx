import { useState, type CSSProperties } from 'react';
import type { Asset } from '../shared/types';
import { assetDefinition } from '../shared/asset-registry';
import './asset-logo.css';

export function AssetLogo({ asset, size = 24 }: { asset: Asset; size?: number }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = assetDefinition(asset)?.logo;
  const dimensions = { '--asset-logo-size': size + 'px' } as CSSProperties;
  if (!source || failedSource === source)
    return (
      <span
        className="asset-logo fallback"
        style={{ ...dimensions, fontSize: Math.min(12, size * 0.4) }}
        data-asset={asset}
        aria-hidden="true"
      >
        {asset.slice(0, 2)}
      </span>
    );
  return (
    <img
      className="asset-logo"
      style={dimensions}
      src={source}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      data-asset={asset}
      key={source}
      onError={() => setFailedSource(source)}
    />
  );
}
