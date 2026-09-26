import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { saved, save } from './lib';
import { selectedMarket } from '../shared/coin-search';
import type { Market } from '../shared/types';
export function useMarket() {
  const [params, setParams] = useSearchParams();
  const market = selectedMarket(params.get('market'), saved<Market>('price-market', 'binance'));
  useEffect(() => {
    save('price-market', market);
  }, [market]);
  const changeMarket = (value: Market) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('market', value);
        return next;
      },
      { replace: false },
    );
  return { market, changeMarket };
}
