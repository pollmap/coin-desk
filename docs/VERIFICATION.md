# Coin Desk 구현·공개 검증 기록

기준일: 2026-09-20 KST. 공개 주소: [coin-desk.pages.dev](https://coin-desk.pages.dev). 최초 BTC 전용 결과는 [0.1.0 기록](BTC_BASELINE.md)에 보존했습니다.

## 현재 결론

8개 코인의 실제 가격, 사용자 지정 기술지표, BTC 온체인과 시장 비중을 연결해 공개 배포했습니다. BTC·DOGE·ETH를 우선 배치했고 Pages 주소에서 API까지 동작합니다. **48시간 관찰과 장기 무료 운영 안정성 검증은 진행 중**입니다.

| 검증 항목 | 결과 |
|---|---|
| 자산 | BTC·DOGE·ETH·SOL·XRP·LINK·ONDO·PEPE, 각 Binance USDT / Upbit KRW |
| 기술지표 | SMA·EMA 기간 2~1,000, 일·주·선택 봉 기준; RSI 기간, 볼린저 기간·배수, MACD 12·26·9 |
| 차트 설정 | 프리셋, 추가·삭제, URL 공유·새로고침 복원, 시장 전환, 로그·확대 화면 |
| 온체인 | 기존 BTC 8개 지표 유지. 알트코인 지표로 잘못 표시하지 않음 |
| 도미넌스 | 8개 코인, USDT·USDC, 스테이블 전체 근사 비중. 시각·산식·출처 구분 |
| 로컬 검증 | TypeScript + 56개 테스트, 프런트 빌드 통과 |
| 실데이터 | 추가 자산 28개 이력의 확정 OHLCV 60,132개 일치, 최대 절대 차이 0 |
| 공개 조회 | 02:32:07 KST 검사 정상, 이슈 0. 16개 시장 현재가·BTC 지표 8개·도미넌스 |
| 반응형 | CSS 1440px·390px 가로 넘침 없음. 모바일 메뉴→도미넌스, DOGE KRW 확인 |
| 복구 | 확장 로컬 DB 8개 테이블 백업·별도 복원 해시 일치, 무결성 ok |

## 실제 데이터와 독립 계산

[추가 자산 비교](evidence/asset-validation.json)는 자산·시장·봉별 비교 개수와 오차를 기록합니다. 초기 Python REST 수집본과 페이지로 나누어 조회한 공개 API를 대조했습니다. 진행 중인 봉과 90일 보관 범위 밖 시간봉은 제외했습니다. 향후 원천 수정·갱신까지 검증한 결과는 아닙니다.

[독립 온체인 검산](evidence/independent-verification.json)에서 6,470일 중 유효 자본총액 표본 5,878일, MVRV-Z 5,514일을 비교했습니다. Python `statistics.pstdev`와 최대 절대 오차 `2.6645352591003757e-15`, 표시 MVRV와 시가총액/실현시가총액 오차 0입니다. 원천의 반올림된 별도 MVRV와 표시 산식 차이는 [데이터 정의서](DATA.md)에 기록했습니다.

`verify_custom.py`는 Decimal 정밀도 45로 혼합·초저가·횡보를 독립 계산합니다. EMA 5·21, RSI 7·21, 볼린저 14·2.5, MACD 12·26·9의 모든 유효 값을 TypeScript와 대조했습니다. 기존 상승·하락·횡보·파동과 실제 거래소 표본 8개 검산도 유지했습니다.

56개 테스트에는 UTC 주·월 경계, 윤년·결측, 페이지 경계, 미래 데이터 미사용, 아카이브 중복 시 수정값 우선, 429·빈 응답·WebSocket 중단, 마지막 정상값 유지, 초저가 표시, 도미넌스 USD 단위·결측 처리가 포함됩니다. 오프라인 검증은 원천의 향후 가용성을 보장하지 않습니다.

## 브라우저 검수

공개 DOGE 차트에 **SMA 55일**을 추가하고 공유 URL의 `sma:55:d`를 확인했습니다. 새로고침 후 같은 선과 값이 복원됐습니다. 단기 프리셋의 EMA 20·50, RSI·MACD 패널과 확대 화면 진입·종료를 확인했습니다. 모바일에서 DOGE KRW 전환, 메뉴→도미넌스 이동을 검사했고 해당 흐름의 앱 콘솔 오류는 없었습니다.

- [대시보드 1440px](screenshots/coin-desk-desktop.png)
- [DOGE 사용자 이동평균](screenshots/doge-custom.png)
- [DOGE 원화·RSI·MACD 모바일 390px](screenshots/coin-desk-mobile.png)
- [시장 도미넌스](screenshots/dominance-desktop.png)

검수 시 도미넌스 첫 관측 하나만 존재해 과거 선을 만들지 않고 다음 관측 대기를 표시했습니다. 같은 산식의 두 번째 관측부터 차트를 표시합니다. 전체 과거 도미넌스를 확보했다고 주장하지 않습니다.

## 원천 장애와 공개 운영

Binance REST는 Cloudflare에서 403/451을 반환해 공식 WebSocket 시장 API로 연결했습니다. 초기 CLI REST와 공개 이력 일치는 별도 검산했습니다. CoinGecko는 로컬에서 응답했지만 Cloudflare에서 반복 429가 발생해 운영 원천에서 제외하고 과거 실패를 `active:false`로 보존했습니다.

코인 도미넌스는 CoinLore 개별/전체 시가총액, 스테이블 전체는 DefiLlama 일별 USD 총액/CoinLore 전체로 연결했습니다. 후자는 다른 원천·시점의 **근사 비중**입니다. 원화나 토큰 개수를 USD에 더하지 않으며 CoinGlass·TradingView 지수와 동일하다고 표시하지 않습니다. CoinLore 개별 기준 시각이 없어 조회 시각을 표시합니다.

[공개 API 검사](evidence/coin-desk-api-check.json)에 실제 성공 시각·기준일·응답 지연을 남겼습니다. 수집 성공과 온체인 기준일을 구분하며 지연 시 마지막 정상값을 새 값처럼 표시하지 않습니다.

화면 검수 배포는 Worker `9e1aa7fd-2533-44b2-9da7-da0d8f1af2fe`, Pages `1d4ca159`입니다. 이후 도미넌스 이력 시작일을 같은 계산 버전 기준으로 맞추고, 보관 기한이 움직이는 시간봉의 미검산 전체 행 수를 `null`로 표시하는 보완을 포함해 병합·배포합니다. 실제 GitHub 병합·배포 결과는 PR·배포 기록으로 확인합니다.

## 성능·무료 한도

추가 7개 자산은 256봉 묶음과 최근 일반 행으로 나누어 D1 쓰기 15,532행, 당시 DB 약 8.96MB를 측정했습니다. 최초 BTC 적재 34,810행 쓰기는 별도 작업이며 계정 전체 사용량을 합산한 수치는 아닙니다.

차트 데이터 설정 후 두 화면 프레임이 지난 `performance.now()`를 페이지 새로고침 기준으로 측정했습니다. 이번 PC 표본 1,402ms, 모바일 2,442ms였습니다. 이전에는 3.1~4.1초도 있어 **모든 최초 방문에서 3초 목표를 통과했다고 판정하지 않습니다.** 화면 내 시장 전환 후의 누적 시간은 초기 로딩 측정에서 제외했습니다.

[CPU 표본](evidence/coin-desk-runtime.json)은 IP·헤더 없이 132개 실행을 보관합니다. 최대 CPU 12ms, 실패 0, 10ms 초과 Cron 3개입니다. DefiLlama에서 마지막 관측만 파싱하도록 개선했으나 **무료 CPU 한도에 충분한 여유가 있다고 판정하지 않습니다.** 관찰 중 CPU 제한·실패가 발생하면 수집 크기와 런타임 초기화 비용을 추가 조정해야 합니다. 결제나 유료 전환은 하지 않았습니다.

`npm audit`는 앞선 설치 검사에서 취약점 0개였지만 02:33 KST 재검사에 npm 레지스트리가 유지보수 503을 반환했습니다. 이 시점의 최신 취약점 재검사는 미완료이며 타입·테스트·빌드 결과와 구분합니다.

## 복구와 48시간 관찰

[확장 DB 복구](evidence/coin-desk-recovery.json)는 8개 테이블을 별도 백업·복원해 해시가 일치한 결과입니다. 기존 원격 D1 내보내기→별도 로컬 SQLite 복원과 Worker 롤백은 [최초 배포 기록](BTC_BASELINE.md)에 있습니다. 새 원격 D1 복구 후 운영 바인딩을 전환하는 장애 훈련은 실행하지 않았습니다.

- 확장 버전 정상 관찰 시작: **2026-09-20 02:17:07 KST**.
- 48시간 경과: **2026-09-22 02:17:07 KST**.
- 기존 자동화 `btc-desk-48`를 **Coin Desk 공개 운영 48시간 확인**으로 갱신했습니다.
- 매시간 `check_live.py`로 8개 자산·BTC 온체인·도미넌스를 검사하고 `work/observation.jsonl`에 실패도 보존합니다.
- 같은 상태는 알리지 않고 장애·회복·완료·조치 필요 때 알립니다. PC/Codex 중단에 따른 공백도 기록합니다.

종료 뒤 성공 시각의 진행, 지연, 오류·공백·사용량을 반영해야 합니다. 현재는 완료로 표시하지 않습니다. BTC 외 온체인, 청산 히트맵, UTXOs in Loss %, MVRV-Z 730일 특수 밴드와 구리/금 비교는 이번 범위에 포함하지 않았습니다.

## 재검증

```sh
npm ci
python scripts/verify_custom.py
npm run check
npm run build
python scripts/check_docs.py
python scripts/package_release.py
```

원천 수집 후 `python scripts/verify.py`, `python scripts/check_assets.py --base https://coin-desk.pages.dev`로 독립·공개 검산을 재현합니다. GitHub CI는 오프라인 테스트·타입·빌드·문서·패키지만 실행합니다. 공개 상태 검사는 `python scripts/check_live.py --base https://coin-desk.pages.dev`입니다. 배포·복구는 [운영 안내](OPERATIONS.md)를 참고합니다.
