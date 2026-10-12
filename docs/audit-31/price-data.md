# 가격 데이터 흐름 읽기 전용 검증

기준: 2026-10-12T15:31:44.042109+00:00 UTC. 대표 BTC·DOGE·ONDO·PEPE 표본 및 현행 명부 검사입니다. 경쟁 서비스의 비공개 DB·전처리를 알아냈다는 뜻이 아닙니다.

## 결과

- 양 공개 API 릴리스: `vps-335725ff7790b758`. 총 34회 GET 중 32회 HTTP 200, health 2회 HTTP 503. 직접 수집·overview를 호출하지 않았습니다.
- 현행 명부: 150자산, Upbit KRW 103쌍, Binance USDT 138쌍, Coin Metrics USD 참조 143자산. 지원 현물시장이 전혀 없는 자산 0개. 명부와 실제 최신 수집은 별개입니다.
- BTC·DOGE·ONDO·PEPE 양 거래소의 일봉·주봉·최초 이력, 4개 USD 참조 표본에서 날짜 역전·미래 시작시각·잘못된 OHLC·비양수 참조값 0건. 진행 봉은 `closed=false`로 반환됩니다.
- Upbit 공식 일봉 원천과 2026-10-11 UTC 확정 봉 OHLCV를 독립 대조하여 4자산×5필드 모두 일치했습니다.
- 67개 선물 누락은 2026-10-12 09:00:29 KST 재개 작업에서 복구됐습니다. 체크포인트와 별도의 읽기 전용 SQLite SELECT로 10개 범위·67개 슬롯 존재, 잔여 0개를 확인했습니다. 타이머는 정상 완료 후 비활성입니다. 이번 검사 DB 쓰기 0입니다.
- 현재 여유 공간 7.59GiB는 기존 8GiB 보호 기준 미만입니다. runtime의 과거 수집 상태는 `paused_low_space`입니다. 기존 데이터 삭제나 보호 기준 완화는 하지 않았습니다.
- 순차 summary 표본은 활성 1,585개 중 정상 1,557·지연 28입니다. 표본 health 실패 원인은 Upbit 최근 체결 지연입니다. 비활성 원천의 HTTP429 이력은 활성 지연 수와 섞지 않습니다.

## 실제 구조

1. `shared/asset-registry.json`의 자산 ID·거래소 심볼·Coin Metrics ID·Bybit 계약을 기준으로 자산을 식별합니다. 이번 명부의 현물 심볼은 모두 티커 기반의 현재 수집기 조합과 일치합니다.
2. 중앙 시세 `server/quote-hub.mjs`는 Upbit ticker의 `trade_timestamp`, Binance aggTrade의 `T`를 수신합니다. 코인·거래소별 단조 시각 검증과 제한된 SSE가 사용됩니다. 사용자별 외부 거래소 연결은 만들지 않습니다.
3. 분 시세는 `worker/providers.ts`의 일괄 수집과 SQLite snapshot/ingestion에 저장됩니다. Upbit은 실제 체결 시각이며 24시간 비교 기준을 별도로 조회합니다. Binance 분 fallback의 시각 정의는 아래 주의사항을 따릅니다.
4. 실제 거래소 OHLC는 `candles` 최근 테이블과 `price_archive`의 제한된 JSON chunk를 병합합니다. 같은 시각은 최근 수정 관측이 우선합니다. 일봉→주·월 OHLC 집계, 시간봉→4시간 집계를 수행하며 시간봉 조회는 기존 90일 제한을 유지합니다.
5. `/api/v1/candles` 허용 입력은 asset·market·interval·from·to·limit, 최대 1000개 반환과 nextCursor입니다. 1h·4h·1d·1w·1M을 지원합니다. 클라이언트는 날짜 구간으로 페이지를 병렬 묶음 조회하되 중복 시각을 제거합니다.
6. `/api/v1/reference`는 asset·from·to·limit 입력의 확정 UTC 일별 USD 종가선입니다. 실제 OHLC나 거래량이 없으며, 주·월 표시도 종가선으로만 사용해야 합니다.
7. 가격 기반 지표는 확정 봉으로 계산합니다. 반면 가격 전용 화면은 실제 진행 봉을 `closed=false`와 함께 표시할 수 있습니다. 기존 지표 렌더링의 확정 봉 필터를 그대로 쓰면 현재 진행 봉이 빠집니다.

## 원천별 최초 관측 표본

| 자산 | 원천 | 통화 | 최초 저장·반환 관측 UTC |
|---|---|---|---|
| BTC | Upbit | KRW | 2017-09-25 |
| BTC | Binance | USDT | 2017-08-17 |
| DOGE | Upbit | KRW | 2021-02-24 |
| DOGE | Binance | USDT | 2019-07-05 |
| ONDO | Upbit | KRW | 2024-06-14 |
| ONDO | Binance | USDT | 2025-04-11 |
| PEPE | Upbit | KRW | 2024-11-14 |
| PEPE | Binance | USDT | 2023-05-05 |

DOGE USD 참조는 2014-01-23부터 저장되어 있습니다. 출시일과 각 원천의 최초 제공일·거래소 상장일을 동일하게 표현하지 않습니다. 과거 자료를 다른 거래소나 통화와 이어 붙이지 않습니다.

## 수정·추가 검증 대상

- `coverage.priceMarkets=300`은 `worker/health.ts:603`의 `assets.length * 2`로 산출됩니다. 150×2 가능한 조합이며 실제 지원쌍은 241개이므로 지원 시장 수로 표시하지 않아야 합니다.
- Binance 분 fallback `ticker.24hr.closeTime`은 공식 문서의 ticker 구간 종료시각입니다. 이를 항상 실제 체결 시각으로 설명하는 UI는 근거가 부족합니다. SSE aggTrade.T와 별도 종류로 다루거나 실제 마지막 거래를 검증해야 합니다. 오래된 거래를 정상으로 판정하는 실증 사례는 이번에 재현하지 않았습니다. [Binance 공식 필드 정의](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market)
- 가격 거래소 선택 시 `market`과 `price_source` 동기화 누락은 주 작업에서 수정할 대상으로 이미 확인했습니다. 본 작업은 앱 파일을 수정하지 않았습니다.
- 150개 전체의 2026-10-11 읽기 전용 이력 대조표(482가격·442네트워크·143참조·680선물)를 기존 증거로 재사용했습니다. 이번 대표 표본이 모든 가격 이력의 신규 전수 검증을 대체하지 않습니다.

## 근거 파일

- ownbackend-price-flow.json: 출처·단위·현재 상태·검증 범위 요약.
- public-probe.json: 34개 읽기 GET 응답의 요약·SHA256·지연.
- remote-read.json: 목표 프로젝트의 원격 읽기 상태·SELECT·복구 기록.
- upbit-source-compare.json: 공식 원천 확정 OHLCV 대조.

앱 수정·배포·수집·백업·삭제·타이머 변경·대규모 부하·브라우저 조작은 수행하지 않았습니다.

## 기존 배포·백업 도구 위치

- `scripts/vps_release.py`: 공개 소스만 allowlist로 패키징하고 LF 정규화·모든 파일 SHA256·release ID를 산출합니다. 개인 원본·work·비밀 환경파일은 제외합니다.
- `scripts/vps_backup.py`: 온라인 SQLite snapshot, 모든 테이블 내용 fingerprint, 새 경로 restore, integrity 확인을 수행합니다. 기본 14일·2GiB 프로젝트 백업 보존 정책이 있으므로 기존 데이터를 삭제하지 않는 이번 범위에서는 함수를 무조건 실행하지 말고 기존 verified backup 상태부터 읽습니다.
- `server/backup-runner.mjs`: 현재 독립 백업 프로세스. `shared/data/backup-status.json` 및 해당 backup manifest의 최신 상태·SHA를 확인한 뒤 배포합니다.
- `deploy/vps/compose.yaml`, `deploy/vps/promote.py`, `deploy/vps/verify_runtime.py`: 컨테이너 구성·전환·운영 검증. `deploy/vps/activate.sh`는 최초 D1 이관 동결 증거를 요구하고 전체 collectors를 올리므로 이번 웹·API 변경 배포에 그대로 실행하면 안 됩니다.
- `work/indicator-030/prepare-reading.py`, `activate-reading.py`, `reading-deploy.py`: 직전 변경된 API만 교체·6개 기존 컨테이너 유지·verified backup guard·current atomic 전환·실패 rollback·기존 정적 자산 보존의 검증된 실행 예시입니다. 구 release와 파일 차이가 hardcode되어 있으므로 새 release에 맞춰 검토해야 합니다.
- Pages는 `pages/wrangler.jsonc`와 `pages/functions/api/[[path]].ts` proxy를 포함하도록 `wrangler pages deploy --cwd pages <dist> --project-name coin-desk` 형태를 사용합니다. `--cwd pages` 누락은 API가 JSON 대신 SPA HTML 200을 반환한 직전 배포 오류 원인이므로 반드시 JSON schema smoke까지 확인합니다.

원격 운영 루트는 `/srv/services/coin-desk`, DB는 그 아래 `shared/data/coin-desk.sqlite`입니다. 새 release 패키지·백업 공간까지 계산해 여유 공간 문제를 해결한 뒤 변경 서비스만 배포해야 합니다.
