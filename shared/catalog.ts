import type { Asset, Metric } from './types';
export const PRIMARY_ASSETS: readonly Asset[] = ['BTC', 'DOGE', 'ETH'];
export const isPrimaryAsset = (asset: Asset) => PRIMARY_ASSETS.includes(asset);
export const ASSETS: { id: Asset; name: string; color: string; logo: string }[] = [
  { id: 'BTC', name: '비트코인', color: '#f59c39', logo: '/coin-logos/btc.png' },
  { id: 'DOGE', name: '도지코인', color: '#c4a34d', logo: '/coin-logos/doge-official.png' },
  { id: 'ETH', name: '이더리움', color: '#899cff', logo: '/coin-logos/eth.png' },
  { id: 'SOL', name: '솔라나', color: '#73dac5', logo: '/coin-logos/sol.png' },
  { id: 'XRP', name: '리플', color: '#d2d9e2', logo: '/coin-logos/xrp.png' },
  { id: 'LINK', name: '체인링크', color: '#6084ff', logo: '/coin-logos/link.png' },
  { id: 'ONDO', name: '온도파이낸스', color: '#829dbc', logo: '/coin-logos/ondo.png' },
  { id: 'PEPE', name: '페페', color: '#75b67a', logo: '/coin-logos/pepe.png' },
];
export const BASE_SERIES = [
  'date',
  'price',
  'market_cap',
  'realized_cap',
  'mvrv',
  'sth_mvrv',
  'lth_mvrv',
  'realized_price',
  'sth_realized_price',
  'nupl',
  'sopr_24h',
] as const;
const source = 'https://bitview.space/api';
export const METRICS: Metric[] = [
  {
    id: 'mvrv',
    title: 'MVRV',
    english: 'Market Value / Realized Value',
    unit: '배',
    color: '#a296fa',
    description:
      '현재 시가총액이 마지막 이동 가격으로 평가한 실현시가총액의 몇 배인지 보여줍니다. 1은 두 평가액이 같은 지점입니다.',
    formula: '시가총액 ÷ 실현시가총액',
    reference: 1,
    source,
  },
  {
    id: 'realized_price',
    title: '실현가격',
    english: 'Realized Price',
    unit: 'USD',
    color: '#e6b16b',
    description:
      '현재 남아 있는 UTXO를 마지막 이동 시점 가격으로 평가한 평균 가격입니다. 실제 투자자의 평균 매수가와는 다릅니다.',
    formula: '실현시가총액 ÷ 공급량',
    source,
  },
  {
    id: 'sopr_24h',
    title: 'SOPR',
    english: 'Spent Output Profit Ratio · 24h',
    unit: '배',
    color: '#55c4ba',
    description:
      '최근 24시간에 사용된 UTXO의 이동 시점 가치와 생성 시점 가치의 비율입니다. 1을 기준으로 총이익과 총손실을 구분합니다.',
    formula: '24시간 사용된 출력의 이동 시점 가치 합 ÷ 생성 시점 가치 합',
    reference: 1,
    source,
  },
  {
    id: 'nupl',
    title: 'NUPL',
    english: 'Net Unrealized Profit / Loss',
    unit: '비율',
    color: '#739eef',
    description:
      '전체 미실현 손익이 현재 시가총액에서 차지하는 비율입니다. 아래 값은 퍼센트로 표시됩니다.',
    formula: '(시가총액 − 실현시가총액) ÷ 시가총액',
    reference: 0,
    source,
  },
  {
    id: 'mvrv_z',
    title: 'MVRV-Z',
    english: 'MVRV Z-Score',
    unit: 'Z',
    color: '#dc8ebb',
    description:
      '시가총액과 실현시가총액의 차이를 시가총액의 누적 변동 폭으로 나눈 값입니다. Bitview 기준 데이터를 사용하며, 타사 값과 같다고 보장하지 않습니다.',
    formula:
      '(시가총액 − 실현시가총액) ÷ 해당일까지의 시가총액 모집단 표준편차 · 최소 365개 유효 일별 표본',
    reference: 0,
    source: 'https://docs.glassnode.com/further-information/metric-guides/mvrv/mvrv-z-score',
  },
  {
    id: 'sth_mvrv',
    title: '단기 보유자 MVRV',
    english: 'Short-Term Holder MVRV',
    unit: '배',
    color: '#71b9e4',
    description:
      'Bitview의 단기 보유자 UTXO 집단에 대한 MVRV입니다. 집단 구분은 원천의 정의를 따릅니다.',
    formula: 'BTC 가격 ÷ 단기 보유자 실현가격',
    reference: 1,
    source,
  },
  {
    id: 'lth_mvrv',
    title: '장기 보유자 MVRV',
    english: 'Long-Term Holder MVRV',
    unit: '배',
    color: '#c19fe5',
    description:
      'Bitview의 장기 보유자 UTXO 집단에 대한 MVRV입니다. 서로 다른 제공자의 집단 정의를 혼합하지 않습니다.',
    formula: 'BTC 가격 ÷ 장기 보유자 실현가격',
    reference: 1,
    source,
  },
  {
    id: 'sth_realized_price',
    title: '단기 보유자 실현가격',
    english: 'Short-Term Holder Realized Price',
    unit: 'USD',
    color: '#de8d68',
    description: '단기 보유자 UTXO 집단의 마지막 이동 가격으로 계산한 실현가격입니다.',
    formula: '단기 보유자 실현시가총액 ÷ 해당 집단 공급량',
    source,
  },
];
export const CALC_VERSION = 'btc-desk-1.1-cap-ratios-expanding-population';
export const INDICATORS = [
  { id: 'sma128', label: '128일선', color: '#70b8db' },
  { id: 'sma200', label: '200일선', color: '#d898a5' },
  { id: 'sma365', label: '365일선', color: '#deb876' },
  { id: 'sma200w', label: '200주선', color: '#a899e9' },
  { id: 'bb', label: '볼린저밴드', color: '#8995a8' },
  { id: 'rsi', label: 'RSI 14', color: '#aa92e7' },
  { id: 'macd', label: 'MACD', color: '#55c4ba' },
];
