import { Link } from 'react-router-dom';
import { ASSETS } from '../shared/catalog';
import type { Asset, Market, Overview } from '../shared/types';
import { useData } from './hooks';
import { dateLabel, money, numeric } from './lib';
import { AssetLogo } from './AssetLogo';
import './analysis-expansion.css';

const featured: Asset[] = ['BTC', 'DOGE', 'ETH'];

function FeaturedCard({
  asset,
  selected,
  market,
  href,
}: {
  asset: Asset;
  selected: boolean;
  market: Market;
  href: string;
}) {
  const result = useData<Overview>(
    `/api/v1/overview?asset=${asset}&market=${market}`,
    false,
    60000,
  );
  const coin = ASSETS.find((item) => item.id === asset)!;
  const quote = result.data?.quote;
  const currency = market === 'upbit' ? 'KRW' : 'USDT';
  return (
    <Link
      className={'featured-asset ' + (selected ? 'selected' : '')}
      to={href}
      aria-current={selected ? 'page' : undefined}
    >
      <span className="featured-title">
        <AssetLogo asset={asset} size={31} />
        <span>
          <b>{asset}</b>
          <small>{coin.name}</small>
        </span>
      </span>
      <strong>{money(quote?.price, currency)}</strong>
      <span
        className={
          'featured-change ' +
          (quote?.change24h == null ? '' : quote.change24h >= 0 ? 'up' : 'down')
        }
      >
        {quote?.change24h == null
          ? '24시간 변동 —'
          : `${quote.change24h >= 0 ? '+' : ''}${numeric(quote.change24h)}%`}
      </span>
      <small className="featured-asof">
        {result.error ? '시세 연결 지연' : `가격 기준 ${dateLabel(quote?.time, true)}`}
      </small>
    </Link>
  );
}

export function MainAssetDeck({
  asset,
  market,
  href,
}: {
  asset: Asset;
  market: Market;
  href: (asset: Asset) => string;
}) {
  return (
    <section className="main-asset-deck" aria-label="주요 코인">
      <div className="featured-assets">
        {featured.map((item) => (
          <FeaturedCard
            key={item}
            asset={item}
            selected={asset === item}
            market={market}
            href={href(item)}
          />
        ))}
      </div>
      <details className="secondary-assets">
        <summary>
          다른 코인 펼쳐보기 <span>SOL · XRP · LINK · ONDO · PEPE</span>
        </summary>
        <nav aria-label="다른 코인">
          {ASSETS.filter((item) => !featured.includes(item.id)).map((item) => (
            <Link
              key={item.id}
              to={href(item.id)}
              className={item.id === asset ? 'selected' : ''}
              aria-current={item.id === asset ? 'page' : undefined}
            >
              <AssetLogo asset={item.id} size={22} />
              <b>{item.id}</b>
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>
      </details>
    </section>
  );
}
