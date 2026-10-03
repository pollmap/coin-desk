import { METRICS, ASSETS } from './catalog';
import { NETWORK_METRICS } from './network-catalog';
import { METRIC_GUIDES } from './metric-guides';
import { PATTERNS, type PatternId } from './candle-patterns';
import { basisName, priceBasis, type PriceBasis } from './analysis-workspace';
import { ANALYSIS_LABELS, type AnalysisView } from './advanced-analysis';
import { validIndicators } from './indicators';
import { readDateWindow } from './date-navigation';
import type { Asset } from './types';
import type { DrawingKind } from './annotations';

export const GUIDE_CATEGORIES = [
  '시작·데이터',
  '추세·모멘텀',
  '캔들 패턴',
  '사이클·비교',
  '온체인',
  '선물·시장',
  '차트 도구',
] as const;
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];
export type GuideAction =
  | { kind: 'indicator'; id: string }
  | { kind: 'panel'; id: string; section: 'onchain' | 'futures' | 'price' }
  | { kind: 'view'; id: AnalysisView }
  | { kind: 'pattern'; id: PatternId }
  | { kind: 'drawing'; id: DrawingKind }
  | { kind: 'link'; path: string };
export interface GuideArticle {
  id: string;
  title: string;
  english: string;
  category: GuideCategory;
  summary: string;
  read: string;
  formula: string;
  caution: string;
  steps: string[];
  related: string[];
  assets: readonly Asset[];
  basis?: readonly PriceBasis[];
  action: GuideAction;
  source?: string;
  unit?: string;
  aliases?: string;
  advanced?: boolean;
}
const core = ASSETS.map((a) => a.id);
const startSteps = [
  '코인과 가격 기준을 확인합니다.',
  '차트에 적용한 뒤 날짜를 옮겨 실제 수치를 확인합니다.',
];
const tv = 'https://www.tradingview.com/support/';
function entry(
  id: string,
  title: string,
  category: GuideCategory,
  summary: string,
  read: string,
  formula: string,
  caution: string,
  action: GuideAction,
  extra: Partial<GuideArticle> = {},
): GuideArticle {
  return {
    id,
    title,
    english: '',
    category,
    summary,
    read,
    formula,
    caution,
    action,
    assets: core,
    steps: startSteps,
    related: [],
    ...extra,
  };
}
const technical: GuideArticle[] = [
  entry(
    'sma',
    '단순이동평균 · SMA',
    '추세·모멘텀',
    '가격의 평균 흐름을 기간별로 비교합니다.',
    '가격이 평균의 위·아래인지와 평균 자체의 방향을 함께 봅니다.',
    '최근 N개 확정 종가의 합 ÷ N',
    '기간을 늘릴수록 변화에 늦게 반응합니다. 선택 봉·일·주 기준을 구분하세요.',
    { kind: 'indicator', id: 'sma200' },
    {
      english: 'Simple Moving Average',
      aliases: '이평선 200일선 200주선 골든크로스 데드크로스',
      related: ['ema', 'ribbon', 'rsi'],
      source: tv + 'solutions/43000696841-simple-moving-average/',
    },
  ),
  entry(
    'ema',
    '지수이동평균 · EMA',
    '추세·모멘텀',
    '최근 가격에 더 큰 가중치를 둔 추세선입니다.',
    '같은 기간의 SMA보다 최근 변화에 빠르게 반응하는지 봅니다.',
    '첫 N개 평균으로 시작, EMA = α×종가 + (1−α)×직전 EMA, α=2/(N+1)',
    '더 빠른 반응은 잦은 교차도 만듭니다. 교차 자체가 수익을 보장하지 않습니다.',
    { kind: 'indicator', id: 'ema:20:bar' },
    {
      english: 'Exponential Moving Average',
      related: ['sma', 'macd'],
      source: tv + 'solutions/43000502589-moving-averages/',
    },
  ),
  entry(
    'rsi',
    '상대강도지수 · RSI',
    '추세·모멘텀',
    '상승폭과 하락폭의 균형을 0~100으로 봅니다.',
    '30·70 경계와 지속 기간을 함께 봅니다. 강한 추세에서는 경계 밖에 오래 머물 수 있습니다.',
    '14봉 Wilder 평균 상승폭 / 평균 하락폭 = RS; RSI=100−100/(1+RS)',
    '과매수는 곧 하락한다는 뜻이 아닙니다. 코인 간 가격 비율인 상대강도와 다릅니다.',
    { kind: 'indicator', id: 'rsi' },
    {
      english: 'Relative Strength Index',
      aliases: '과매수 과매도 알에스아이',
      unit: '0–100',
      related: ['macd', 'relative'],
      source: tv + 'solutions/43000502338-relative-strength-index-rsi/',
    },
  ),
  entry(
    'bb',
    '볼린저밴드',
    '추세·모멘텀',
    '평균 주위의 가격 변동 폭을 봅니다.',
    '밴드가 좁아지는지, 넓어지는지와 종가 위치를 함께 봅니다.',
    '20봉 SMA ± 2×종가 모집단 표준편차',
    '밴드 접촉은 자동 매매 신호가 아닙니다. 기간·배수 변경에 따라 달라집니다.',
    { kind: 'indicator', id: 'bb' },
    {
      english: 'Bollinger Bands',
      aliases: 'BB 변동성 밴드',
      related: ['sma', 'rsi'],
      source: tv + 'solutions/43000501840-bollinger-bands-bb/',
    },
  ),
  entry(
    'macd',
    'MACD',
    '추세·모멘텀',
    '빠른 평균과 느린 평균의 차이를 살펴봅니다.',
    'MACD·신호선 교차와 히스토그램 변화를 구별합니다.',
    'EMA12−EMA26; 신호선=MACD의 EMA9; 히스토그램=MACD−신호선',
    '가격 단위 지표이므로 서로 다른 코인의 절대값을 비교하지 않습니다.',
    { kind: 'indicator', id: 'macd' },
    {
      english: 'Moving Average Convergence Divergence',
      aliases: '맥디 모멘텀',
      related: ['ema', 'rsi'],
      source: tv + 'solutions/43000502344-moving-average-convergence-divergence-macd-indicator/',
    },
  ),
  entry(
    'drawdown',
    '고점 대비 낙폭',
    '추세·모멘텀',
    '과거 최고 종가에서 얼마나 내려왔는지 봅니다.',
    '0%가 최고 종가입니다. 원천의 관측 시작일과 회복에 걸린 기간을 확인합니다.',
    '(현재 종가 / 해당일까지 최고 종가 − 1) × 100',
    '장중 최고가 기준이 아닙니다. 제공 시작 이전의 고점은 포함하지 않습니다.',
    { kind: 'panel', id: 'drawdown', section: 'price' },
    { unit: '%', related: ['seasonality', 'price-source'] },
  ),
  entry(
    'volume',
    '거래량',
    '추세·모멘텀',
    '선택 거래소에서 거래된 코인 수량을 봅니다.',
    '가격 변화와 거래량 확대를 함께 봅니다. 시장 전체 거래량으로 해석하지 않습니다.',
    '선택 거래소 확정 일봉의 기초자산 수량',
    '거래대금과 다릅니다. USD 참조 종가에는 거래량이 없어 표시하지 않습니다.',
    { kind: 'panel', id: 'volume', section: 'price' },
    { basis: ['upbit', 'binance'], unit: '기초 코인', related: ['vwap', 'price-source'] },
  ),
];
const views: GuideArticle[] = [
  entry(
    'ribbon',
    ANALYSIS_LABELS.ribbon,
    '추세·모멘텀',
    '짧고 긴 이동평균의 배열을 한 번에 봅니다. 리본 설정에서 방식·기간을 바꿉니다.',
    '선의 순서·간격·방향이 바뀌는지 확인합니다.',
    '기본 SMA 7·25·50·100, 장기 SMA 20·50·100·200, 빠른 EMA 8·13·21·34·55·89. 선택 봉의 확정 종가 기준.',
    '월봉 7봉과 일봉 7일은 다른 기간입니다.',
    { kind: 'view', id: 'ribbon' },
    { related: ['sma', 'candles'] },
  ),
  entry(
    'vwap',
    '365일 거래량 가중평균',
    '추세·모멘텀',
    '거래량이 큰 날에 더 무게를 둔 평균 가격입니다.',
    '100개 확정 일봉 연속 하회 후 7개 연속 상회하면 재돌파 관찰을 한 번 표시합니다.',
    '연속 365일 Σ((고가+저가+종가)/3 × 코인 거래량) / Σ거래량',
    '특정 거래소의 일별 근사값입니다. 체결별 VWAP나 전체 투자자 평균 단가와 다릅니다. 결측이면 연속 조건을 초기화합니다.',
    { kind: 'view', id: 'vwap' },
    {
      english: 'Rolling VWAP',
      basis: ['upbit', 'binance'],
      related: ['volume', 'sma'],
      advanced: true,
    },
  ),
  entry(
    'rainbow',
    '가격 위치 밴드',
    '사이클·비교',
    '과거 730일 분포에서 현재 가격의 위치를 봅니다.',
    '색 띠는 그날 이전 730일의 가격을 요약한 범위이고, 실제 가격선은 비교할 종가입니다. 가격선이 띠의 위쪽에 있으면 최근 2년과 비교해 높은 위치, 아래쪽이면 낮은 위치입니다. 매일 비교 표본이 달라지므로 가격이 같아도 위치는 바뀔 수 있습니다.',
    'μ = 직전 730일 ln(종가)의 평균; σ = 해당 로그가격의 모집단 표준편차; 경계 = exp(μ + kσ); 위치 z = (ln(오늘 종가) − μ) / σ',
    '타사의 레인보우 모형이나 미래 적정가격 예측선이 아닙니다.',
    { kind: 'view', id: 'rainbow' },
    {
      aliases: '레인보우 rainbow 밴드 위치 표준편차 분포',
      related: ['bb', 'log-scale', 'drawdown'],
      unit: '가격: 선택 원천의 통화 · 위치: σ',
    },
  ),
  entry(
    'relative',
    '상대강도·수익률 상관',
    '사이클·비교',
    'BTC·DOGE·ETH의 성과와 동행 정도를 비교합니다.',
    '시작값 100·백분율 변화·BTC 가격 비율을 골라 질문에 맞게 봅니다.',
    '공통 날짜 정렬; 상관은 연속 30·90·365일 로그수익률의 Pearson 계수',
    '상관은 인과관계가 아닙니다. 결측을 채워 비교하거나 서로 다른 원천을 섞지 않습니다.',
    { kind: 'view', id: 'relative' },
    { aliases: 'ETH/BTC DOGE/BTC 비교 상관관계', related: ['rsi', 'price-source'], advanced: true },
  ),
  entry(
    'cycles',
    'BTC 반감기 사이클',
    '사이클·비교',
    '반감기 이후 경과일을 맞춰 과거 경로를 비교합니다.',
    '반감기 날짜와 실제 첫 관측일을 구분하고 진행 중인 구간의 길이를 확인합니다.',
    '각 구간 첫 관측을 100으로 정규화 · 실제 경과일 축',
    '사이클 수가 적습니다. 과거와 비슷해도 같은 결과나 날짜가 보장되지 않습니다.',
    { kind: 'view', id: 'cycles' },
    { assets: ['BTC'], related: ['windows', 'seasonality'], advanced: true },
  ),
  entry(
    'windows',
    '과거 구간 비교',
    '사이클·비교',
    '직접 고른 두 기간을 겹치거나 나란히 봅니다.',
    '각 기간의 시작일과 첫 관측을 확인한 뒤 형태·수익률 차이를 봅니다.',
    '각 구간 첫 관측=100 · 경과일 정렬',
    '비슷한 구간만 고르면 선택 편향이 생깁니다. 미래 경로를 생성하지 않습니다.',
    { kind: 'view', id: 'windows' },
    { related: ['cycles', 'relative'] },
  ),
  entry(
    'seasonality',
    '계절성·월별 수익률',
    '사이클·비교',
    '달력상 같은 시기의 과거 수익률 분포를 봅니다.',
    '중앙값·평균·사분위 범위를 함께 보고 연도별 경로로 급등 연도 영향을 확인합니다.',
    '완전 연도 최소 3개 · 전년 말 종가 대비 누적수익률; 올해는 관측까지만 별도',
    '평균은 큰 상승 연도의 영향을 받습니다. 달력이 가격을 결정하지 않습니다.',
    { kind: 'view', id: 'seasonality' },
    { aliases: '시즌 월간 월별 히트맵 평균 중앙값', related: ['drawdown', 'windows'] },
  ),
  entry(
    'powerlaw',
    'BTC 파워로 기준선',
    '사이클·비교',
    'BTC의 장기 가격을 고정된 수식과 비교하는 참고 모형입니다.',
    '실제 가격과 기준선의 차이를 과거 관측 범위에서 봅니다.',
    '4.42×10⁻¹⁷ × (2009-01-03 이후 일수)^5.6',
    '첨부 자료의 고정식입니다. 검증된 적정가나 미래 예측으로 표현하지 않습니다.',
    { kind: 'view', id: 'powerlaw' },
    { assets: ['BTC'], basis: ['reference'], related: ['rainbow'], advanced: true },
  ),
];
const onchain: GuideArticle[] = [
  ...NETWORK_METRICS.map((m) =>
    entry(
      'net-' + m.id,
      m.title,
      '온체인',
      m.description,
      m.id === 'mvrv'
        ? '1배는 현재 평가액과 실현평가액이 같다는 뜻입니다. 1.5배라면 현재 평가액이 50% 큽니다. 개인의 수익률이나 확정 매매 신호는 아닙니다.'
        : m.derived
          ? '원천값에서 계산한 파생 지표입니다. 함께 쓰는 입력 지표와 중복된 정보를 확인하세요.'
          : '선택 코인의 관측 기간과 단위를 확인하고 같은 날짜의 가격과 비교합니다.',
      m.formula,
      '원천별 주소·공급·집계 정의가 다릅니다. 다른 제공자의 이력을 이어 붙이지 않습니다.',
      { kind: 'panel', id: 'net:' + m.id, section: 'onchain' },
      {
        assets: m.assets,
        unit: m.unit,
        source: m.source,
        aliases: m.id + ' ' + (m.sourceMetric ?? ''),
        related: m.id === 'mvrv' ? ['net-realized_price', 'net-nupl'] : ['net-mvrv'],
        advanced: !!m.derived,
      },
    ),
  ),
  ...METRICS.map((m) =>
    entry(
      'btc-' + m.id,
      m.title + ' · BTC Bitview',
      '온체인',
      m.description,
      METRIC_GUIDES[m.id]?.read ?? m.description,
      m.formula,
      METRIC_GUIDES[m.id]?.caveat ?? '원천의 집계 범위와 관측 시점을 확인하세요.',
      { kind: 'panel', id: 'btc:' + m.id, section: 'onchain' },
      {
        assets: ['BTC'],
        unit: m.unit,
        english: m.english,
        source: METRIC_GUIDES[m.id]?.source ?? m.source,
        related: (METRIC_GUIDES[m.id]?.related ?? []).map((id) => 'btc-' + id),
        advanced: true,
      },
    ),
  ),
];
const futures: GuideArticle[] = [
  ...(
    [
      'funding',
      'open_interest',
      'open_interest_daily',
      'long_account_ratio',
      'long_account_ratio_daily',
    ] as const
  ).map((id) => {
    const funding = id === 'funding',
      oi = id.startsWith('open_interest'),
      daily = id.endsWith('daily');
    const title = funding
      ? '확정 펀딩률'
      : (oi ? '미결제약정' : '롱 계정 비중') + (daily ? ' · 일별' : ' · 시간별');
    return entry(
      'futures-' + id,
      title,
      '선물·시장',
      funding
        ? '무기한 계약의 실제 정산 비율입니다.'
        : oi
          ? '아직 청산·상쇄되지 않은 계약의 코인 수량입니다.'
          : '롱을 보유한 계정의 비중으로 포지션 금액 비중과 다릅니다.',
      funding
        ? '양수·음수와 전환 시점을 보며 해당 거래소의 정산 간격을 확인합니다.'
        : oi
          ? '가격·펀딩과 함께 증가와 감소를 봅니다. 미결제약정만으로 롱·숏 방향을 알 수 없습니다.'
          : '계정 수의 편향과 가격 변화를 함께 봅니다. 롱 계정이 많아도 총 포지션 금액이 큰 것은 아닙니다.',
      funding
        ? 'Bybit USDT 무기한 계약 확정 fundingRate × 100'
        : oi
          ? 'Bybit 미결제약정 · 기초 코인 수량'
          : 'Bybit buyRatio × 100',
      'Bybit 단일 거래소입니다. 전 거래소 합산이나 청산 히트맵으로 해석하지 않습니다.',
      { kind: 'panel', id: 'futures:' + id, section: 'futures' },
      {
        unit: oi ? '기초 코인' : '%',
        source:
          'https://bybit-exchange.github.io/docs/v5/market/' +
          (funding ? 'history-fund-rate' : oi ? 'open-interest' : 'long-short-ratio'),
        related: ['futures-funding', 'futures-open_interest'].filter((x) => x !== 'futures-' + id),
        aliases: id + ' 펀딩비 OI 롱숏',
      },
    );
  }),
  entry(
    'dominance',
    '시장 도미넌스',
    '선물·시장',
    '전체 코인 시가총액에서 선택 코인이 차지하는 비중입니다.',
    '코인 가격과 비중의 움직임을 구별합니다. 다른 코인이 더 빠르게 오르면 가격 상승 중에도 비중이 낮아질 수 있습니다.',
    '동일 원천의 개별 시가총액 / 전체 시가총액 × 100',
    '관측한 이력만 표시합니다. 스테이블코인 전체 근사 비중은 서로 다른 원천임을 별도 표시합니다.',
    { kind: 'link', path: '/dominance' },
    {
      unit: '%',
      related: ['relative'],
      source: 'https://www.coinlore.com/cryptocurrency-data-api',
    },
  ),
  ...(['tvl', 'stablecoins'] as const).map((id) =>
    entry(
      'chain-' + id,
      id === 'tvl' ? 'Ethereum DeFi TVL' : 'Ethereum 스테이블코인 공급',
      '온체인',
      id === 'tvl'
        ? 'Ethereum 체인 DeFi에 예치된 자산의 USD 평가액입니다.'
        : 'Ethereum 체인의 스테이블코인 공급을 USD로 평가한 합계입니다.',
      '체인 활동·유동성의 맥락으로 보고 ETH 토큰 가격과 구분합니다.',
      id === 'tvl'
        ? 'DefiLlama Ethereum chain TVL'
        : 'Ethereum 체인 스테이블코인별 USD 평가액 합계',
      'ETH 시가총액 또는 실제 신규 유입액과 다릅니다. 가격 변화로도 평가액이 달라집니다.',
      { kind: 'panel', id: 'chain:' + id, section: 'onchain' },
      {
        assets: ['ETH'],
        unit: 'USD',
        related: ['net-active_addresses'],
        source: 'https://defillama.com/chain/ethereum',
      },
    ),
  ),
];
const tools: GuideArticle[] = [
  ...(
    [
      [
        'horizontal',
        '수평선',
        '한 가격 수준을 표시합니다.',
        '차트의 가격 지점을 한 번 선택합니다.',
      ],
      [
        'trend',
        '추세선',
        '서로 다른 시점의 두 지점을 연결합니다.',
        '첫 지점과 두 번째 지점을 차례로 선택합니다.',
      ],
      [
        'channel',
        '평행 채널',
        '추세선과 평행한 두 번째 선을 표시합니다.',
        '추세선의 두 점을 고른 뒤 채널 폭을 정할 세 번째 점을 선택합니다.',
      ],
      [
        'measure',
        '구간 측정',
        '두 지점의 가격 변화율과 경과일을 계산합니다.',
        '시작 지점과 끝 지점을 선택합니다.',
      ],
    ] as const
  ).map(([id, title, summary, step]) =>
    entry(
      'tool-' + id,
      title,
      '차트 도구',
      summary,
      step,
      id === 'measure'
        ? '(끝값 / 시작값 − 1) × 100, UTC 경과일'
        : '선택한 좌표를 연결한 사용자 주석',
      '자동 탐지나 가격 예측이 아닙니다. 코인·가격 원천·봉·지표별로 분리해 이 기기에 저장합니다.',
      { kind: 'drawing', id },
      {
        steps: [step, 'Escape로 취소하고 실행 취소로 마지막 주석을 되돌립니다.'],
        related: ['tool-dates', 'workspace'],
      },
    ),
  ),
  entry(
    'tool-dates',
    '날짜·구간 탐색',
    '차트 도구',
    '원하는 날짜 또는 시작·종료 구간으로 이동합니다.',
    '차트 아래 날짜로 이동을 열고 날짜·구간을 지정합니다.',
    '실제 확보 이력 범위 안으로 이동 · 전체/최신 구간 복귀',
    '봉 시각은 UTC입니다. 해당 날짜에 관측이 없으면 실제 관측 범위를 확인하세요.',
    { kind: 'link', path: '/' },
    {
      steps: [
        '차트 아래 날짜로 이동을 선택합니다.',
        '날짜 또는 시작·종료일을 입력하고 적용합니다.',
        '보이는 구간 공유로 같은 범위를 다시 엽니다.',
      ],
      related: ['candles', 'workspace'],
    },
  ),
  entry(
    'workspace',
    '작업공간 저장·공유',
    '차트 도구',
    '자주 보는 코인·분석·날짜·주석을 다시 엽니다.',
    '차트 아래 작업공간 저장을 열고 이름을 지정합니다.',
    '기기별 설정 버전 2 · 공유 URL은 공개 차트 설정만 포함',
    '개인 글·이미지·메모·주석은 공유 URL에 포함되지 않습니다. 브라우저 변경 시 백업이 필요합니다.',
    { kind: 'link', path: '/workspace' },
    { related: ['library', 'price-source'] },
  ),
  entry(
    'library',
    '개인 자료에서 차트로',
    '차트 도구',
    '참고한 글과 이미지를 해당 분석에 연결합니다.',
    '자료함에서 원본을 확인하고 코인·분석·원천을 지정한 뒤 내 차트로 엽니다.',
    'IndexedDB 기기 저장 · 게시일 전일까지 차트 범위 기본 설정',
    '당시 데이터 공개 상태의 완전한 재현이 아닙니다. 본문·이미지·방법론 검토를 따로 기록합니다.',
    { kind: 'link', path: '/workspace/library' },
    { related: ['workspace'] },
  ),
];
const basics: GuideArticle[] = [
  entry(
    'start',
    '처음 시작하는 코인 분석',
    '시작·데이터',
    '가격을 보고 질문에 맞는 지표 한두 개를 더합니다.',
    '추세는 이동평균, 변동 폭은 볼린저밴드, 시장 평가와 원장 활동은 온체인, 계약 쏠림은 선물에서 확인합니다.',
    'BTC 기본 · 전체 기간 · USD 참조 · 로그축',
    '여러 지표가 같은 가격으로 계산되면 독립된 증거가 아닐 수 있습니다.',
    { kind: 'link', path: '/' },
    {
      steps: [
        'BTC·DOGE·ETH 중 코인을 선택합니다.',
        '가격 기준과 전체 이력을 확인합니다.',
        '하나의 질문에 맞는 지표를 적용하고 같은 날짜를 비교합니다.',
      ],
      related: ['price-source', 'sma', 'net-mvrv', 'futures-funding'],
    },
  ),
  entry(
    'price-source',
    'USD·KRW·USDT와 가격 원천',
    '시작·데이터',
    '가격 단위와 데이터 제공 범위를 먼저 맞춥니다.',
    'USD 참조는 장기 일별 종가, Upbit는 KRW, Binance는 USDT 거래소 가격입니다.',
    '같은 원천·같은 단위·같은 날짜를 비교',
    'USD와 USDT는 같은 자산이 아닙니다. USD 종가로 OHLC나 거래량을 만들지 않습니다.',
    { kind: 'link', path: '/' },
    { related: ['candles', 'relative'] },
  ),
  entry(
    'candles',
    '캔들·종가선·확정 봉',
    '시작·데이터',
    '한 봉의 시가·고가·저가·종가와 진행 상태를 읽습니다.',
    '몸통은 시가~종가, 꼬리는 고가~저가입니다. 진행 봉은 마감 전까지 모양이 바뀝니다.',
    '몸통=|종가−시가|, 범위=고가−저가',
    '패턴은 실제 OHLC와 마감된 봉에서만 계산합니다. USD 참조의 주·월은 종가선입니다.',
    { kind: 'link', path: '/' },
    {
      related: ['pattern-bullish-engulfing', 'price-source'],
      aliases: '양봉 음봉 시가 고가 저가 종가 OHLC 봉간격',
    },
  ),
  entry(
    'log-scale',
    '로그축과 일반축',
    '시작·데이터',
    '같은 비율 변화와 같은 가격 차이 중 무엇을 비교할지 정합니다.',
    '장기 가격에서 1→2와 10→20의 같은 2배 상승을 로그축에서 같은 높이로 봅니다.',
    '로그축: 같은 비율을 같은 간격으로; 일반축: 같은 절대 차이를 같은 간격으로',
    '로그축에는 0 이하 값이 맞지 않습니다. RSI·펀딩 같은 별도 지표 축은 일반축으로 봅니다.',
    { kind: 'link', path: '/' },
    { related: ['rainbow', 'price-source'] },
  ),
  entry(
    'freshness',
    '자동 갱신·결측·데이터 지연',
    '시작·데이터',
    '확인 주기와 원천의 데이터 생성 주기를 구분합니다.',
    '시세는 매분 목표, 최근 선물은 5분 확인, 일별 원천은 새 공표 여부를 확인합니다.',
    '원천의 기준일·수집 성공 시각·상태를 별도 관리',
    '오래된 정상 자료를 실시간으로 표시하지 않습니다. 결측을 보간해 신호를 만들지 않습니다.',
    { kind: 'link', path: '/status' },
    { related: ['price-source', 'candles'] },
  ),
];
export const GUIDE_ARTICLES: readonly GuideArticle[] = [
  entry(
    'btc-rainbow',
    'BTC 레인보우 · Coin Desk 로그회귀',
    '사이클·비교',
    'BTC 가격이 이전 관측으로 계산한 장기 로그회귀에서 얼마나 떨어져 있는지 봅니다. 730일 가격 위치 밴드와 다른 모형입니다.',
    '하단·중앙·상단은 회귀선 대비 위치입니다. 색상은 매수·매도 신호가 아니며, 실제 가격이 밴드 밖에 나갈 수 있습니다.',
    '표시일 이전 유효 관측으로 x=ln(제네시스 이후 경과일), y=ln(BTC USD 가격). b=Σ(x−평균x)(y−평균y)/Σ(x−평균x)², a=평균y−b×평균x. σ=√(Σ(y−a−bx)²/N). 경계 exp(a+bx+kσ), k=−2.25,−1.75,…,2.25. 이전 관측 최소 730개. 예: 중심 100, σ=0.2이면 +0.25σ 경계는 exp(ln100+0.05)≈105.13입니다.',
    'Coin Desk의 자체 모형으로 BlockchainCenter·CoinGlass와 동일한 결과가 아닙니다. 그날 이전의 관측만 사용하며 미래 연장·결측 보간을 하지 않습니다. σ=0이면 위치 점수는 계산하지 않습니다.',
    { kind: 'view', id: 'btc_rainbow' },
    {
      assets: ['BTC'],
      basis: ['reference'],
      related: ['rainbow', 'powerlaw'],
      source: 'https://www.blockchaincenter.net/bitcoin-rainbow-chart/',
      unit: 'USD',
    },
  ),
  ...basics,
  ...technical,
  ...views,
  ...PATTERNS.map((p) =>
    entry(
      'pattern-' + p.id,
      p.title,
      '캔들 패턴',
      p.summary,
      '형태 조건과 앞선 추세를 따로 확인하세요. 상승·하락 명칭은 관찰의 방향이며 이후 결과를 보장하지 않습니다.',
      p.rules.join(' · '),
      '확정된 실제 거래소 OHLC만 사용합니다. 임계값과 추세 판정은 Coin Desk의 공개 규칙으로 타사 탐지 결과와 같다고 보장하지 않습니다.',
      { kind: 'pattern', id: p.id },
      {
        english: p.english,
        source: p.source,
        basis: ['upbit', 'binance'],
        steps: [
          '사용할 거래소와 봉 간격을 확인합니다.',
          '추세 필터를 고르고 차트에 적용합니다.',
          '관찰 목록의 날짜를 눌러 실제 봉과 판정 근거를 확인합니다.',
        ],
        related: ['candles', 'sma', 'tool-measure'],
        aliases: p.id + ' 캔들 패턴 봉',
      },
    ),
  ),
  ...onchain,
  ...futures,
  ...tools,
];
export const guideArticle = (id: string) =>
  GUIDE_ARTICLES.find((g) => g.id === (id === 'btc_rainbow' ? 'btc-rainbow' : id));
export function guideForMetric(id: string) {
  const remote = id.match(/^(net|btc|futures|chain):([a-z_0-9]+)/);
  if (remote) return guideArticle(remote[1] + '-' + remote[2]);
  return guideArticle(
    id.startsWith('sma')
      ? 'sma'
      : id.startsWith('ema')
        ? 'ema'
        : id.startsWith('bb')
          ? 'bb'
          : id.startsWith('macd')
            ? 'macd'
            : id.startsWith('rsi')
              ? 'rsi'
              : id === 'vwap365'
                ? 'vwap'
                : id,
  );
}
export function searchGuides(query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return GUIDE_ARTICLES.filter((g) =>
    words.every((w) =>
      (
        g.title +
        ' ' +
        g.english +
        ' ' +
        g.aliases +
        ' ' +
        g.category +
        ' ' +
        g.summary +
        ' ' +
        g.formula +
        ' ' +
        g.read
      )
        .toLocaleLowerCase()
        .includes(w),
    ),
  );
}
/** Carry only public chart state. No arbitrary return URL, text, private library IDs or memos. */
export function guideContext(params: URLSearchParams) {
  const next = new URLSearchParams();
  next.set('asset', core.includes(params.get('asset') as Asset) ? params.get('asset')! : 'BTC');
  next.set('price_source', priceBasis(params));
  next.set(
    'period',
    ['1m', '3m', '6m', 'ytd', '1y', '3y', '5y', 'all'].includes(params.get('period') ?? '')
      ? params.get('period')!
      : 'all',
  );
  next.set('log', params.get('log') === '0' ? '0' : '1');
  if (/^[a-z_0-9:]{1,80}$/.test(params.get('metric') ?? ''))
    next.set('metric', params.get('metric')!);
  if (['1h', '4h', '1d', '1w', '1M'].includes(params.get('interval') ?? ''))
    next.set('interval', params.get('interval')!);
  const range = readDateWindow(params);
  if (range) {
    next.set('chart_from', String(range.from));
    next.set('chart_to', String(range.to));
  }
  return next;
}
export function guideHref(id: string | undefined, params: URLSearchParams) {
  const context = guideContext(params);
  // Keep browsing state inside the guide, never in executable chart/share state.
  if (params.get('q')) context.set('q', params.get('q')!.slice(0, 200));
  if (GUIDE_CATEGORIES.includes(params.get('category') as GuideCategory))
    context.set('category', params.get('category')!);
  if (params.get('saved') === '1') context.set('saved', '1');
  return '/learn' + (id ? '/' + id : '') + '?' + context;
}
export function guideChartLink(
  article: GuideArticle,
  asset: Asset,
  basis: PriceBasis,
  params = new URLSearchParams(),
): string | null {
  if (!article.assets.includes(asset) || (article.basis && !article.basis.includes(basis)))
    return null;
  const p = guideContext(params);
  p.set('asset', asset);
  p.set('price_source', basis);
  if (basis !== 'reference') p.set('market', basis);
  if (basis === 'reference' && ['1h', '4h'].includes(p.get('interval') ?? ''))
    p.set('interval', '1d');
  p.set('guide', article.id);
  const a = article.action;
  p.delete('metric');
  let path = '/';
  if (a.kind === 'panel') {
    p.set('metric', a.id);
    p.set('panels', a.id);
    if (a.section !== 'price') path = `/${a.section}/${asset}`;
  } else if (a.kind === 'indicator') {
    p.set('indicators', validIndicators([a.id]).join(','));
    p.set('panels', '');
  } else if (a.kind === 'view') {
    p.set('visual', a.id);
    p.set('metric', 'view:' + a.id);
  } else if (a.kind === 'pattern') {
    p.set('patterns', a.id);
    p.set(
      'pattern_trend',
      ['none', 'sma50-200'].includes(params.get('pattern_trend') ?? '')
        ? params.get('pattern_trend')!
        : 'sma50',
    );
  } else if (a.kind === 'drawing') {
    p.set('draw_tool', a.id);
    p.set('panels', '');
  } else path = a.path;
  return path + '?' + p;
}
export const GUIDE_PRESETS = [
  {
    id: 'position',
    title: '가격 위치 밴드 읽기',
    description: '730일 · 색 구간 · 표준편차',
    guide: 'rainbow',
  },
  {
    id: 'trend',
    title: '이동평균 리본 이해하기',
    description: '짧은 선과 긴 선의 배열',
    visual: 'ribbon',
    panels: 'rsi',
    guide: 'ribbon',
  },
  {
    id: 'onchain',
    title: 'BTC 평가와 손익',
    description: 'MVRV 1배는 무슨 뜻일까요',
    section: 'onchain',
    panels: 'net:mvrv',
    guide: 'net-mvrv',
  },
  {
    id: 'futures',
    title: '선물 쏠림 확인',
    description: '펀딩률의 부호와 단위',
    section: 'futures',
    panels: 'futures:funding',
    guide: 'futures-funding',
  },
] as const;
export function guideBasisLabel(basis: PriceBasis) {
  return basisName(basis);
}
