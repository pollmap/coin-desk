# 지표 정의 대조표

지원 범위는 카탈로그이며 실시간 원천 정상 여부와 구분합니다. 원천 제공값을 독립 재계산했다고 표현하지 않습니다. 숫자 예시는 현재 시세가 아닙니다.

| 지표 | 코인 | 원천·단위 | 공식 | 계산 위치 |
|---|---|---|---|---|
| net:mvrv MVRV | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · 배 | Coin Metrics CapMVRVCur = CapMrktCurUSD / CapRealUSD | shared/network-catalog.ts; worker/network-data.ts |
| net:active_addresses 활성 주소 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · 주소 / 일 | UTC 하루 동안 활동한 고유 주소의 수 | shared/network-catalog.ts; worker/network-data.ts |
| net:balance_addresses 잔고 보유 주소 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · 주소 | UTC 일말 잔고가 0보다 큰 주소 수 | shared/network-catalog.ts; worker/network-data.ts |
| net:transactions 거래 수 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · 건 / 일 | UTC 하루의 온체인 거래 수 · 원천의 체인별 포함 규칙 | shared/network-catalog.ts; worker/network-data.ts |
| net:transfers 전송 수 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · 건 / 일 | UTC 하루의 양수 자산 전송 수 · 수수료와 신규 발행 제외 | shared/network-catalog.ts; worker/network-data.ts |
| net:supply 현재 원장 공급량 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · 자산 단위 | Coin Metrics SplyCur · 원장 잔고 기준 | shared/network-catalog.ts; worker/network-data.ts |
| net:market_cap 원장 공급 기준 시가총액 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · USD | SplyCur × PriceUSD | shared/network-catalog.ts; worker/network-data.ts |
| net:fees_native 총 거래 수수료 | BTC, DOGE, ETH, XRP | Coin Metrics · 자산 단위 / 일 | UTC 하루의 거래 수수료 합계 (네이티브 단위) | shared/network-catalog.ts; worker/network-data.ts |
| net:hashrate 평균 해시레이트 | BTC, DOGE | Coin Metrics · TH/s | 원천의 난이도·블록 생성 간격 기반 추정 · 1 TH/s = 초당 10¹² 해시 | shared/network-catalog.ts; worker/network-data.ts |
| net:blocks 하루 생성 블록 | BTC, DOGE, ETH | Coin Metrics · 블록 / 일 | Coin Metrics BlkCnt · UTC 일별 블록 수 | shared/network-catalog.ts; worker/network-data.ts |
| net:issuance 신규 발행량 | BTC, DOGE, ETH | Coin Metrics · 자산 단위 / 일 | Coin Metrics IssTotNtv · 신규 발행 자산 수량 | shared/network-catalog.ts; worker/network-data.ts |
| net:exchange_inflow 거래소 유입 | BTC, ETH | Coin Metrics · 자산 단위 / 일 | Coin Metrics FlowInExNtv | shared/network-catalog.ts; worker/network-data.ts |
| net:exchange_outflow 거래소 유출 | BTC, ETH | Coin Metrics · 자산 단위 / 일 | Coin Metrics FlowOutExNtv | shared/network-catalog.ts; worker/network-data.ts |
| net:exchange_balance 거래소 보유량 | BTC, ETH | Coin Metrics · 자산 단위 | Coin Metrics SplyExNtv | shared/network-catalog.ts; worker/network-data.ts |
| net:exchange_netflow 거래소 순유입 · 계산 | BTC, ETH | Coin Metrics · 자산 단위 / 일 | FlowInExNtv − FlowOutExNtv | shared/network-catalog.ts; worker/network-data.ts |
| net:realized_cap 실현시가총액 · 역산 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · USD | CapMrktCurUSD / CapMVRVCur (MVRV > 0) | shared/network-catalog.ts; worker/network-data.ts |
| net:realized_price 실현가격 · 역산 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · USD | PriceUSD / CapMVRVCur (MVRV > 0) | shared/network-catalog.ts; worker/network-data.ts |
| net:nupl NUPL · 역산 | BTC, DOGE, ETH, XRP, LINK | Coin Metrics · 비율 | 1 − 1 / CapMVRVCur (MVRV > 0) | shared/network-catalog.ts; worker/network-data.ts |
| btc:mvrv MVRV | BTC | Bitview · 배 | 시가총액 ÷ 실현시가총액 | shared/catalog.ts; worker/providers.ts |
| btc:realized_price 실현가격 | BTC | Bitview · USD | 실현시가총액 ÷ 공급량 | shared/catalog.ts; worker/providers.ts |
| btc:sopr_24h SOPR | BTC | Bitview · 배 | 24시간 사용된 출력의 이동 시점 가치 합 ÷ 생성 시점 가치 합 | shared/catalog.ts; worker/providers.ts |
| btc:nupl NUPL | BTC | Bitview · % | (시가총액 − 실현시가총액) ÷ 시가총액 | shared/catalog.ts; worker/providers.ts |
| btc:mvrv_z MVRV-Z | BTC | Bitview · Z | (시가총액 − 실현시가총액) ÷ 해당일까지의 시가총액 모집단 표준편차 · 최소 365개 유효 일별 표본 | shared/catalog.ts; worker/providers.ts |
| btc:sth_mvrv 단기 보유자 MVRV | BTC | Bitview · 배 | BTC 가격 ÷ 단기 보유자 실현가격 | shared/catalog.ts; worker/providers.ts |
| btc:lth_mvrv 장기 보유자 MVRV | BTC | Bitview · 배 | BTC 가격 ÷ 장기 보유자 실현가격 | shared/catalog.ts; worker/providers.ts |
| btc:sth_realized_price 단기 보유자 실현가격 | BTC | Bitview · USD | 단기 보유자 실현시가총액 ÷ 해당 집단 공급량 | shared/catalog.ts; worker/providers.ts |
| futures:funding 확정 펀딩률 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | Bybit USDT 무기한 · % | 실제 정산 펀딩 비율 × 100 | shared/derivative-contracts.ts; worker/derivatives.ts |
| futures:open_interest 미결제약정 · 시간별 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | Bybit USDT 무기한 · 자산 | Bybit USDT 무기한 계약의 코인 수량 | shared/derivative-contracts.ts; worker/derivatives.ts |
| futures:open_interest_daily 미결제약정 · 일별 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | Bybit USDT 무기한 · 자산 | Bybit USDT 무기한 계약의 코인 수량 · 일별 | shared/derivative-contracts.ts; worker/derivatives.ts |
| futures:long_account_ratio 롱 계정 비중 · 시간별 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | Bybit USDT 무기한 · % | 롱 보유 계정 / 전체 포지션 보유 계정 × 100 | shared/derivative-contracts.ts; worker/derivatives.ts |
| futures:long_account_ratio_daily 롱 계정 비중 · 일별 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | Bybit USDT 무기한 · % | 롱 보유 계정 / 전체 포지션 보유 계정 × 100 · 일별 | shared/derivative-contracts.ts; worker/derivatives.ts |
| rsi RSI 14 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · RSI | RSI = 100 − 100 / (1 + 평균 상승폭 / 평균 하락폭) · Wilder 14일 | shared/indicators.ts; src/IndicatorWorkspace.tsx |
| drawdown 고점 대비 낙폭 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · % | (당일 종가 / 그날까지 최고 종가 − 1) × 100 | shared/indicators.ts; src/IndicatorWorkspace.tsx |
| relative BTC 대비 가격 비율 | DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · BTC/자산 | 같은 원천·통화·UTC 날짜의 코인 종가 / BTC 종가 | shared/indicators.ts; src/IndicatorWorkspace.tsx |
| volume 거래량 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 자산 | 선택 거래소의 확정 일봉 거래량 | shared/indicators.ts; src/IndicatorWorkspace.tsx |
| view:price 가격·지표 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | 몸통=/종가−시가/, 범위=고가−저가 | shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx |
| view:rainbow 가격 위치 밴드 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | exp(μ + kσ) · 표시일 이전 연속 730일 로그가격 | shared/history-bands.ts; src/IndicatorWorkspace.tsx |
| view:btc_rainbow BTC 레인보우 · 로그회귀 | BTC | 선택 가격 원천 · 가격 | ln(P) = a + b × ln(제네시스 이후 경과일) · 과거 관측만 회귀 | shared/btc-rainbow.ts; src/IndicatorWorkspace.tsx |
| view:ribbon 이동평균 리본 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | 기본 SMA 7·25·50·100, 장기 SMA 20·50·100·200, 빠른 EMA 8·13·21·34·55·89. 선택 봉의 확정 종가 기준. | shared/indicators.ts; src/IndicatorWorkspace.tsx |
| view:vwap 365일 VWAP | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | 연속 365일 Σ((고가+저가+종가)/3 × 코인 거래량) / Σ거래량 | shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx |
| view:bb 볼린저밴드 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | 20개 확정 종가의 SMA ± 2 × 모집단 표준편차 | shared/indicators.ts; src/IndicatorWorkspace.tsx |
| view:relative 상대강도·상관 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | 공통 날짜 정렬; 상관은 연속 30·90·365일 로그수익률의 Pearson 계수 | shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx |
| view:cycles 반감기 사이클 | BTC | 선택 가격 원천 · 가격 | 각 구간 첫 관측을 100으로 정규화 · 실제 경과일 축 | shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx |
| view:windows 과거 구간 비교 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | 각 구간 첫 관측=100 · 경과일 정렬 | shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx |
| view:seasonality 계절성 | BTC, DOGE, ETH, SOL, XRP, LINK, ONDO, PEPE | 선택 가격 원천 · 가격 | 완전 연도 최소 3개 · 전년 말 종가 대비 누적수익률; 올해는 관측까지만 별도 | shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx |
| view:powerlaw BTC 파워로 기준선 | BTC | 선택 가격 원천 · 가격 | 4.42×10⁻¹⁷ × (2009-01-03 이후 일수)^5.6 | shared/advanced-analysis.ts; src/IndicatorWorkspace.tsx; src/AnalysisLab.tsx |
| chain:tvl Ethereum DeFi TVL | ETH | DefiLlama · Ethereum · USD | Ethereum 체인의 DeFi 예치 가치 · ETH 토큰 시가총액과 별개 | worker/ethereum-context.ts |
| chain:stablecoins Ethereum 스테이블코인 공급 | ETH | DefiLlama · Ethereum · USD | Ethereum 체인 스테이블코인의 USD 평가액 합계 | worker/ethereum-context.ts |
