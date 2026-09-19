export interface MetricGuideData {
  question: string;
  read: string;
  example: string;
  caveat: string;
  pair: string;
  related: string[];
  source: string;
}
const brk = 'https://bitview.space/api';
const mvrv = 'https://docs.glassnode.com/further-information/metric-guides/mvrv/mvrv-ratio';
export const METRIC_GUIDES: Record<string, MetricGuideData> = {
  mvrv: {
    question: '현재 평가액은 코인의 마지막 이동 가치보다 얼마나 높은가요?',
    read: '1보다 크면 시가총액이 실현시가총액보다 크고, 1보다 작으면 더 작습니다. 절대값과 여러 달의 방향을 함께 보세요.',
    example:
      '산식 예시: 1.5배는 현재 평가액이 실현평가액보다 50% 크다는 뜻입니다. 현재 시장 수치를 뜻하는 예시는 아닙니다.',
    caveat:
      '1 아래라고 바닥이 확정되지 않습니다. 온체인 이동에는 자기 지갑 간 전송도 포함되므로 실제 매수가와 차이가 있습니다.',
    pair: 'SOPR로 최근 이동한 코인의 손익을 함께 보세요. 같은 원천의 NUPL은 1−1/MVRV이므로 독립적인 확인 신호가 아닙니다.',
    related: ['sopr_24h', 'nupl'],
    source: mvrv,
  },
  realized_price: {
    question: '마지막 이동 가격으로 평가한 코인 한 개의 평균 가치는 얼마인가요?',
    read: '같은 Bitview 추정 USD 가격선이 실현가격 위·아래에 있는지, 둘 사이의 간격이 커지는지 살펴보세요.',
    example: '산식 예시: 실현평가액 1,000억 달러 / 공급 100만 개 = 실현가격 10만 달러.',
    caveat:
      '실제 투자자의 평균 매수가나 보장된 지지선이 아닙니다. Binance USDT 또는 Upbit KRW와 직접 혼합 계산하지 않습니다.',
    pair: '단기 보유자 실현가격과 비교하면 전체 집단과 단기 집단의 평가 기준 차이를 볼 수 있습니다.',
    related: ['sth_realized_price', 'mvrv'],
    source: brk,
  },
  sopr_24h: {
    question: '최근 이동한 코인은 생성 당시 가치보다 이익 상태였나요?',
    read: '1 위는 이동 시점 가치 합이 생성 시점 가치 합보다 큼을, 1 아래는 그 반대를 뜻합니다. 하루 값과 지속 기간을 구분하세요.',
    example:
      '산식 예시: 1.02는 이 지표가 집계한 가치 비율이 2% 높다는 뜻입니다. 투자자 모두가 2% 이익이라는 의미는 아닙니다.',
    caveat:
      '이동을 모두 거래소 매도로 볼 수 없습니다. aSOPR이나 특정 업체의 엔티티 조정 SOPR과 같은 지표가 아닙니다.',
    pair: 'MVRV의 보유 중 평가 상태와 SOPR의 최근 이동 상태를 나누어 읽습니다.',
    related: ['mvrv'],
    source:
      'https://docs.glassnode.com/further-information/metric-guides/sopr/sopr-spent-output-profit-ratio',
  },
  nupl: {
    question: '현재 전체 평가액 중 미실현 손익은 어느 정도인가요?',
    read: '0 위는 순미실현 이익, 0 아래는 순미실현 손실 상태입니다. 여기서는 비율을 퍼센트로 표시합니다.',
    example: '산식 예시: NUPL 0.25는 화면에서 25%로 표시됩니다. 값이 25→30%이면 변화는 +5%p입니다.',
    caveat:
      '같은 원천에서는 NUPL=1−1/MVRV입니다. 두 지표가 같이 움직인다고 별도의 증거가 하나 더 생기지는 않습니다.',
    pair: 'SOPR과 비교해 보유 중인 평가 손익과 실제 이동한 출력의 손익 비율을 구분하세요.',
    related: ['sopr_24h', 'mvrv'],
    source: 'https://docs.glassnode.com/basic-api/endpoints/indicators',
  },
  mvrv_z: {
    question: '시장 평가와 실현평가의 차이는 과거 변동 폭에 비해 얼마나 큰가요?',
    read: '각 날짜까지의 시가총액 모집단 표준편차를 분모로 사용합니다. 첫 365개 유효 일별 표본이 쌓이기 전에는 표시하지 않습니다.',
    example:
      '산식 예시: 평가액 차이 3 / 누적 표준편차 2 = Z 1.5. 배수나 퍼센트와는 다른 단위입니다.',
    caveat:
      '미래 고점을 예측하는 값이 아닙니다. 계산 시작일·가격 원천이 다르면 타사 Z값과 달라집니다. 730일 가격 밴드도 아닙니다.',
    pair: 'MVRV와 같은 원자료를 변환한 지표입니다. 산식 차이를 확인하고 별도 독립 신호로 세지 마세요.',
    related: ['mvrv', 'realized_price'],
    source: 'https://docs.glassnode.com/further-information/metric-guides/mvrv/mvrv-z-score',
  },
  sth_mvrv: {
    question: '단기 보유자 집단의 평가 상태는 어떤가요?',
    read: 'Bitview 단기 보유자 집단에서 1을 기준으로 가격과 실현가격의 상대 위치를 살펴봅니다.',
    example: '산식 예시: 동일 원천 BTC 가격 110 / 단기 실현가격 100 = 1.1배.',
    caveat:
      '집단은 코인의 이동 이력에 따른 원천 분류입니다. 실제 사람의 신규·기존 투자 여부를 식별한 결과가 아닙니다.',
    pair: '장기 보유자 MVRV와 나란히 보세요. 단기 실현가격은 이 비율의 분모이므로 별도 근거로 중복 계산하지 않습니다.',
    related: ['lth_mvrv', 'sth_realized_price'],
    source: brk,
  },
  lth_mvrv: {
    question: '오래 이동하지 않은 코인 집단의 평가 상태는 어떤가요?',
    read: 'Bitview 장기 보유자 집단의 실현평가와 현재 가격을 비교합니다. 단기 집단과 값의 차이 및 추이를 살펴보세요.',
    example: '산식 예시: 동일 원천 BTC 가격 150 / 장기 실현가격 100 = 1.5배.',
    caveat:
      '높은 값만으로 장기 투자자의 매도를 단정할 수 없습니다. 원천별 보유자 분류를 섞지 않습니다.',
    pair: '단기 보유자 MVRV로 집단 차이, SOPR로 최근 이동 상태를 확인할 수 있습니다.',
    related: ['sth_mvrv', 'sopr_24h'],
    source: brk,
  },
  sth_realized_price: {
    question: '단기 보유자 집단의 마지막 이동 가격 기준은 얼마인가요?',
    read: '같은 원천 BTC 추정 가격이 이 선에서 얼마나 떨어져 있는지 봅니다. 단기 MVRV는 이 관계를 비율로 표현합니다.',
    example: '산식 예시: 집단 실현평가액 500억 달러 / 해당 공급 50만 개 = 10만 달러.',
    caveat:
      '단기 투자자 전원의 실제 평균 매수가가 아니며, 선을 통과했다고 반등이나 하락을 확정하지 않습니다.',
    pair: '전체 실현가격과 비교해 집단 간 가격 기준 차이를 살펴보세요.',
    related: ['realized_price', 'sth_mvrv'],
    source: brk,
  },
  sma: {
    question: '가격 추세와 최근 평균의 위치가 어떻게 달라졌나요?',
    read: 'SMA는 기간 내 종가에 같은 비중, EMA는 최근 종가에 더 큰 비중을 줍니다. 평균선의 방향과 가격의 위치를 함께 봅니다.',
    example:
      '일봉 기준 200은 200일, 주봉 기준 200은 200주입니다. 선택 봉 기준 20은 시간봉에서는 20시간입니다.',
    caveat:
      '과거 가격을 평활한 후행 지표입니다. 짧은 기간일수록 변화에 민감하고 잦은 교차가 생깁니다.',
    pair: '거래량과 함께 추세의 지속을 살펴보세요. EMA와 MACD는 같은 가격 정보를 활용하므로 독립성을 과장하지 않습니다.',
    related: [],
    source: 'https://www.tradingview.com/support/solutions/43000502589-moving-averages/',
  },
  rsi: {
    question: '최근 상승 폭과 하락 폭 중 어느 쪽이 강했나요?',
    read: '0~100에서 최근 상승·하락 폭의 상대 강도를 읽습니다. 70·30은 흔히 쓰는 관찰선이며 50은 상대적인 중간 지점입니다.',
    example:
      'RSI 14는 선택 봉 14개 기준입니다. 일봉 RSI와 주봉 RSI는 서로 다른 기간의 움직임을 요약합니다.',
    caveat:
      '70 위여도 상승이 이어지고 30 아래여도 하락이 이어질 수 있습니다. 해당 선을 매수·매도 명령처럼 읽지 않습니다.',
    pair: '가격의 고점·저점, 이동평균 방향과 함께 비교하세요. 모든 기술지표는 같은 가격에서 파생됩니다.',
    related: [],
    source:
      'https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/',
  },
  bb: {
    question: '최근 가격의 변동 범위가 넓어지고 있나요?',
    read: '중심선과 위·아래 밴드의 폭을 봅니다. 기본은 20봉 SMA에 모집단 표준편차의 2배를 더하고 뺍니다.',
    example:
      '설정의 20은 봉 개수, 2는 표준편차 배수입니다. 배수를 키우면 같은 표본의 밴드가 넓어집니다.',
    caveat:
      '밴드 접촉은 반전 확정이 아닙니다. 강한 추세에서는 한쪽 밴드를 따라 계속 움직일 수 있습니다.',
    pair: '가격 추세·거래량과 함께 변동 폭의 확대·축소를 봅니다. 밴드는 미래 가격의 확률 보증 구간이 아닙니다.',
    related: [],
    source: 'https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/',
  },
  macd: {
    question: '단기 평균과 장기 평균의 간격은 커지고 있나요?',
    read: 'MACD선은 EMA12−EMA26, 신호선은 MACD의 EMA9, 막대는 두 선의 차이입니다. 0선과 신호선 교차를 구분합니다.',
    example:
      'MACD +100 / 신호선 +80이면 히스토그램은 +20입니다. 이는 +20% 수익률이라는 뜻이 아닙니다.',
    caveat:
      '가격과 같은 단위여서 코인 간 절대 크기를 비교하기 어렵습니다. 교차 뒤에 횡보나 재교차가 이어질 수 있습니다.',
    pair: '긴 기간의 평균선으로 추세를 먼저 보고 막대로 두 선의 간격 변화를 확인하세요.',
    related: [],
    source:
      'https://www.tradingview.com/support/solutions/43000502344-moving-average-convergence-divergence-macd-indicator/',
  },
};
