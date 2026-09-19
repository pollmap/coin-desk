import type { Point } from './types';

export interface ThresholdBand {
  lower: number | null;
  upper: number | null;
  label: string;
  range: string;
  color: string;
}
export interface ThresholdBoundary {
  value: number;
  label: string;
  color: string;
}
export interface ThresholdDefinition {
  bands: readonly ThresholdBand[];
  boundaries: readonly ThresholdBoundary[];
  sources: readonly { title: string; url: string }[];
  note: string;
  comparison?: true;
}
const teal = '#55c4ac',
  neutral = '#90a4bd',
  amber = '#e8b767',
  red = '#ef8291';
const mvrvSource = {
  title: 'CryptoQuant MVRV',
  url: 'https://userguide.cryptoquant.com/cryptoquant-metrics/market/mvrv-ratio',
};
const glassMvrv = {
  title: 'Glassnode MVRV',
  url: 'https://docs.glassnode.com/further-information/metric-guides/mvrv/mvrv-ratio',
};
const holderSource = {
  title: 'Glassnode 보유자 지표',
  url: 'https://research.glassnode.com/sth-lth-sopr-mvrv/',
};
const profitBands = (
  boundary: number,
  below: string,
  above: string,
  unit: string,
): ThresholdBand[] => [
  { lower: null, upper: boundary, label: below, range: `< ${boundary}${unit}`, color: amber },
  { lower: boundary, upper: null, label: above, range: `> ${boundary}${unit}`, color: teal },
];
const holder: ThresholdDefinition = {
  bands: profitBands(1, '집단 미실현 손실', '집단 미실현 이익', '×'),
  boundaries: [{ value: 1, label: '손익분기', color: neutral }],
  sources: [holderSource],
  note: '1은 해당 집단의 실현평가와 현재 평가가 같은 기준입니다. 전체 MVRV의 3.7 과열선을 적용하지 않습니다. Bitview와 Glassnode의 집단 분류·가격 원천 차이가 있습니다.',
};
const realized: ThresholdDefinition = {
  bands: [],
  boundaries: [],
  comparison: true,
  sources: [glassMvrv],
  note: '같은 날짜의 Bitview 추정 USD 가격 ÷ 실현가격으로 비교합니다. 두 선은 같은 USD 축을 사용합니다. 고정 과열 가격이나 보장된 지지선은 아닙니다.',
};
const networkSource = {
  title: 'Coin Metrics MVRV 산식',
  url: 'https://docs.coinmetrics.io/network-data/network-data-overview/market/market-capitalization#f',
};

/** Source-reviewed reference boundaries, 2026-09-20. Values remain in source units.
 * Strict inequalities follow the cited guides; exact boundaries are labelled separately.
 * These are descriptive references, never trade orders or provider-identical signals.
 */
export const THRESHOLDS: Readonly<Record<string, ThresholdDefinition>> = {
  network_mvrv: {
    bands: profitBands(1, '시장평가 < 실현평가', '시장평가 > 실현평가', '×'),
    boundaries: [{ value: 1, label: '두 평가액 일치', color: neutral }],
    sources: [networkSource],
    note: 'Coin Metrics 원장 공급 기준 MVRV의 손익분기 1만 표시합니다. BTC의 3.7 과열 참고값을 다른 코인이나 이 원천에 적용하지 않습니다.',
  },
  network_nupl: {
    bands: profitBands(0, '순미실현 손실', '순미실현 이익', '%'),
    boundaries: [{ value: 0, label: '순미실현 손익분기', color: neutral }],
    sources: [networkSource],
    note: 'Coin Metrics MVRV에서 1−1/MVRV로 역산한 값입니다. 0 손익분기만 표시하며 BTC의 과거 과열 밴드는 적용하지 않습니다.',
  },
  mvrv: {
    bands: [
      { lower: null, upper: 1, label: '저평가 참고', range: '< 1×', color: teal },
      { lower: 1, upper: 3.7, label: '중간 구간', range: '1~3.7×', color: neutral },
      { lower: 3.7, upper: null, label: '과열 참고', range: '> 3.7×', color: red },
    ],
    boundaries: [
      { value: 1, label: '손익분기', color: teal },
      { value: 3.7, label: '과열 참고 경계', color: red },
    ],
    sources: [mvrvSource, glassMvrv],
    note: '기본 경계는 CryptoQuant의 1·3.7입니다. Glassnode는 상단 참고를 3.5로 설명합니다. 차트 원자료는 Bitview이므로 타사 수치·신호와 동일하지 않으며, 과거 참고 구간이 반전을 보장하지 않습니다.',
  },
  sth_mvrv: holder,
  lth_mvrv: holder,
  sopr_24h: {
    bands: profitBands(1, '이동 출력 손실', '이동 출력 이익', '×'),
    boundaries: [{ value: 1, label: '이동 출력 손익분기', color: neutral }],
    sources: [
      {
        title: 'Glassnode SOPR',
        url: 'https://docs.glassnode.com/further-information/metric-guides/sopr/sopr-spent-output-profit-ratio',
      },
    ],
    note: '최근 24시간 이동 출력의 손익 기준입니다. 1 위를 과매수, 1 아래를 과매도로 부르지 않습니다. 자기 지갑 전송도 포함될 수 있으며 aSOPR·엔티티 조정 수치와 다릅니다.',
  },
  nupl: {
    bands: [
      { lower: null, upper: 0, label: '순미실현 손실', range: '< 0%', color: amber },
      { lower: 0, upper: 0.25, label: '낮은 미실현 이익', range: '0~25%', color: neutral },
      { lower: 0.25, upper: 0.5, label: '중간 미실현 이익', range: '25~50%', color: '#7ab9d5' },
      { lower: 0.5, upper: 0.75, label: '높은 미실현 이익', range: '50~75%', color: '#cbb078' },
      { lower: 0.75, upper: null, label: '과열 참고', range: '> 75%', color: red },
    ],
    boundaries: [
      { value: 0, label: '손익분기', color: neutral },
      { value: 0.25, label: '25% 구간 경계', color: '#7ab9d5' },
      { value: 0.5, label: '50% 구간 경계', color: '#cbb078' },
      { value: 0.75, label: '과열 참고 경계', color: red },
    ],
    sources: [
      {
        title: 'Glassnode NUPL 구간',
        url: 'https://research.glassnode.com/dissecting-bitcoins-unrealised-on-chain-profit-loss/',
      },
    ],
    note: '0·25·50·75%는 Glassnode의 과거 시장 구분을 참고합니다. 원문도 경험적으로 정한 경계라고 설명합니다. Bitview에 적용한 참고 구간이며 미래 고점·저점을 확정하지 않습니다.',
  },
  mvrv_z: {
    bands: profitBands(0, '시장평가 < 실현평가', '시장평가 > 실현평가', ' Z'),
    boundaries: [{ value: 0, label: '시장평가 = 실현평가', color: neutral }],
    sources: [
      {
        title: 'Glassnode MVRV-Z',
        url: 'https://docs.glassnode.com/further-information/metric-guides/mvrv/mvrv-z-score',
      },
    ],
    note: '0은 두 평가액이 같은 기준입니다. 자체 누적 표준편차의 시작일·가격 원천이 달라 타사의 7~9 과열 밴드를 이식하지 않습니다. 양수 전체가 과열이라는 뜻은 아닙니다.',
  },
  realized_price: realized,
  sth_realized_price: realized,
  rsi: {
    bands: [
      { lower: 0, upper: 30, label: '과매도 참고', range: '< 30', color: teal },
      { lower: 30, upper: 70, label: '중립 구간', range: '30~70', color: neutral },
      { lower: 70, upper: 100, label: '과매수 참고', range: '> 70', color: red },
    ],
    boundaries: [
      { value: 30, label: '과매도 참고 경계', color: teal },
      { value: 70, label: '과매수 참고 경계', color: red },
    ],
    sources: [
      {
        title: 'TradingView RSI',
        url: 'https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/',
      },
    ],
    note: 'Wilder의 일반적인 30·70 관찰선입니다. 강한 추세에서는 이 구간에 오래 머물 수 있습니다. RSI 기간·봉 간격이 다르면 값도 달라집니다.',
  },
};

export function thresholdState(id: string, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const definition = THRESHOLDS[id];
  if (!definition || definition.comparison || (id === 'rsi' && (value < 0 || value > 100)))
    return null;
  const boundary = definition.boundaries.find((b) => b.value === value);
  if (boundary)
    return { label: boundary.label, color: boundary.color, range: `= ${value}`, boundary: true };
  const band = definition.bands.find(
    (b) => (b.lower === null || value >= b.lower) && (b.upper === null || value <= b.upper),
  );
  return band ? { label: band.label, color: band.color, range: band.range, boundary: false } : null;
}

export function realizedPosition(reference: Point | undefined, price: Point | undefined) {
  if (
    !reference ||
    !price ||
    reference.time !== price.time ||
    !Number.isFinite(reference.value) ||
    !Number.isFinite(price.value) ||
    reference.value <= 0 ||
    price.value <= 0
  )
    return null;
  const ratio = price.value / reference.value;
  if (!Number.isFinite(ratio) || !Number.isFinite((ratio - 1) * 100)) return null;
  return {
    ratio,
    percent: (ratio - 1) * 100,
    label:
      ratio === 1
        ? '실현가격과 같음'
        : ratio > 1
          ? '추정 가격이 실현가격 위'
          : '추정 가격이 실현가격 아래',
    color: ratio < 1 ? amber : ratio > 1 ? teal : neutral,
  };
}
