# 0.29 슈퍼트렌드 검증

사용자가 제공한 DOGE Binance 주봉의 Supertrend(10,3)를 기존 모든 추적 코인에서 사용할 수 있도록 구현합니다. 기본값과 전체 이력, 실제 OHLC의 거래소·통화, 마지막 확정 봉을 구분합니다. 원천·봉 간격·결측 조건이 다른 TradingView 화면과 모든 숫자가 같다고 표현하지 않습니다.

계산은 `shared/supertrend.ts`, 표시·설정·설명 연결은 `src/IndicatorWorkspace.tsx`, 계단형 선과 채움은 `src/SupertrendPrimitive.ts`에 있습니다. `scripts/verify_supertrend.py`의 독립 Decimal 계산과 TypeScript 결과를 대조합니다. 테스트 자료는 현재 시세가 아닌 결정론적 합성 OHLC입니다.

이번 검증에는 ATR 초기 평균·재귀 평균, 상하 경계 유지, 양 방향 전환, 동일 경계, 미확정·미래 봉 제외, 결측·잘못된 OHLC 후 재시작, 작은 가격 단위, 시간·일·주·월 간격, 150개 지원 원천, 한국어 검색, 설명과 저장 설정 연결을 포함합니다.

실제 운영 데이터 검산·원격 CI·배포 증거는 완료한 검사별로 이 폴더에 기록합니다. 모든 수집 원천 정상, 실제 Apple Safari·VoiceOver, 사람 대상 사용성 시험을 자동 검사 통과로 대신하지 않습니다. 48시간 대기는 적용하지 않습니다.
