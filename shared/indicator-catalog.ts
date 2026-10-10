import { referenceAssets, availableMarket } from './asset-registry';
import { DERIVATIVE_ASSETS } from './derivative-contracts';
import { ASSETS, METRICS } from './catalog';
import { NETWORK_METRICS, NETWORK_ASSETS } from './network-catalog';
import { ANALYSIS_LABELS, type AnalysisView } from './advanced-analysis';
import { guideArticle, guideForMetric } from './learning-catalog';
import { isRangePeriod } from './ranges';
import type { Asset, Period } from './types';
import { defaultIndicator } from './default-analysis';
import { longestPriceBasis } from './price-history';
import type { PriceBasis } from './analysis-workspace';
export { defaultIndicator } from './default-analysis';

export const INDICATOR_GROUPS = ['가치·사이클', '온체인', '선물', '기술·성과'] as const;
export type IndicatorGroup = (typeof INDICATOR_GROUPS)[number];
export type IndicatorAvailability =
  'ready' | 'delayed' | 'unsupported' | 'insufficient-history' | 'pending' | 'loading' | 'error';
export interface IndicatorDefinition {
  id: string;
  title: string;
  group: IndicatorGroup;
  assets: readonly Asset[];
  unit: string;
  source: string;
  formula: string;
  shortMeaning: string;
  baselineMeaning: string;
  observationCadence: string;
  measurementScope: string;
  defaultPeriod: Period;
  renderer: 'series' | 'price' | 'bands' | 'lab';
  guide: string;
  thresholds?: number[];
  view?: AnalysisView;
}
const all = ASSETS.map((a) => a.id);
export const supportsReference = (asset: Asset) => referenceAssets.includes(asset);
export const validPriceBasis = (asset: Asset, basis: string | null): PriceBasis =>
  basis === 'upbit' || basis === 'binance'
    ? availableMarket(asset, basis)
    : supportsReference(asset)
      ? 'reference'
      : availableMarket(asset, 'binance');
const valueMetrics = new Set(['mvrv', 'realized_price', 'realized_cap']);
type IndicatorBase = Omit<
  IndicatorDefinition,
  'shortMeaning' | 'baselineMeaning' | 'observationCadence' | 'measurementScope'
>;
const definitions: IndicatorBase[] = [
  {
    id: 'view:supertrend',
    title: '슈퍼트렌드',
    group: '기술·성과',
    assets: all,
    unit: '가격',
    source: '선택 가격 원천',
    formula: 'HL2 ± 배수 × ATR(기간) · Wilder RMA · 이전 경계와 확정 종가로 방향 판정 · 기본 10·3',
    defaultPeriod: 'all',
    renderer: 'price',
    guide: 'supertrend',
    view: 'price',
  },
  ...NETWORK_METRICS.map(
    (m) =>
      ({
        id: 'net:' + m.id,
        title: m.title,
        group: valueMetrics.has(m.id) ? '가치·사이클' : '온체인',
        assets: m.assets,
        unit: m.unit,
        source: 'Coin Metrics',
        formula: m.formula,
        defaultPeriod: '5y',
        renderer: 'series',
        guide: 'net-' + m.id,
        thresholds: m.id === 'mvrv' ? [1] : m.id === 'nupl' ? [0] : undefined,
      }) as IndicatorBase,
  ),
  ...METRICS.map(
    (m) =>
      ({
        id: 'btc:' + m.id,
        title: m.title,
        group: valueMetrics.has(m.id) ? '가치·사이클' : '온체인',
        assets: ['BTC'],
        unit: m.unit === '비율' ? '%' : m.unit,
        source: 'Bitview',
        formula: m.formula,
        defaultPeriod: '5y',
        renderer: 'series',
        guide: m.id,
        thresholds: m.reference === undefined ? undefined : [m.reference],
      }) as IndicatorBase,
  ),
  ...[
    ['funding', '확정 펀딩률', '%', '실제 정산 펀딩 비율 × 100', 'funding'],
    [
      'open_interest',
      '미결제약정 · 시간별',
      '자산',
      'Bybit USDT 무기한 계약의 코인 수량',
      'open-interest',
    ],
    [
      'open_interest_daily',
      '미결제약정 · 일별',
      '자산',
      'Bybit USDT 무기한 계약의 코인 수량 · 일별',
      'open-interest',
    ],
    [
      'long_account_ratio',
      '롱 계정 비중 · 시간별',
      '%',
      '롱 보유 계정 / 전체 포지션 보유 계정 × 100',
      'long-ratio',
    ],
    [
      'long_account_ratio_daily',
      '롱 계정 비중 · 일별',
      '%',
      '롱 보유 계정 / 전체 포지션 보유 계정 × 100 · 일별',
      'long-ratio',
    ],
  ].map(
    ([id, title, unit, formula, guide]) =>
      ({
        id: 'futures:' + id,
        title,
        unit,
        formula,
        guide,
        group: '선물',
        assets: DERIVATIVE_ASSETS,
        source: 'Bybit USDT 무기한',
        defaultPeriod: '3m',
        renderer: 'series',
        thresholds: id === 'funding' ? [0] : undefined,
      }) as IndicatorBase,
  ),
  ...[
    [
      'rsi',
      'RSI 14',
      'RSI',
      'RSI = 100 − 100 / (1 + 평균 상승폭 / 평균 하락폭) · Wilder 14일',
      'rsi',
    ],
    ['drawdown', '고점 대비 낙폭', '%', '(당일 종가 / 그날까지 최고 종가 − 1) × 100', 'drawdown'],
    [
      'relative',
      'BTC 대비 가격 비율',
      'BTC/자산',
      '같은 원천·통화·UTC 날짜의 코인 종가 / BTC 종가',
      'relative',
    ],
    ['volume', '거래량', '자산', '선택 거래소의 확정 일봉 거래량', 'volume'],
  ].map(
    ([id, title, unit, formula, guide]) =>
      ({
        id,
        title,
        unit,
        formula,
        guide,
        group: '기술·성과',
        assets: id === 'relative' ? all.filter((a) => a !== 'BTC') : all,
        source: '선택 가격 원천',
        defaultPeriod: '1y',
        renderer: 'series',
        thresholds: id === 'rsi' ? [30, 70] : id === 'drawdown' ? [0] : undefined,
      }) as IndicatorBase,
  ),
  ...(
    [
      'price',
      'rainbow',
      'btc_rainbow',
      'ribbon',
      'vwap',
      'bb',
      'relative',
      'cycles',
      'windows',
      'seasonality',
      'powerlaw',
    ] as const
  ).map(
    (v) =>
      ({
        id: 'view:' + v,
        title: v === 'bb' ? '볼린저밴드' : ANALYSIS_LABELS[v],
        group: ['rainbow', 'btc_rainbow', 'cycles', 'powerlaw'].includes(v)
          ? '가치·사이클'
          : '기술·성과',
        assets: ['btc_rainbow', 'cycles', 'powerlaw'].includes(v) ? ['BTC'] : all,
        unit: '가격',
        source: '선택 가격 원천',
        formula:
          v === 'rainbow'
            ? 'exp(μ + kσ) · 표시일 이전 연속 730일 로그가격'
            : v === 'btc_rainbow'
              ? 'ln(P) = a + b × ln(제네시스 이후 경과일) · 과거 관측만 회귀'
              : v === 'bb'
                ? '20개 확정 종가의 SMA ± 2 × 모집단 표준편차'
                : '확정 가격 이력으로 계산',
        defaultPeriod: ['rainbow', 'btc_rainbow', 'cycles', 'seasonality', 'powerlaw'].includes(v)
          ? 'all'
          : '1y',
        renderer: ['rainbow', 'btc_rainbow'].includes(v)
          ? 'bands'
          : ['relative', 'cycles', 'windows', 'seasonality'].includes(v)
            ? 'lab'
            : 'price',
        guide: v === 'btc_rainbow' ? 'btc-rainbow' : v === 'bb' ? 'bb' : v,
        view: v === 'bb' ? 'price' : v,
      }) as IndicatorBase,
  ),
  ...['tvl', 'stablecoins'].map(
    (id) =>
      ({
        id: 'chain:' + id,
        title: id === 'tvl' ? 'Ethereum DeFi TVL' : 'Ethereum 스테이블코인 공급',
        group: '온체인',
        assets: ['ETH'],
        unit: 'USD',
        source: 'DefiLlama · Ethereum',
        formula:
          id === 'tvl'
            ? 'Ethereum 체인의 DeFi 예치 가치 · ETH 토큰 시가총액과 별개'
            : 'Ethereum 체인 스테이블코인의 USD 평가액 합계',
        defaultPeriod: '5y',
        renderer: 'series',
        guide: id,
      }) as IndicatorBase,
  ),
];
// Concise selection copy. The full definition, formula and limits remain in the guide.
const conciseMeanings: Record<string, string> = {
  'view:supertrend': '변동 폭(ATR)을 반영한 추세 기준선',
  'view:rainbow': '앞선 730일 로그가격 분포에서의 위치',
  'view:btc_rainbow': '과거 가격의 로그회귀 대비 현재 위치',
  'view:relative': '두 코인의 수익률·가격 비율·상관 비교',
  'view:ribbon': '서로 다른 기간의 이동평균 비교',
  'view:bb': '20개 종가 평균과 변동 범위',
  'view:price': '선택 원천의 확정 가격 흐름',
  rsi: '최근 14일 상승폭과 하락폭의 상대적 크기',
  drawdown: '그날까지의 최고 종가 대비 하락률',
  'futures:funding': '무기한 선물의 실제 정산 펀딩 비율',
  'net:realized_cap': '시가총액과 MVRV로 역산한 실현가치',
  'net:realized_price': '같은 원천의 가격을 MVRV로 나눈 값',
};
export const INDICATORS_CATALOG: IndicatorDefinition[] = definitions.map((d) => {
  const guide =
    guideForMetric(d.id === 'view:price' ? 'candles' : d.id.replace(/^view:/, '')) ??
    guideArticle(d.guide);
  const cadence =
    d.id === 'futures:funding'
      ? '거래소 정산 주기'
      : d.id.startsWith('futures:') && !d.id.endsWith('_daily')
        ? '시간별'
        : ['view:ribbon', 'view:supertrend'].includes(d.id)
          ? '선택한 확정 봉'
          : '일별 확정 관측';
  return {
    ...d,
    title: d.id === 'view:btc_rainbow' ? 'BTC 레인보우' : d.title,
    guide: guide?.id ?? d.guide,
    formula: d.formula === '확정 가격 이력으로 계산' ? (guide?.formula ?? d.formula) : d.formula,
    shortMeaning: d.id.endsWith(':mvrv')
      ? '시가총액 ÷ 실현시가총액'
      : (conciseMeanings[d.id] ?? guide?.summary ?? d.formula),
    baselineMeaning: guide?.read ?? '같은 원천과 단위의 확정 관측을 비교합니다.',
    observationCadence: cadence,
    measurementScope:
      d.group === '선물'
        ? 'Bybit USDT 무기한 계약 · 거래소 전체 시장과 구분'
        : d.id.startsWith('chain:')
          ? 'Ethereum 체인 · ETH 토큰 자체의 가치와 구분'
          : d.id === 'view:relative'
            ? '선택 코인과 비교 코인 · 동일 원천·통화·공통 날짜'
            : d.source === '선택 가격 원천'
              ? '선택 원천의 가격 이력 · 원천을 이어 붙이지 않음'
              : d.source + '의 지원 코인별 정의 · 코인 간 저평가 순위가 아님',
  };
});
export const indicatorDefinition = (id: string) => INDICATORS_CATALOG.find((d) => d.id === id);
// Identical concepts from different sources stay separate series, but share one navigation entry.
export const indicatorFamily = (id: string) => id.replace(/^(net|btc):/, 'onchain:');
export const indicatorSources = (asset: Asset, id: string) =>
  INDICATORS_CATALOG.filter(
    (d) => d.assets.includes(asset) && indicatorFamily(d.id) === indicatorFamily(id),
  );
export function navigationIndicators(asset: Asset, selected: string) {
  const seen = new Set<string>();
  return INDICATORS_CATALOG.filter((d) => {
    if (!d.assets.includes(asset)) return false;
    const family = indicatorFamily(d.id);
    if (seen.has(family)) return false;
    seen.add(family);
    return true;
  }).map((d) =>
    indicatorFamily(d.id) === indicatorFamily(selected) ? (indicatorDefinition(selected) ?? d) : d,
  );
}
export function resolveIndicator(asset: Asset, path: string, params: URLSearchParams) {
  let id = params.get('metric');
  if (id && !id.includes(':') && path.startsWith('/onchain')) id = 'net:' + id;
  if (id && !id.includes(':') && path.startsWith('/futures')) id = 'futures:' + id;
  if (id && !id.includes(':') && path.startsWith('/metrics/')) id = 'btc:' + id;
  if (!id) {
    if (path.startsWith('/onchain')) id = params.get('panels')?.split(',')[0] || 'net:mvrv';
    else if (path.startsWith('/futures'))
      id = params.get('panels')?.split(',')[0] || 'futures:funding';
    else if (path.startsWith('/metrics/')) id = 'btc:' + path.split('/')[2];
    else if (params.get('visual')) id = 'view:' + params.get('visual');
    else if (path.startsWith('/chart') || path.startsWith('/technical') || params.has('indicators'))
      id = 'view:price';
    else if (params.has('patterns') || params.has('draw_tool')) id = 'view:price';
    else if (params.get('panels')) id = params.get('panels')!.split(',')[0];
  }
  id ||= defaultIndicator(asset);
  const definition = indicatorDefinition(id);
  return {
    id,
    definition,
    supported: !!definition?.assets.includes(asset),
    period: (isRangePeriod(params.get('period'))
      ? params.get('period')
      : (definition?.defaultPeriod ?? '5y')) as Period,
  };
}
export function indicatorUrl(
  asset: Asset,
  id: string,
  previous = new URLSearchParams(),
  switchingAsset = false,
) {
  const p = new URLSearchParams(previous),
    requested = indicatorDefinition(id);
  p.set('asset', asset);
  const supported = requested?.assets.includes(asset);
  const next = supported ? id : defaultIndicator(asset);
  p.set('metric', next);
  let basis = validPriceBasis(asset, p.get('price_source') || p.get('market'));
  if (next === 'view:rainbow' && (switchingAsset || previous.get('metric') !== next))
    basis = longestPriceBasis(asset, basis);
  if (next === 'view:btc_rainbow' || next === 'view:powerlaw') basis = 'reference';
  if (['view:vwap', 'volume', 'view:supertrend'].includes(next) && basis === 'reference')
    basis = availableMarket(asset, 'binance');
  if (next === 'view:supertrend' && previous.get('metric') !== next) {
    p.set('interval', '1w');
    p.set('log', '0');
  }
  p.set('price_source', basis);
  if (basis === 'reference') p.delete('market');
  else p.set('market', basis);
  for (const key of [
    'visual',
    'panels',
    'signal',
    'focus',
    'reading_date',
    'pattern_focus',
    'guide',
    'transition',
    'draw_tool',
  ])
    p.delete(key);
  if (!supported) p.set('transition', id);
  if (!switchingAsset || !supported) {
    p.set('period', indicatorDefinition(next)!.defaultPeriod);
    p.delete('chart_from');
    p.delete('chart_to');
  }
  if (!switchingAsset) {
    p.delete('indicators');
    p.delete('patterns');
    p.delete('compare_price');
  }
  return '/coins/' + asset + '?' + p;
}
