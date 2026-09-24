import type { Asset } from './types';
export type EventCategory = '탄생' | '업그레이드' | '거래소·위기' | '제도·채택' | '공급·반감기';
export interface HistoryEvent {
  id: string;
  date: string;
  precision?: 'month';
  title: string;
  summary: string;
  assets: Asset[];
  market?: boolean;
  category: EventCategory;
  source: string;
  sourceName: string;
}
const eth = 'https://ethereum.org/ethereum-forks/';
/** Editorially verified chronology, not an exhaustive list or a price-causality model. */
export const HISTORY_EVENTS: HistoryEvent[] = [
  {
    id: 'bitcoin-paper',
    date: '2008-10-31',
    title: '비트코인 백서 공개',
    summary: '사토시 나카모토가 암호학 메일링리스트에 P2P 전자화폐 논문을 공개했습니다.',
    assets: ['BTC'],
    category: '탄생',
    source: 'https://satoshi.nakamotoinstitute.org/emails/cryptography/1/',
    sourceName: '원문 메일 아카이브',
  },
  {
    id: 'bitcoin-genesis',
    date: '2009-01-03',
    title: '비트코인 제네시스 블록',
    summary: '비트코인의 첫 블록입니다. 네트워크 시작일과 시장 가격의 최초 관측일은 다릅니다.',
    assets: ['BTC'],
    category: '탄생',
    source: 'https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp',
    sourceName: 'Bitcoin Core 소스',
  },
  {
    id: 'xrp-launch',
    date: '2012-06-01',
    precision: 'month',
    title: 'XRP Ledger 출범',
    summary: 'XRP Ledger가 가동됐습니다. 공식 연혁은 출범 시점을 2012년 6월로 기록합니다.',
    assets: ['XRP'],
    category: '탄생',
    source: 'https://xrpl.org/about/history',
    sourceName: 'XRP Ledger',
  },
  {
    id: 'dogecoin-launch',
    date: '2013-12-06',
    title: '도지코인 출시',
    summary: '빌리 마커스와 잭슨 팔머가 Doge 밈에서 출발한 도지코인을 출시했습니다.',
    assets: ['DOGE'],
    category: '탄생',
    source: 'https://dogecoin.com/dogepedia/articles/history-of-dogecoin/',
    sourceName: 'Dogecoin 공식 역사',
  },
  {
    id: 'mtgox-rehabilitation',
    date: '2014-02-28',
    title: 'Mt. Gox 민사재생 신청',
    summary: '거래소 운영 중단과 자산 유실 문제 이후 도쿄지방법원에 민사재생 절차를 신청했습니다.',
    assets: ['BTC'],
    market: true,
    category: '거래소·위기',
    source: 'https://www.mtgox.com/img/pdf/20140228-announcement_eng.pdf',
    sourceName: 'Mt. Gox 당시 공지',
  },
  {
    id: 'ethereum-sale',
    date: '2014-07-22',
    title: '이더 판매 시작',
    summary: '이더 사전 판매가 시작됐습니다. 네트워크 가동은 다음 해 Frontier부터입니다.',
    assets: ['ETH'],
    category: '탄생',
    source: eth,
    sourceName: 'Ethereum 공식 연혁',
  },
  {
    id: 'ethereum-frontier',
    date: '2015-07-30',
    title: '이더리움 Frontier 가동',
    summary: '이더리움 네트워크의 첫 운영 단계가 시작됐습니다.',
    assets: ['ETH'],
    category: '탄생',
    source: eth,
    sourceName: 'Ethereum 공식 연혁',
  },
  {
    id: 'ethereum-homestead',
    date: '2016-03-14',
    title: '이더리움 Homestead',
    summary: '프로토콜과 네트워크 변경을 통해 후속 업그레이드의 기반을 마련했습니다.',
    assets: ['ETH'],
    category: '업그레이드',
    source: eth,
    sourceName: 'Ethereum 공식 연혁',
  },
  {
    id: 'chainlink-mainnet',
    date: '2019-05-30',
    title: 'Chainlink 이더리움 메인넷 출시',
    summary: '스마트 계약에 외부 데이터를 연결하는 Chainlink가 이더리움 메인넷에서 출시됐습니다.',
    assets: ['LINK'],
    category: '업그레이드',
    source: 'https://chain.link/blog/chainlink-connected-consensus-on-ethereum',
    sourceName: 'Chainlink 발표',
  },
  {
    id: 'solana-mainnet',
    date: '2020-03-01',
    precision: 'month',
    title: 'Solana Mainnet Beta 가동',
    summary:
      '검증인 커뮤니티와 함께 메인넷 베타가 시작됐습니다. 공식 회고에 따라 월 단위로 표시합니다.',
    assets: ['SOL'],
    category: '탄생',
    source: 'https://solana.com/news/year-in-review-2020',
    sourceName: 'Solana 공식 회고',
  },
  {
    id: 'microstrategy-bitcoin',
    date: '2020-08-11',
    title: 'MicroStrategy, BTC 재무자산 채택',
    summary:
      '마이클 세일러가 이끌던 MicroStrategy(현 Strategy)가 비트코인을 주요 재무준비자산으로 채택했다고 발표했습니다.',
    assets: ['BTC'],
    category: '제도·채택',
    source:
      'https://www.nasdaq.com/press-release/microstrategy-adopts-bitcoin-as-primary-treasury-reserve-asset-2020-08-11',
    sourceName: '회사 보도자료 · Nasdaq',
  },
  {
    id: 'terra-collapse',
    date: '2022-05-01',
    precision: 'month',
    title: 'TerraUSD 디페깅과 생태계 붕괴',
    summary:
      'UST의 달러 연동이 무너지고 관련 토큰 가격이 급락했습니다. 이후 SEC 자료에서 당시 경과를 확인할 수 있습니다.',
    assets: [],
    market: true,
    category: '거래소·위기',
    source: 'https://www.sec.gov/newsroom/press-releases/2024-73',
    sourceName: 'SEC 사후 발표',
  },
  {
    id: 'ethereum-merge',
    date: '2022-09-15',
    title: '이더리움 The Merge',
    summary: '이더리움의 합의 방식이 작업증명에서 지분증명으로 전환됐습니다.',
    assets: ['ETH'],
    category: '업그레이드',
    source: eth,
    sourceName: 'Ethereum 공식 연혁',
  },
  {
    id: 'ftx-bankruptcy',
    date: '2022-11-11',
    title: 'FTX 파산보호 신청',
    summary:
      'FTX 그룹의 Chapter 11 절차가 시작됐습니다. 고객 청구 자료도 이날을 신청일 기준으로 사용합니다.',
    assets: [],
    market: true,
    category: '거래소·위기',
    source: 'https://support.ftx.com/hc/en-us/articles/19464725450260-Derivative-Positions',
    sourceName: 'FTX 고객 청구 안내',
  },
  {
    id: 'ethereum-shapella',
    date: '2023-04-12',
    title: '이더리움 Shapella',
    summary: '스테이킹한 ETH의 출금 기능이 활성화됐습니다.',
    assets: ['ETH'],
    category: '업그레이드',
    source: eth,
    sourceName: 'Ethereum 공식 연혁',
  },
  {
    id: 'ondo-unlock-proposal',
    date: '2023-12-27',
    title: 'ONDO 양도 제한 해제 제안',
    summary: 'Ondo Foundation이 ONDO 토큰 양도 제한 해제를 위한 거버넌스 제안을 공개했습니다.',
    assets: ['ONDO'],
    category: '제도·채택',
    source: 'https://blog.ondo.foundation/unlocking-ondo-a-proposal-from-the-ondo-foundation/',
    sourceName: 'Ondo Foundation',
  },
  {
    id: 'bitcoin-etp',
    date: '2024-01-10',
    title: '미국 현물 비트코인 ETP 승인',
    summary:
      'SEC가 복수의 현물 비트코인 ETP 상장·거래 규칙을 승인했습니다. 비트코인 자체에 대한 보증은 아닙니다.',
    assets: ['BTC'],
    category: '제도·채택',
    source:
      'https://www.sec.gov/newsroom/speeches-statements/gensler-statement-spot-bitcoin-011023',
    sourceName: 'SEC 승인 성명',
  },
  {
    id: 'ondo-trading',
    date: '2024-01-18',
    title: 'ONDO 거래 개시',
    summary:
      'MEXC가 ONDO/USDT 거래 개시 시각을 공지했습니다. 토큰 거래 시작과 프로젝트 설립은 구분합니다.',
    assets: ['ONDO'],
    category: '제도·채택',
    source:
      'https://www.mexc.com/announcements/article/initial-listing-mexc-will-list-ondo-foundation-ondo-in-assessment-zone-17827791512880',
    sourceName: 'MEXC 상장 공지',
  },
  {
    id: 'ethereum-dencun',
    date: '2024-03-13',
    title: '이더리움 Dencun',
    summary: '블롭 데이터 거래를 도입해 롤업 데이터 게시 비용을 낮추는 기반을 마련했습니다.',
    assets: ['ETH'],
    category: '업그레이드',
    source: eth,
    sourceName: 'Ethereum 공식 연혁',
  },
  {
    id: 'robinhood-pepe',
    date: '2024-11-13',
    title: 'Robinhood, PEPE·SOL·XRP 지원 확대',
    summary: 'Robinhood가 미국 고객 대상 PEPE·SOL·XRP 등의 거래 지원을 발표했습니다.',
    assets: ['PEPE', 'SOL', 'XRP'],
    category: '제도·채택',
    source:
      'https://robinhood.com/us/en/newsroom/robinhood-crypto-expands-offering-with-solana-sol-pepe-pepe-cardano-ada-amp-xrp-xrp-for-u-s-customers/',
    sourceName: 'Robinhood 발표',
  },
  {
    id: 'btc-halving-1',
    date: '2012-11-28',
    title: '비트코인 1차 반감기',
    summary:
      '블록 210,000에서 신규 블록 보조금이 50 BTC에서 25 BTC로 줄었습니다. 공급 규칙의 변화이며 가격 상승을 보장하지 않습니다.',
    assets: ['BTC'],
    category: '공급·반감기',
    source: 'https://www.sec.gov/Archives/edgar/data/1640384/000119312525197208/d79633dars.pdf',
    sourceName: '채굴기업 연차보고서 · SEC 제출',
  },
  {
    id: 'btc-halving-2',
    date: '2016-07-09',
    title: '비트코인 2차 반감기',
    summary:
      '블록 420,000에서 신규 블록 보조금이 25 BTC에서 12.5 BTC로 줄었습니다. 공급 규칙의 변화이며 가격 상승을 보장하지 않습니다.',
    assets: ['BTC'],
    category: '공급·반감기',
    source: 'https://www.sec.gov/Archives/edgar/data/1640384/000119312525197208/d79633dars.pdf',
    sourceName: '채굴기업 연차보고서 · SEC 제출',
  },
  {
    id: 'btc-halving-3',
    date: '2020-05-11',
    title: '비트코인 3차 반감기',
    summary:
      '블록 630,000에서 신규 블록 보조금이 12.5 BTC에서 6.25 BTC로 줄었습니다. 공급 규칙의 변화이며 가격 상승을 보장하지 않습니다.',
    assets: ['BTC'],
    category: '공급·반감기',
    source: 'https://www.sec.gov/Archives/edgar/data/1640384/000119312525197208/d79633dars.pdf',
    sourceName: '채굴기업 연차보고서 · SEC 제출',
  },
  {
    id: 'btc-halving-4',
    date: '2024-04-20',
    title: '비트코인 4차 반감기',
    summary:
      '블록 840,000에서 신규 블록 보조금이 6.25 BTC에서 3.125 BTC로 줄었습니다. 공급 규칙의 변화이며 가격 상승을 보장하지 않습니다.',
    assets: ['BTC'],
    category: '공급·반감기',
    source: 'https://www.sec.gov/Archives/edgar/data/1640384/000119312525197208/d79633dars.pdf',
    sourceName: '채굴기업 연차보고서 · SEC 제출',
  },
  {
    id: 'doge-auxpow',
    date: '2014-09-11',
    title: '도지코인 병합 채굴 활성화',
    summary:
      '블록 371,337에서 AuxPoW가 활성화됐습니다. 같은 Scrypt 작업증명을 활용하는 병합 채굴로 채굴 구조가 바뀌었습니다.',
    assets: ['DOGE'],
    category: '업그레이드',
    source: 'https://github.com/dogecoin/dogecoin/discussions/3404',
    sourceName: 'Dogecoin Core 개발 기록',
  },
  {
    id: 'doge-coinbase',
    date: '2021-06-01',
    title: 'Coinbase Pro, DOGE 지원 발표',
    summary:
      'Coinbase Pro가 DOGE 입금을 열고 유동성 조건 충족 시 6월 3일 이후 거래를 시작할 계획을 발표했습니다.',
    assets: ['DOGE'],
    category: '제도·채택',
    source: 'https://www.coinbase.com/blog/dogecoin-doge-is-launching-on-coinbase-pro',
    sourceName: 'Coinbase 발표',
  },
  {
    id: 'eth-dao-fork',
    date: '2016-07-20',
    title: 'DAO 대응 하드포크 완료',
    summary: 'DAO 사건 대응을 위한 하드포크가 완료됐고 복구 계약을 통한 자산 반환이 시작됐습니다.',
    assets: ['ETH'],
    category: '거래소·위기',
    source: 'https://blog.ethereum.org/2016/07/20/hard-fork-completed',
    sourceName: 'Ethereum Foundation 발표',
  },
  {
    id: 'eth-london',
    date: '2021-08-05',
    title: 'London · EIP-1559 도입',
    summary:
      '기본 수수료와 우선 수수료를 구분하는 EIP-1559가 적용되며 거래 수수료 구조가 바뀌었습니다.',
    assets: ['ETH'],
    category: '업그레이드',
    source: 'https://ethereum.org/ethereum-forks/',
    sourceName: 'Ethereum 공식 연혁',
  },
];
export const eventTime = (event: HistoryEvent) => Date.parse(event.date + 'T00:00:00Z') / 1000;
export function eventsForAsset(asset: Asset, market = true) {
  return HISTORY_EVENTS.filter((e) => e.assets.includes(asset) || (market && e.market)).sort(
    (a, b) => a.date.localeCompare(b.date),
  );
}
