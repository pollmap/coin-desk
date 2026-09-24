import type { Asset } from './types';
export interface ResearchAuthor {
  handle: string;
  name: string;
  website?: string;
  youtube?: string;
}
/** User supplied roster, deduplicated case-insensitively. Not a verification badge. */
export const RESEARCH_AUTHORS: ResearchAuthor[] = [
  {
    handle: 'cantonmeow',
    name: 'Cantonese Cat',
    website: 'https://cantonmeow.com',
    youtube: 'https://youtube.com/@cantonmeow',
  },
  {
    handle: 'DanCoinInvestor',
    name: 'Dan Coin Investor',
  },
  {
    handle: 'MenthorQpro',
    name: 'Menthor Q',
  },
  {
    handle: 'Osemka8',
    name: 'Osemka',
  },
  {
    handle: 'TimeFreedomROB',
    name: 'Time Freedom',
  },
  {
    handle: 'Cryptollica',
    name: 'Cryptollica',
  },
  {
    handle: 'SuperBitcoinBro',
    name: 'Super฿ro',
  },
  {
    handle: 'Crypto_R0D',
    name: 'Rod',
  },
  {
    handle: 'MaeliusCrypto',
    name: 'Maelius',
  },
  {
    handle: 'Astro1062',
    name: 'Astro',
  },
  {
    handle: 'Balboa_365',
    name: 'Roel Balboa',
  },
  {
    handle: 'hamptonism',
    name: 'hampton',
  },
  {
    handle: 'quantdata21',
    name: 'quantdata21',
  },
  {
    handle: 'CryptofyHub',
    name: 'Cryptofy Hub.alts',
  },
  {
    handle: 'ChartingGuy',
    name: 'Charting Guy',
  },
  {
    handle: 'EWcycles',
    name: 'EWT',
  },
  {
    handle: 'WorldOfCharts1',
    name: 'World Of Charts',
  },
  {
    handle: 'MELORICH_KOREA',
    name: '멜로리치',
  },
  {
    handle: 'StockmoneyL',
    name: 'Stockmoney Lizards',
  },
  {
    handle: 'castlehousetoo',
    name: 'Castlehouse',
  },
  {
    handle: 'GMB_Coinangel',
    name: '코인추천요정',
  },
  {
    handle: 'Morecryptoonl',
    name: 'More Crypto Online',
  },
  {
    handle: 'BitQua',
    name: 'BitQuant',
  },
  {
    handle: 'CW8900',
    name: 'CW',
  },
  {
    handle: 'Bobby_1111888',
    name: 'Bobby A',
  },
  {
    handle: 'JamesEastonUK',
    name: 'James',
  },
  {
    handle: '_ys_clan',
    name: '코인엘리트',
  },
  {
    handle: 'MichaelXBT',
    name: 'Crypto Michael',
  },
  {
    handle: 'CryptoJelleNL',
    name: 'Jelle',
  },
  {
    handle: 'TechDev_52',
    name: 'TechDev',
  },
  {
    handle: 'btc_MasterPlan',
    name: 'Master Kenobi',
  },
  {
    handle: 'brettmacro',
    name: 'Brett',
  },
  {
    handle: 'Dark64',
    name: 'Olivier D.',
  },
  {
    handle: 'Crypto_UB3R',
    name: 'Sait Bakırel',
  },
  {
    handle: 'GreatMattsby',
    name: 'The Great Mattsby',
    youtube: 'https://youtube.com/@TGMTrading',
  },
  {
    handle: 'clayop',
    name: '조재우',
  },
  {
    handle: 'willywoo',
    name: 'Willy Woo',
  },
];
export const RESEARCH_LIST_ID = '1940844025483088368';
export const RESEARCH_LIST_URL = `https://x.com/i/lists/${RESEARCH_LIST_ID}`;
export function authorSearch(handle: string, asset: Asset | 'all') {
  const query = `from:${handle}` + (asset === 'all' ? '' : ` ($${asset} OR ${asset})`);
  return 'https://x.com/search?' + new URLSearchParams({ q: query, f: 'live' });
}
export interface ResearchPost {
  id: string;
  handle: string;
  publishedAt: number;
  url: string;
  assets: Asset[];
  media: boolean;
}
export interface ResearchFeed {
  state: 'disabled' | 'ready' | 'error' | 'pending';
  posts: ResearchPost[];
  fetchedAt: number | null;
  message?: string;
}
