import { useEffect, useRef, useState } from 'react';
import { save } from './lib';
import { Link, useNavigate } from 'react-router-dom';
import { ASSETS, isPrimaryAsset } from '../shared/catalog';
import { COIN_SITES, matchesCoin } from '../shared/coin-search';
import type { Asset } from '../shared/types';
import { AssetLogo } from './AssetLogo';
import { AssetSections } from './AssetSections';
import { useMarket } from './useMarket';

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
  const { market } = useMarket();
  const target = (next: Asset) => {
    const url = new URL(
      assets.includes(next) ? href(next) : '/?asset=' + next + '&period=all',
      'https://coin-desk.invalid',
    );
    if (!url.searchParams.has('market')) url.searchParams.set('market', market);
    return url.pathname + url.search + url.hash;
  };
  const [query, setQuery] = useState('');
  const picker = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    save('lastAsset', asset);
    setQuery('');
    if (picker.current) picker.current.open = false;
  }, [asset]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (picker.current?.open && !picker.current.contains(event.target as Node))
        picker.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  const coin = ASSETS.find((a) => a.id === asset)!;
  const results = ASSETS.filter((a) => matchesCoin(a.id, query));
  return (
    <div className="asset-header">
      <div className="coin-context">
        <details
          className="coin-picker"
          ref={picker}
          onToggle={(e) => {
            if (e.currentTarget.open) e.currentTarget.querySelector('input')?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && picker.current) {
              picker.current.open = false;
              picker.current.querySelector('summary')?.focus();
            }
          }}
        >
          <summary aria-label={'코인 변경 · ' + coin.name + ' ' + asset}>
            <AssetLogo asset={asset} size={42} />
            <span>
              <small>코인 선택</small>
              <h1>
                {coin.name} <b>{asset}</b>
              </h1>
            </span>
            <span className="coin-chevron">⌄</span>
          </summary>
          <div className="coin-popover">
            <input
              type="search"
              aria-label="코인 검색"
              placeholder="BTC, 비트, 도지…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  picker.current
                    ?.querySelector<HTMLButtonElement>('.coin-result-list button')
                    ?.focus();
                }
                if (e.key === 'Enter' && results.length === 1) {
                  e.preventDefault();
                  navigate(target(results[0].id));
                  if (picker.current) picker.current.open = false;
                }
              }}
            />
            <div className="coin-result-list">
              {results.map((item) => (
                <button
                  key={item.id}
                  className={isPrimaryAsset(item.id) ? 'primary-coin' : 'secondary-coin'}
                  aria-pressed={item.id === asset}
                  onClick={() => {
                    if (picker.current) {
                      picker.current.open = false;
                      picker.current.querySelector('summary')?.focus();
                    }
                    setQuery('');
                    navigate(target(item.id));
                  }}
                >
                  <AssetLogo asset={item.id} size={28} />
                  <strong>{item.name}</strong>
                  <span>{item.id}</span>
                  {item.id === asset && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              {!results.length && (
                <p role="status">검색 결과가 없습니다. 티커나 코인 이름을 입력해 주세요.</p>
              )}
            </div>
          </div>
        </details>
        <div className="coin-context-links">
          <p>{subtitle}</p>
          <a href={COIN_SITES[asset]} target="_blank" rel="noreferrer">
            {asset} 공식 사이트 ↗
          </a>
        </div>
        <div className="coin-shortcuts" aria-label="자주 보는 코인">
          {(['BTC', 'DOGE', 'ETH'] as Asset[]).map((a) => (
            <Link key={a} to={target(a)} className={a === asset ? 'active' : ''}>
              <AssetLogo asset={a} size={21} />
              {a}
            </Link>
          ))}
        </div>
      </div>
      <AssetSections asset={asset} current={current} />
    </div>
  );
}
