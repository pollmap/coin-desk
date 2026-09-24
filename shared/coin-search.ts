import { ASSETS } from './catalog';
import type { Asset, Market } from './types';
export const COIN_ALIASES: Record<Asset, string[]> = {
  BTC: ['bitcoin', '비트', '비트코인', '비코', '비트 코인'],
  DOGE: ['dogecoin', '도지', '도지코인', '도지 코인'],
  ETH: ['ethereum', 'ether', '이더', '이더리움'],
  SOL: ['solana', '솔', '솔라나'],
  XRP: ['ripple', '리플', '엑스알피'],
  LINK: ['chainlink', '체인링크', '체링', '링크'],
  ONDO: ['ondo finance', '온도', '온도파이낸스'],
  PEPE: ['페페', 'pepecoin'],
};
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_/$]/g, '');
export function matchesCoin(asset: Asset, query: string): boolean {
  const q = normalize(query);
  if (!q || ['코인', 'coin', 'crypto', '암호화폐', '가상자산', '가상화폐'].includes(q)) return true;
  const coin = ASSETS.find((item) => item.id === asset)!;
  return [coin.id, coin.name, ...COIN_ALIASES[asset]].some((name) => normalize(name).includes(q));
}
export function selectedMarket(query: string | null, previous: unknown): Market {
  return query === 'upbit' || query === 'binance'
    ? query
    : previous === 'upbit'
      ? 'upbit'
      : 'binance';
}
export const COIN_SITES: Record<Asset, string> = {
  BTC: 'https://bitcoin.org',
  DOGE: 'https://dogecoin.com',
  ETH: 'https://ethereum.org',
  SOL: 'https://solana.com',
  XRP: 'https://xrpl.org',
  LINK: 'https://chain.link',
  ONDO: 'https://ondo.finance',
  PEPE: 'https://www.pepe.vip',
};
