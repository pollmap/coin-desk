# Coin Desk 0.7 분석 확장

기준일: 2026-09-23 KST. 이 문서는 소스 변경, 원천 확보, 공개 배포와 장기 운영 관찰을 구분합니다.

## 사용자 화면

- 첫 화면에 BTC·DOGE·ETH의 실제 시장 가격, 24시간 등락률과 관측 시각을 나란히 배치했습니다. 선택한 코인의 전체 USD 참조가격 차트를 크게 표시하며, SOL·XRP·LINK·ONDO·PEPE는 펼침 영역에 남깁니다. 기존 마지막 선택 복원·URL 우선 규칙, 작업공간과 그리기 자료를 유지합니다.
- 8개 코인 이미지는 Trust Wallet Assets의 동일 커밋에서 파일로 보관했습니다. 식별자, 원본 경로, 라이선스는 [로고 출처](COIN_LOGOS.md)에 기록했습니다. Coin Desk 로고와 혼동하지 않습니다.
- BTC 전체 가격에 완료된 200주 평균, 730일 평균과 5배, Pi Cycle 111일 평균·350일 평균의 2배를 선택형 선으로 표시합니다. 최댓값 대비 현재 낙폭은 UTC 일별 참조가격으로 계산합니다. 결측일을 보간하지 않고 필요한 표본 전에는 선을 그리지 않습니다.
- DOGE·ETH는 BTC와 **같은 UTC 날짜의 USD 참조가격**으로 상대가격·공통 시작일 100 성과·최고점 대비 낙폭·최근 연속 30/90일 로그수익률 상관을 계산합니다. 실제 DOGE/BTC 또는 ETH/BTC 거래 체결가가 아닙니다.
- 지표 탐색에 사이클·네트워크·선물 경로를 추가했습니다. 기존 BTC Bitview 상세 지표와 8개 코인 기술지표도 유지합니다.

## 데이터와 수집

| 자료 | 처리 | 실제 확인 범위 |
|---|---|---|
| BTC·ETH 거래소 유입·유출·보유량 | Coin Metrics Community 원본; 순유입은 유입−유출 계산 | BTC 2011-04-24, ETH 2015-07-30부터 2026-09-22까지 로컬 원본 적재·공개 API 첫 표본 확인 |
| DOGE 블록·신규 발행량 | Coin Metrics Community 일별 원본 | 2013-12-08부터 2026-09-22까지 로컬 원본 적재·공개 API 첫 표본 확인 |
| BTC·DOGE·ETH 펀딩비 | Binance USDⓈ-M `fundingRate`, 정산 비율을 퍼센트 포인트로 저장 | Cloudflare Worker의 원천 요청이 403이어서 현재 실제 이력 없음; 재시도·오류 기록 유지 |
| BTC·DOGE·ETH 미결제약정 | Binance USDⓈ-M `openInterestHist`, `sumOpenInterestValue`(USDT) | Cloudflare Worker의 원천 요청이 403이어서 현재 실제 이력 없음; 이후 연결되면 최근 제공 범위부터 축적 |
| BTC 미확인 거래·권장 수수료 | mempool.space 공개 API | 서버 첫 관측·공개 API 확인; 매 15분 갱신 정책 |

BTC·DOGE·ETH의 새 Coin Metrics 원본은 각각 6,472·4,672·4,073개 일별 행을 확보했습니다. 원본 응답·SHA-256 감사 기록과 월별 SQL은 Git 제외 `work/network/`에 보관했습니다. 동일 자산에서 지원하지 않는 지표는 노출하지 않습니다. 거래소 주소 분류와 원천의 `reviewed`/`flash` 상태에 따라 값이 수정될 수 있으므로 API `sourceStatus`와 설명에 표시합니다. Coin Metrics 자료는 [CC BY-NC 4.0](https://github.com/coinmetrics/data/blob/master/LICENSE) 조건을 표기합니다.

신규 `GET /api/v1/derivatives?asset=&metric=&from=&to=&limit=`는 `range`, `nextCursor`, 실제 최초·최신 관측, 원천, 단위, 수집 시각, 지연 상태를 반환합니다. `GET /api/v1/network-live?asset=BTC`는 마지막 정상 네트워크 관측과 지연 상태를 반환합니다. 두 API는 읽기 전용입니다. 기존 가격·온체인 API 계약은 유지했습니다.

D1 마이그레이션 `0007_derivatives.sql`을 먼저 적용하고, BTC·DOGE·ETH 월별 원천 이력을 원격 D1에 반영한 다음 Worker를 배포했습니다. Cloudflare Cron은 매분 작업 하나를 골라 방문자 접속과 독립적으로 진행합니다. 15분 네트워크, 시간별 선물, 일별 온체인을 작은 작업으로 나누며 실패는 마지막 정상 자료를 유지하고 재시도합니다.

## 검증

- TypeScript 검사와 **228개 테스트 / 25파일** 통과. 새 테스트는 미래 자료 사용 방지, UTC 날짜 일치·결측, 음수 펀딩비와 단위, 페이지 범위·커서, 원천 형식 오류, 거래소 순유입의 소거 오차와 수집 작업 우선순위를 검증합니다.
- 8개 Trust Wallet 이미지 URL에서 200 응답을 확인하고 8개 파일과 라이선스를 저장했습니다.
- 원격 D1 마이그레이션·BTC/DOGE/ETH 전체 원본 재적재 성공. 공개 API의 BTC 거래소 유입, ETH 순유입, DOGE 신규 발행 첫 표본과 날짜·단위를 확인했습니다.
- BTC mempool.space 첫 관측이 서버 Cron으로 저장되어 공개 API에서 조회됐습니다.
- 배포 후 `/api/v1/health`가 200으로 회복됐고, Cron의 후속 `mempool:BTC` 작업이 성공해 방문자와 무관한 재갱신을 확인했습니다.
- ETH 순유입의 큰 유입·유출 차감에서 부동소수점 소거 오차 2개 날짜를 발견해 원본 십진수로 다시 계산했습니다. 해당 2개 월만 D1에 교체한 후 BTC 6개·ETH 6개·DOGE 2개 새 지표의 **전체 공개 시계열**을 보관 원본과 대조했습니다.
- Binance USDⓈ-M API는 로컬에서 200이나 Cloudflare Worker에서 HTTP 403입니다. 펀딩비·미결제약정 패널은 실제 이력 없이 **원천 연결 대기**를 표시하며, 이 오류가 가격·온체인 핵심 데이터의 정상 판정을 오염시키지 않습니다. 서버는 재시도·오류 기록을 유지합니다.
- 1440px·390px 공개 화면에서 세 코인 카드, DOGE 상대 분석, BTC 사이클 기준선 키보드 조작, DOGE 신규 발행 지표의 URL 전환, 8개 로고 파일과 모바일 가로 넘침 없음을 확인했습니다. 같은 브라우저의 따뜻한 캐시에서 첫 차트 표시 0.6은 **378/346ms**, 0.7은 **1545/360ms**였습니다. 0.7 첫 측정은 새 번들을 받은 상태라 같은 냉 캐시 비교로 해석하지 않습니다.
- 48시간 연속 갱신과 계정 전체 무료 사용량은 배포 직후 **미관찰**입니다. 이 문서의 코딩·단기 검증만으로 장기 운영 완료를 주장하지 않습니다.

원천: [Coin Metrics Community](https://community-api.coinmetrics.io/v4/catalog/asset-metrics), [Binance 펀딩비](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [Binance 미결제약정](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), [mempool.space API](https://mempool.space/docs/api/rest), [Look Into Bitcoin의 사이클 차트 구성](https://www.lookintobitcoin.com/charts/market-cycle-charts/).
