import type { Asset } from './types';
import { RESEARCH_AUTHORS } from './research';

export interface PublicSource {
  id: string;
  name: string;
  url: string;
  kind: 'x' | 'video' | 'official';
  handle?: string;
  assets: Asset[];
  hosts: string[];
}
export const PUBLIC_SOURCES: PublicSource[] = [
  {
    id: 'ethereum',
    name: 'Ethereum Foundation',
    url: 'https://blog.ethereum.org/en/feed.xml',
    kind: 'official',
    assets: ['ETH'],
    hosts: ['blog.ethereum.org'],
  },
  {
    id: 'solana',
    name: 'Solana',
    url: 'https://solana.com/news/rss.xml',
    kind: 'official',
    assets: ['SOL'],
    hosts: ['solana.com'],
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin Core',
    url: 'https://bitcoin.org/en/rss/releases.rss',
    kind: 'official',
    assets: ['BTC'],
    hosts: ['bitcoin.org', 'bitcoincore.org'],
  },
  {
    id: 'cat-video',
    name: 'Cantonese Cat',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCty4n3i_1WUdtoJyxHJ6xmQ',
    kind: 'video',
    handle: 'cantonmeow',
    assets: [],
    hosts: ['www.youtube.com', 'youtube.com'],
  },
  {
    id: 'mattsby-video',
    name: 'The Great Mattsby',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCTrwtSCIyCC5zTcNlVWJddg',
    kind: 'video',
    handle: 'GreatMattsby',
    assets: [],
    hosts: ['www.youtube.com', 'youtube.com'],
  },
  ...RESEARCH_AUTHORS.map((a) => ({
    id: 'x-' + a.handle,
    name: a.name,
    url: 'https://x.com/' + a.handle,
    kind: 'x' as const,
    handle: a.handle,
    assets: [] as Asset[],
    hosts: ['x.com'],
  })),
];
export interface PublicPost {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: number;
  assets: Asset[];
  kind: PublicSource['kind'];
  media: boolean;
}
export interface PublicSourceState {
  failures?: number;
  nextAttemptAt?: number;
  id: string;
  state: 'ready' | 'error' | 'pending';
  attemptedAt: number | null;
  fetchedAt: number | null;
  posts: PublicPost[];
  error?: string;
}
export interface PublicResearchFeed {
  posts: PublicPost[];
  sources: Omit<PublicSourceState, 'posts'>[];
  cadenceSeconds: number;
  independentOfVisitors: boolean;
}
