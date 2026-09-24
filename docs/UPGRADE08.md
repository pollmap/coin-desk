# Coin Desk 0.8: 자동 수집 복구와 첫 화면 정리

기준일: 2026-09-24 KST. 공개 주소: [coin-desk.pages.dev](https://coin-desk.pages.dev).

## 고친 문제

1. Binance 선물 공개 REST가 Cloudflare 배포 서버에서 HTTP 403을 반환해 BTC·DOGE·ETH 선물 차트가 비어 있었습니다. Bybit V5 공개 원천의 펀딩비·미결제약정으로 선물 원천을 교체했습니다. Cron 호출에서 Bybit 직접 접근도 차단되어, 서울 배치의 별도 `coin-desk-feed` Worker가 허용된 계약·기간만 조회하고 공유 비밀키로 본 Worker의 호출을 인증합니다. 기존 Binance 선물 관측은 저장되지 않았으므로 서로 다른 거래소의 값을 이어 붙이지 않았습니다.
2. 첫 화면에 BTC·DOGE·ETH 카드와 선택 코인 시세 영역이 중복되어 전체 가격 차트가 화면 아래로 밀렸습니다. 전체 이력 화면에서는 중복 시세 영역을 제거하고 모바일 세 코인 카드를 압축했습니다. 거래소 캔들 화면에는 시세·거래량·RSI 영역을 유지합니다.
3. 새 안내 캐릭터는 미니멀한 시바견으로 교체했습니다. 차트 뒤의 온체인 안내에 지연 로딩으로 배치해 첫 차트 전송량을 늘리지 않습니다.
4. Cron 실행 기록을 120분에서 72시간으로 확장했습니다. 상태 API의 `automation.observation48h`는 최근 48시간의 실제 실행 횟수·실패 횟수·관찰 가능 여부를 제공합니다. **배포 직후 48시간이 지나지 않은 기록은 관찰 완료로 표시하지 않습니다.**
5. BTC·DOGE 전체 가격 화면에 장기 가격 위치 밴드를 더했습니다. 각 날짜의 이전 730개 연속 일별 가격의 로그 평균·표준편차로 색상 구간을 계산하며, 미래 구간은 그리지 않습니다. 그때까지의 최고 종가 대비 낙폭을 함께 표시합니다. 적정가나 바닥 판정이 아닙니다.

## 데이터 계약

- 펀딩비: Bybit V5 `fundingRate` × 100, 단위 `%`, 정산 시각의 실제 응답만 저장.
- 미결제약정: Bybit V5 `openInterest`, 단위 해당 자산 수량(BTC·DOGE·ETH). USDT 가치로 환산하지 않음.
- 한 Cron 작업에서 최대 200행의 역순 이력을 처리하고 `endTime` 체크포인트로 이전 페이지를 읽습니다. 펀딩비는 제공 시작일까지, 미결제약정은 최근 30일을 우선 확보합니다. 새 관측도 같은 Cron이 확인합니다.
- 응답은 실제 `historyStart`·`dataAsOf`·`fetchedAt`과 원천·단위·지연 상태를 반환합니다. 원천 실패 시 마지막 정상값을 유지합니다.
- 기존 `GET /api/v1/derivatives` 경로와 페이지 계약을 유지합니다. 원천·단위가 바뀌었으므로 CSV와 화면의 출처 설명도 함께 바꿨습니다.

## 배포 순서와 검증

운영 D1에 `0008_cron_72h.sql`을 먼저 적용합니다. `FEED_TOKEN`을 무작위 값으로 생성해 `wrangler.feed.jsonc`와 `wrangler.jsonc` 두 Worker에 같은 값으로 각각 등록합니다. Feed Worker를 먼저 배포하고 익명 요청의 401 응답을 확인한 다음 본 Worker와 Pages를 배포합니다. `npm run check`와 `npm run build`, 공개 API·화면, 서버 Cron의 여섯 선물 작업을 확인합니다. 48시간 관찰 결과는 실제 시간이 지난 뒤에만 기록합니다.

개편 전 화면: [PC](audit-08/02-home-desktop-before.png), [모바일](audit-08/01-home-mobile-before.png). 개편 후 화면: [PC](audit-08/03-home-desktop-after.png), [모바일](audit-08/04-home-mobile-after.png). PC는 1440×900, 모바일은 390×844 기준입니다. 실제 최신 시세는 사이트에서 확인해야 합니다.

장기 가격 위치 화면: [BTC PC](audit-08/06-btc-bands-desktop.png), [DOGE 모바일](audit-08/05-doge-bands-mobile.png). `npm run check`에서 234개 테스트, `npm run build`가 통과했습니다. 2026-09-24 공개 상태 API에서 여섯 Bybit 선물 작업 모두 최근 성공·오류 0, 공개 조회에서 각 지표 5개 실제 관측과 출처·단위를 확인했습니다. 익명 Feed 요청은 401이었습니다. 48시간 연속 관찰은 아직 `ready: false`이며, 이전 연결 실패가 관찰 창에 남아 있습니다.

## 운영상 한계

선물은 Bybit 한 거래소의 자료로 전체 선물 시장을 대표하지 않습니다. DOGE·ETH의 거래소 현물 가격 비교선은 Binance 현물로 별도 표시합니다. Bybit 원천이 이후 차단되면 해당 지표만 지연 상태로 표시하고 가짜 시계열을 채우지 않습니다. 72시간 보관은 실행 증거이며 원천 API 성공을 보장하지 않습니다.
