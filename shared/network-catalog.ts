import type { Asset } from './types';

export const NETWORK_ASSETS = ['BTC', 'DOGE', 'ETH', 'XRP', 'LINK'] as const;
export type NetworkAsset = (typeof NETWORK_ASSETS)[number];
export const NETWORK_SOURCE = 'Coin Metrics Community · CC BY-NC 4.0';
export const NETWORK_VERSION = 'coinmetrics-network-monthly-v2';
export const NETWORK_HISTORY: Record<NetworkAsset, string> = {
  BTC: '2009-01-03',
  DOGE: '2013-12-08',
  ETH: '2015-07-30',
  XRP: '2013-01-01',
  LINK: '2017-09-16',
};
export interface NetworkMetric {
  id: string;
  title: string;
  unit: string;
  description: string;
  formula: string;
  source: string;
  sourceMetric?: string;
  derived?: boolean;
  assets: readonly Asset[];
}
const all = NETWORK_ASSETS;
const definition = 'https://docs.coinmetrics.io/network-data/network-data-overview/';
export const NETWORK_METRICS: readonly NetworkMetric[] = [
  {
    id: 'mvrv',
    title: 'MVRV',
    unit: '배',
    sourceMetric: 'CapMVRVCur',
    assets: all,
    description:
      '현재 원장 공급 기준 시가총액을 실현시가총액과 비교합니다. 1은 두 총액이 같은 지점이며 특정 가격의 매수·매도 신호는 아닙니다. BTC Bitview 지표와 원천·산식 세부가 달라 직접 이어 붙이지 않습니다.',
    formula: 'Coin Metrics CapMVRVCur = CapMrktCurUSD / CapRealUSD',
    source: definition + 'market/market-capitalization',
  },
  {
    id: 'active_addresses',
    title: '활성 주소',
    unit: '주소 / 일',
    sourceMetric: 'AdrActCnt',
    assets: all,
    description:
      '하루 동안 송수신 등 원장 활동이 관찰된 고유 주소 수입니다. 사람이나 실제 이용자 수가 아니며, 체인별 집계 규칙이 다릅니다.',
    formula: 'UTC 하루 동안 활동한 고유 주소의 수',
    source: definition + 'addresses/active-addresses',
  },
  {
    id: 'balance_addresses',
    title: '잔고 보유 주소',
    unit: '주소',
    sourceMetric: 'AdrBalCnt',
    assets: all,
    description:
      '해당 자산의 양수 잔고를 가진 주소 수입니다. 한 사람이 여러 주소를 쓸 수 있으며 거래소 한 주소에 여러 고객의 자산이 모일 수 있습니다.',
    formula: 'UTC 일말 잔고가 0보다 큰 주소 수',
    source: 'https://coverage.coinmetrics.io/asset-metrics/AdrBalCnt',
  },
  {
    id: 'transactions',
    title: '거래 수',
    unit: '건 / 일',
    sourceMetric: 'TxCnt',
    assets: all,
    description:
      '하루 동안 원장에 기록된 거래 수입니다. 거래소 매매 횟수가 아닙니다. LINK는 토큰 관련 거래이며 ETH 전체 거래와 범위가 다릅니다.',
    formula: 'UTC 하루의 온체인 거래 수 · 원천의 체인별 포함 규칙',
    source: definition + 'transactions/transactions',
  },
  {
    id: 'transfers',
    title: '전송 수',
    unit: '건 / 일',
    sourceMetric: 'TxTfrCnt',
    assets: all,
    description:
      '자산이 이동한 전송 수입니다. 한 거래에 여러 전송이 포함될 수 있습니다. ETH는 ETH 전송으로, 모든 ERC-20 토큰 전송 합계가 아닙니다.',
    formula: 'UTC 하루의 양수 자산 전송 수 · 수수료와 신규 발행 제외',
    source: definition + 'transactions/transfers',
  },
  {
    id: 'supply',
    title: '현재 원장 공급량',
    unit: '자산 단위',
    sourceMetric: 'SplyCur',
    assets: all,
    description:
      '현재 원장에 존재하는 공급량입니다. 거래 가능한 유통량과 다릅니다. XRP 에스크로와 LINK의 잠긴 물량 등이 포함될 수 있습니다.',
    formula: 'Coin Metrics SplyCur · 원장 잔고 기준',
    source: definition + 'supply/current-supply',
  },
  {
    id: 'market_cap',
    title: '원장 공급 기준 시가총액',
    unit: 'USD',
    sourceMetric: 'CapMrktCurUSD',
    assets: all,
    description:
      '원장 공급량에 동일 원천의 USD 가격을 곱한 총액입니다. 유통량 기준 CoinGecko 등의 시가총액과 다릅니다.',
    formula: 'SplyCur × PriceUSD',
    source: definition + 'market/market-capitalization',
  },
  {
    id: 'fees_native',
    title: '총 거래 수수료',
    unit: '자산 단위 / 일',
    sourceMetric: 'FeeTotNtv',
    assets: ['BTC', 'DOGE', 'ETH', 'XRP'],
    description:
      '하루 동안 지불된 총 온체인 수수료로, 소각된 수수료도 포함합니다. ETH는 실행 수수료와 블롭 수수료를 포함합니다. 단가가 아닌 합계이며 LINK의 가스비는 ETH로 지불됩니다.',
    formula: 'UTC 하루의 거래 수수료 합계 (네이티브 단위)',
    source: definition + 'fees-and-revenue/fees',
  },
  {
    id: 'hashrate',
    title: '평균 해시레이트',
    unit: 'TH/s',
    sourceMetric: 'HashRate',
    assets: ['BTC', 'DOGE'],
    description:
      '난이도와 블록 간격으로 추정한 하루 평균 채굴 연산량입니다. BTC와 DOGE의 해시 함수가 달라 수치 크기만으로 보안을 직접 비교하지 않습니다.',
    formula: '원천의 난이도·블록 생성 간격 기반 추정 · 1 TH/s = 초당 10¹² 해시',
    source: definition + 'mining/hash-rate',
  },
  {
    id: 'blocks',
    title: '하루 생성 블록',
    unit: '블록 / 일',
    sourceMetric: 'BlkCnt',
    assets: ['BTC', 'DOGE', 'ETH'],
    description:
      'UTC 하루에 생성된 블록 수입니다. 체인별 블록 간격과 합의 방식이 달라 수치 크기를 직접 비교하지 않습니다.',
    formula: 'Coin Metrics BlkCnt · UTC 일별 블록 수',
    source: definition + 'blocks/blocks',
  },
  {
    id: 'issuance',
    title: '신규 발행량',
    unit: '자산 단위 / 일',
    sourceMetric: 'IssTotNtv',
    assets: ['BTC', 'DOGE', 'ETH'],
    description:
      'UTC 하루 동안 새로 발행된 자산의 수량입니다. 거래소 매수세나 순유입량이 아닙니다.',
    formula: 'Coin Metrics IssTotNtv · 신규 발행 자산 수량',
    source: definition + 'supply/total-issued-supply',
  },
  {
    id: 'exchange_inflow',
    title: '거래소 유입',
    unit: '자산 단위 / 일',
    sourceMetric: 'FlowInExNtv',
    assets: ['BTC', 'ETH'],
    description:
      '원천이 거래소로 식별한 주소에 하루 동안 유입된 수량입니다. 거래소 주소 분류가 바뀌면 과거 값도 수정될 수 있습니다. 전체 거래소와 모든 지갑을 완전히 포괄하지 않습니다.',
    formula: 'Coin Metrics FlowInExNtv',
    source: definition + 'exchange/exchange-flows',
  },
  {
    id: 'exchange_outflow',
    title: '거래소 유출',
    unit: '자산 단위 / 일',
    sourceMetric: 'FlowOutExNtv',
    assets: ['BTC', 'ETH'],
    description:
      '원천이 거래소로 식별한 주소에서 하루 동안 유출된 수량입니다. 분류 변경으로 과거 값이 수정될 수 있습니다.',
    formula: 'Coin Metrics FlowOutExNtv',
    source: definition + 'exchange/exchange-flows',
  },
  {
    id: 'exchange_balance',
    title: '거래소 보유량',
    unit: '자산 단위',
    sourceMetric: 'SplyExNtv',
    assets: ['BTC', 'ETH'],
    description:
      '원천이 거래소로 식별한 주소들의 추정 보유량입니다. 거래소 전체 보유량의 확정치가 아니며 주소 분류에 따라 수정될 수 있습니다.',
    formula: 'Coin Metrics SplyExNtv',
    source: definition + 'exchange/exchange-supply',
  },
  {
    id: 'exchange_netflow',
    title: '거래소 순유입 · 계산',
    unit: '자산 단위 / 일',
    derived: true,
    assets: ['BTC', 'ETH'],
    description:
      '같은 원천의 하루 거래소 유입량에서 유출량을 뺀 계산값입니다. 양수는 순유입이고 음수는 순유출입니다. 주소 분류 변경 시 다시 계산됩니다.',
    formula: 'FlowInExNtv − FlowOutExNtv',
    source: definition + 'exchange/exchange-flows',
  },
  {
    id: 'realized_cap',
    title: '실현시가총액 · 역산',
    unit: 'USD',
    derived: true,
    assets: all,
    description:
      '무료로 받은 시가총액과 MVRV에서 역산한 값입니다. CapRealUSD 원본을 직접 받은 값이나 별도 노드로 검산한 값이 아닙니다.',
    formula: 'CapMrktCurUSD / CapMVRVCur (MVRV > 0)',
    source: definition + 'market/market-capitalization',
  },
  {
    id: 'realized_price',
    title: '실현가격 · 역산',
    unit: 'USD',
    derived: true,
    assets: all,
    description:
      '동일 원천 USD 가격을 MVRV로 나눈 공급량당 실현 가치입니다. 개인의 실제 평균 매수가를 의미하지 않습니다.',
    formula: 'PriceUSD / CapMVRVCur (MVRV > 0)',
    source: definition + 'market/market-capitalization',
  },
  {
    id: 'nupl',
    title: 'NUPL · 역산',
    unit: '비율',
    derived: true,
    assets: all,
    description:
      'MVRV에서 역산한 미실현 손익 비율입니다. 0.25는 25%이며 음수도 가능합니다. 개별 보유자의 실제 손익 분포와는 다릅니다.',
    formula: '1 − 1 / CapMVRVCur (MVRV > 0)',
    source: definition + 'market/market-capitalization',
  },
];
export const isNetworkAsset = (asset: string): asset is NetworkAsset =>
  NETWORK_ASSETS.some((item) => item === asset);
export const getNetworkMetric = (id: string) => NETWORK_METRICS.find((item) => item.id === id);
export const networkMetrics = (asset: Asset) =>
  NETWORK_METRICS.filter((item) => item.assets.includes(asset));
export const networkMetric = (asset: Asset, id: string) =>
  networkMetrics(asset).find((item) => item.id === id);
export const NETWORK_GROUPS = [
  { title: '가치 · 손익', ids: ['mvrv', 'realized_cap', 'realized_price', 'nupl'] },
  {
    title: '이용 · 전송',
    ids: ['active_addresses', 'balance_addresses', 'transactions', 'transfers'],
  },
  { title: '공급 · 시가총액', ids: ['supply', 'market_cap', 'issuance'] },
  { title: '수수료 · 블록', ids: ['fees_native', 'hashrate', 'blocks'] },
  {
    title: '거래소 자금 흐름',
    ids: ['exchange_inflow', 'exchange_outflow', 'exchange_balance', 'exchange_netflow'],
  },
];
export function networkUnit(asset: Asset, id: string): string {
  return networkMetric(asset, id)?.unit.replace('자산 단위', asset) || '';
}
