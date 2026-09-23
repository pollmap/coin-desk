# Coin Desk 실행·배포·복구 안내

기준일: 2026-09-23 KST. 공개 주소: [coin-desk.pages.dev](https://coin-desk.pages.dev). 소스: [pollmap/coin-desk](https://github.com/pollmap/coin-desk).

## 0.7.0 현재 운영 기준

[0.7 확장·검증 기록](UPGRADE07.md)을 기준으로 운영합니다. `0007_derivatives.sql`은 Worker 배포 전에 원격 D1에 적용합니다. BTC·DOGE·ETH는 새 Coin Metrics 지표를 포함해 `python scripts/bootstrap_network.py --assets BTC,DOGE,ETH`로 원본을 받고, `node scripts/import_network.mjs BTC,DOGE,ETH`로 로컬 검증합니다. 원격에는 세 자산별 `work/network/<ASSET>.sql`을 순서대로 적용합니다. 원본·SQL은 `work/`에 보관하며 Git에 넣지 않습니다.

Cloudflare Cron은 방문자 없이 매분 작업 하나를 실행합니다. mempool.space는 15분, 선물 6개 작업은 매시간 목표로 갱신하고 Binance 최초 펀딩비 이력은 페이지별 체크포인트로 축적합니다. 미결제약정은 제공되는 최근 범위부터 시작합니다. 선물 원천 접근이 배포 환경에서 실패하면 `/status`의 `derivatives:*` 오류를 확인하고 화면에는 원천 연결 대기·마지막 정상값만 표시합니다. 임의 가격이나 선물 수치를 채우지 않습니다. 48시간 관찰은 배포 직후 별도 진행합니다.

## 0.5.0 도입 기록

0.5.0에서는 [릴리스 기록](UPGRADE05.md)과 [무료 원천·산식 조사](RESEARCH05.md)를 기준으로 `0006_network.sql`을 적용해 `network_months`, `network_coverage`를 추가했습니다. 당시 5개 코인의 56개 온체인 시계열과 5개 장기 참조가격 작업을 Cloudflare Cron에서 갱신했습니다. 초기 적재는 `bootstrap_network.py` → `import_network.mjs`, 전량 대조는 `verify_network.py`를 사용했습니다.

## 0.4.0 도입 기록

0.4.0에서 도입한 기능입니다. BTC·DOGE·ETH 장기 USD 이력, 전체 기간 우선·8개 기간 선택, 질문별 지표 안내, 비교 직접 날짜와 캐시, 독립적인 서버 자동 수집·상태 화면을 포함합니다. 장기 참조가격 원격 적재와 보관 원본 **14,589개 값의 공개 API 일치**를 확인했습니다. 최종 코드·화면·배포 검증은 [0.4 개선·검증 보고서](UPGRADE04.md)에 기록합니다.

**마이그레이션 `0004_automation.sql`과 `0005_reference_prices.sql`을 새 Worker 배포 전에 적용해야 합니다.** 전자는 Cron 실행 상태·120개 순환 실행 기록, 후자는 Coin Metrics 참조가격 테이블을 만듭니다. 로컬은 DB를 열 때 모든 마이그레이션을 적용하며, 운영 D1은 아래 Wrangler 명령으로 따로 적용합니다.

0.4.0 확인 흐름:

1. 홈 BTC·DOGE·ETH의 **전체 USD 이력**에서 원천 시작일과 전체 차트의 실제 가시 범위를 확인합니다. 거래소 캔들 전환 후 일·주·월·로그축·직접 날짜도 확인합니다.
2. 1·3·6개월·올해·1·3·5년·전체, 공유 URL과 저장한 기간을 복원합니다. `/compare`는 UTC 직접 날짜와 공통 기간을 제한한 코인을 확인합니다.
3. `/explore`에서 질문별 분류·활용 설명 검색·읽는 방법을 사용하고, 선택한 코인의 전체 차트에 기술지표를 적용합니다.
4. `/status`의 마지막 Cron 완료·원천 실제 기준일·다음 작업·실패를 확인합니다. `/api/v1/health`는 운영 조건을 만족하면 200, 지연·실패 사유가 있으면 503입니다.
5. 로컬과 공개 `verify_reference.py`를 실행하고, 배포 버전별 CPU·D1 사용량과 방문자가 없는 동안의 Cron 진행을 관찰합니다.

최근 CPU 관측은 최대 **14ms**, Cron 최대 **13ms**입니다. 관측 요청의 정상 완료는 무료 CPU 10ms 예산의 지속 충족을 뜻하지 않습니다. **0.4.0의 48시간 운영 관찰은 아직 미완료**입니다.

### 0.3.0 과거 배포 기록

당시 버전은 코인 성과 비교·관심 코인·지표 탐색·개인 작업공간을 추가하고 수집 중복, 시각 표시, HTTP 오류 처리를 보완했습니다. 2026-09-20 03:34:20 KST 타입검사·129개 테스트와 빌드를 통과했습니다. **공개 배포와 03:36:36 API 검사 이슈 0**을 확인했습니다. CPU 최대 12ms 표본으로 무료 10ms 예산과 장기 운영 확인은 남았습니다. 이 결과를 현재 0.4.0 검증으로 대신하지 않습니다.

0.3.0 배포 식별자는 Worker `aadce5f8-cb32-4745-a5dd-5ae33fb00dda`, Pages `c6e9c999`입니다. 배포 성공과 실제 사용자 흐름·자동 갱신·무료 한도 검증을 구분합니다.

0.3.0부터 확인하는 사용자 흐름도 유지합니다.

1. `/coins`에서 DOGE 검색·즐겨찾기·USDT/KRW 전환·정렬, `/compare`에서 기본 3개와 전체 8개 코인의 공통 분석 기간 확인.
2. `/explore`에서 지표 검색·분류·산식 확인 후 대시보드 담기·순서 변경.
3. 이름 붙인 작업공간 저장→새로고침→복원, 설정 JSON 내보내기→검증 후 가져오기. 가져오기 실패 시 기존 설정이 유지되는지 확인.
4. 가격 차트의 KST 직접 기간·보이는 구간 CSV·수평선 가격 입력·개별 선 삭제·키보드 조작과 지표 수정.
5. 기존 웹 주소의 경로·쿼리 보존 308 이동과 공개 Pages 주소의 자산·API 응답. 이전 주소의 `/api/*`는 기존 API 호환을 유지합니다.
6. 배포 버전별 Cron·조회 CPU, D1 실제 읽기·쓰기와 시세 원천 기준 시각을 기록. 신규 UI 검증을 기존 48시간 관찰 결과로 대신하지 않습니다.

전체 개선 이유는 [레드팀 보고서](REDTEAM.md), 비교 계산 기준은 [성과 비교 정의](COMPARISON.md)에 있습니다.

## 현재 구성

| 구성 | 실제 리소스·설정 |
|---|---|
| 프런트 | Cloudflare Pages `coin-desk`, `pages/wrangler.jsonc`, `dist/` |
| API 프록시 | `pages/functions/api/[[path]].ts`, 서비스 바인딩 `BACKEND → btc-desk` |
| 조회·수집 | Cloudflare Worker `btc-desk`, `wrangler.jsonc`, 매분 Cron 작업 하나 |
| DB | D1 `btc-desk`, 실제 ID는 `wrangler.jsonc`의 바인딩 확인 |
| 자산 | `BTC,DOGE,ETH,SOL,XRP,LINK,ONDO,PEPE` |
| 로컬 | Node.js 24+, Python 3.11+, 웹 5173/API 8787, `work/local.sqlite` |

Worker/DB의 내부 이름은 기존 리소스를 유지합니다. 사용자에게 안내하는 주소와 브라우저 API 요청은 `coin-desk.pages.dev`입니다. 다른 프로젝트의 도메인·DB·계정 공통 workers.dev 하위 도메인은 변경하지 않았습니다. 배포 중 자동 생성됐던 임시 `coin-desk` Worker는 제거했고, 실제 API는 기존 `btc-desk` 하나입니다.

0.3.0의 이전 주소 이동은 **기존 BTC Desk 호스트와 정확히 일치하는 웹 요청**에만 적용합니다. 경로·쿼리를 보존하며 `/api/*`는 이동하지 않습니다. 계정의 다른 Worker나 프리뷰 주소를 일괄 이동시키는 규칙은 아닙니다. 리다이렉트가 브라우저별 로컬 저장소를 옮겨 주지는 않습니다.

배포 인증은 Wrangler의 계정 인증을 사용합니다. 토큰, `.env`, `.dev.vars`, Wrangler 캐시, DB 백업은 Git과 ZIP에 포함하지 않습니다. 원천 API는 거래 계정이나 키가 필요하지 않습니다.

## 이미 설치된 환경의 실행·갱신

```sh
npm ci
npm run dev
```

로컬 데이터가 없다면 [README](../README.md)의 BTC·추가 자산 초기 수집 순서를 먼저 실행합니다. 이미 실행 중인 개발 서버를 중복 실행하지 않습니다. 종료는 해당 터미널에서 Ctrl+C입니다. 로컬은 동일 Worker 모듈을 Vite SSR과 Node SQLite D1 어댑터로 실행합니다. Cloudflare의 CPU·캐시·WebSocket 환경을 완전히 모사하지 않으므로 실제 배포 검사도 필요합니다.

0.3.0에서 갱신하며 장기 참조가격이 없다면 다음을 한 번 실행합니다. 자산별 원본·감사 기록·SQL은 `work/reference/`에 생성됩니다. `import_reference.mjs`는 **로컬 SQLite만** 적재하고, 자산별 트랜잭션 실패 시 해당 자산을 롤백합니다.

```sh
python scripts/bootstrap_reference.py
node scripts/import_reference.mjs
python scripts/verify_reference.py --base http://127.0.0.1:8787
```

검산에는 로컬 API 실행이 필요합니다. `bootstrap_reference.py --assets BTC,DOGE`처럼 일부 자산만 다시 수집할 수 있습니다. 이 초기 도구는 자산당 최대 10,000개 응답을 확인하며 추가 페이지가 생기면 조용히 잘라내지 않고 실패합니다. 기본 가져오기·검산은 BTC·DOGE·ETH 세 파일이 모두 있어야 합니다.

코드 배포:

```sh
npm run check
npm exec wrangler d1 migrations apply btc-desk -- --remote
npm run deploy
python scripts/check_live.py --base https://coin-desk.pages.dev
python scripts/verify_reference.py --base https://coin-desk.pages.dev
```

`deploy`는 빌드 → API Worker 배포 → Pages 배포 순서입니다. D1 마이그레이션이 추가되면 호환성을 검토하고 먼저 적용합니다. `git fetch origin`으로 최신 원격 상태를 확인하고 CI를 통과한 소스를 배포합니다. GitHub 병합만으로 Cloudflare가 자동 배포되는 구성은 아닙니다.

## 새 계정에 처음 배포

1. `npm exec wrangler login`, `npm exec wrangler whoami`로 대상 계정을 확인합니다.
2. `npm exec wrangler d1 create btc-desk`로 **새 DB**를 만들고 생성된 ID로 `wrangler.jsonc`의 DB ID를 바꿉니다. 저장소의 운영 DB ID를 다른 계정에 그대로 쓰지 않습니다.
3. `npm exec wrangler d1 migrations apply btc-desk -- --remote`를 실행합니다.
4. `npm run seed`, `python scripts/verify.py`, `npm run seed:assets`, `python scripts/bootstrap_reference.py`로 실제 원천과 장기 참조가격을 수집합니다. Coin Metrics 자료는 **CC BY-NC 4.0 비상업 이용** 범위이며 화면의 출처·라이선스 표시를 유지합니다.
5. 아래처럼 BTC와 자산별 SQL을 나눠 적재합니다. 이미 적재한 환경에서는 반복하지 않습니다.

```powershell
npm exec wrangler d1 execute btc-desk -- --remote --file work/seed.sql
foreach ($assetToImport in @('DOGE','ETH','SOL','XRP','LINK','ONDO','PEPE')) {
  npm exec wrangler d1 execute btc-desk -- --remote --file "work/assets/$assetToImport.sql"
  if ($LASTEXITCODE -ne 0) { throw "Import failed: $assetToImport" }
}
foreach ($referenceAsset in @('BTC','DOGE','ETH')) {
  npm exec wrangler d1 execute btc-desk -- --remote --file "work/reference/$referenceAsset.sql"
  if ($LASTEXITCODE -ne 0) { throw "Reference import failed: $referenceAsset" }
}
```

6. `pages/wrangler.jsonc`의 Pages 이름을 사용 가능한 이름으로 바꿉니다. 전 세계에서 같은 `pages.dev` 이름을 재사용할 수 없습니다. API Worker 이름을 바꾸면 `services[].service`도 같은 값으로 바꿉니다.
7. 사용 중인 Wrangler가 Pages 생성을 Workers로 위임하는 경우, 짧은 `pages.dev` 주소를 만들려면 다음 최초 생성 명령을 사용합니다. 여기의 `--force`는 기존 데이터를 삭제하는 옵션이 아니라 Pages 직접 생성을 선택합니다. **기존 프로젝트 배포에는 필요하지 않습니다.**

```sh
npm exec wrangler pages project create 선택한이름 -- --production-branch main --force
```

8. `package.json`의 `deploy:pages` 프로젝트 이름도 맞춘 뒤 `npm run check`, `npm run deploy`, 실제 주소로 `check_live.py`와 `verify_reference.py`를 실행합니다. 프런트, 서비스 바인딩, D1, 외부 원천 응답을 각각 확인합니다. 기존 계정의 업그레이드도 장기 참조가격 초기 적재가 없다면 위 세 자산 SQL 적재가 필요합니다.

## 수집과 무료 한도

- 매분 Cron은 방문자·개발 PC와 독립적으로 작업 하나를 선택합니다. 중복 실행은 분 단위 식별자와 120초 실행 잠금으로 막고, 중단된 실행은 다음 유효 시도에서 복구합니다. `cron_runs`는 최대 120개 슬롯으로 순환 보관하며 상태 API에는 최근 20개 실행을 보여줍니다.
- 16개 자산·시장 현재가는 최대 4자산씩 4개 배치로 묶습니다. 각 배치는 약 **8분 주기 목표**, 운영 지연 판단은 **10분**입니다. 기한을 크게 넘긴 시세 배치를 우선해 과거 이력 복구에 밀리지 않게 합니다. 호출 제한·백오프·중단 시 정확한 최대 지연을 보장하지 않습니다.
- 시간봉은 시간당 갱신, 일봉은 **6시간 주기**에 더해 저장된 날짜의 다음 UTC 경계가 되면 우선 갱신합니다. 모든 시장이 같은 초에 갱신되는 구성은 아닙니다.
- Bitview는 매시간 최신 일별 데이터와 원천 버전을 확인합니다. 버전 변경 시 새 세대에 32행씩 재계산하고 완료 후 활성 세대를 바꿉니다.
- CoinLore는 매시간 전체·개별 시가총액을 두 번 조회합니다. 호출 간격을 1초 이상 두며 공개 조회는 저장된 값을 공유합니다.
- DefiLlama는 6시간마다 마지막 일별 USD 총액을 확인합니다. 전체 응답에서 마지막 관측 객체만 파싱해 불필요한 과거 JSON 계산을 줄입니다.
- Coin Metrics 장기 USD 참조가격은 BTC·DOGE·ETH별 **6시간** 주기로 최근 수정 구간을 다시 조회합니다. 한 작업은 최대 32개 날짜이며, 복구할 과거 데이터가 남으면 체크포인트를 저장하고 다음 작업에서 이어갑니다. 유효 가격이 없는 페이지도 커서는 진행하지만 데이터 기준일은 실제 유효 가격의 마지막 날짜를 유지합니다.
- 원천 실패는 백오프와 마지막 정상 응답으로 처리합니다. 초기 수집 대기·실패·정상·지연을 구분합니다. API `/status`에서 `active:false`는 현재 사용하지 않는 과거 공급자 기록입니다.
- 시세 요약은 화면이 보일 때 60초마다 조회합니다. 방문자 요청의 원천 갱신은 D1의 **180초 공유 잠금**을 확보한 요청만 수행합니다. HTTP 캐시 30초와 함께 작동하므로 방문 중 **공유 시세 약 3분 주기**이며 정확한 180초 이내 보장은 아닙니다. 이는 방문자가 없을 때도 진행되는 8분 목표의 서버 수집과 별도입니다.
- 화면 시세의 실제 거래 시각이 5분을 넘으면 `liveStale` 또는 시세 지연 안내가 표시됩니다. 서버 운영의 10분 지연 기준과 화면의 5분 최신성 표시는 목적이 다른 기준입니다.
- 시세 스냅샷의 수집 시각과 거래소가 제공한 실제 거래 기준 시각을 분리합니다. 응답을 방금 받았더라도 거래 기준 시각이 오래되면 지연으로 표시합니다. 오류·재시도 대기에서는 마지막 정상 데이터를 유지합니다.
- 시세와 진행 중인 캔들은 갱신 주기가 달라 마지막 캔들 종가가 현재가와 잠시 다를 수 있습니다. 확정 봉의 지표 요약을 진행 중인 봉과 구분합니다.
- 추가 자산의 오래된 가격은 256봉 묶음, 최근 데이터는 개별 행입니다. 겹치는 시각은 개별 행을 우선합니다. 0.3.0부터 OHLCV·봉 마감 시각이 같으면 반복 UPSERT로 행을 다시 쓰지 않습니다. 원천의 8일보다 오래된 역사 수정은 해당 자산을 전체 재수집·재적재해 검산합니다.
- 시간봉은 90일 목표로 작은 묶음씩 정리합니다. 기존 온체인 비활성 세대도 단계적으로 삭제합니다. 도미넌스 조회는 최근 1,000회 관측을 반환하며 DB에는 축적한 이력을 보관합니다.
- 코인 비교는 이미 저장한 확정 일봉을 읽습니다. 첫 1,000개 관측 이후 최대 20개의 900일 구간으로 나누며, 전체 자산·페이지를 합쳐 HTTP 동시 요청은 최대 4개입니다. 브라우저 15분 캐시는 확보한 긴 기간을 짧은 기간 조회에 재사용합니다. 일부 요청이 실패하면 마지막 완성된 비교를 유지하며 서로 다른 갱신의 코인을 섞어 새 결과로 표시하지 않습니다. 화면이 보일 때 15분마다 확인하고 수동 재조회는 30초 간격으로 제한합니다.
- 일반 차트도 과거 페이지를 제한된 구간으로 나누어 최대 4개씩 조회합니다. 같은 화면의 중복 요청은 공유하고 화면을 숨기면 자동 조회를 멈추며, 복귀 시 갱신 여부를 확인합니다. 서버 자동 수집은 이 브라우저 동작의 영향을 받지 않습니다.

[D1 공식 제한](https://developers.cloudflare.com/d1/platform/limits/)과 [사용량](https://developers.cloudflare.com/d1/platform/pricing/)의 무료 기준은 DB당 500MB, 계정 일별 읽기 500만·쓰기 10만 행입니다. 최초 BTC 적재는 34,810행 쓰기, 7개 추가 자산은 15,532행 쓰기, 추가 적재 직후 전체 DB 약 8.96MB였습니다. 이 수치는 해당 적재 작업 측정값이며 계정 전체 당일 사용량은 아닙니다. 결제나 유료 플랜 전환은 하지 않았습니다.

과거 0.3.0의 일별 쓰기 **약 6.6만 행은 당시 조건에 따른 추산**이며 현재 0.4.0 실측값이 아닙니다. 0.4.0은 장기 가격 14,589개 관측과 실행 기록을 추가했고 작업 주기도 바뀌었습니다. 초기 적재·수정·세대 재계산·다른 프로젝트의 계정 사용량을 합친 실제 D1 읽기·쓰기로 무료 한도를 확인합니다.

CPU는 [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)과 별개로 측정합니다. 관측 중 한도가 가까워지면 캐시·작업 크기를 조정합니다. 무료 한도 밖에서 자동으로 과금하도록 변경하지 않습니다.

```sh
npm exec wrangler d1 insights btc-desk -- --time-period 1h --json
npm exec wrangler tail btc-desk -- --format json | python scripts/tail_metrics.py
```

Tail 도구는 경로·CPU·응답상태만 보관하며 방문자 IP·헤더는 저장하지 않습니다. 종료는 Ctrl+C입니다. 급한 단일 원천 재시도는 DB의 해당 ingestion 키 `next_attempt`를 현재 UTC epoch로 설정하면 다음 Cron이 백오프 이후 다시 시도합니다. 전체 테이블을 초기화하거나 마지막 성공 시각을 임의로 새 시각으로 바꾸지 않습니다.

## 48시간 관찰과 버전 구분

**현재 0.4.0의 48시간 관찰은 미완료**입니다. 최종 배포 뒤 첫 정상 검사를 기준으로 새 관찰 구간을 기록하고, 중간 실패·공백과 실제 데이터 갱신을 확인해야 합니다. 최신 기준 시각과 판정은 [0.4 개선·검증 보고서](UPGRADE04.md)를 따릅니다. 아래는 0.2.0·0.3.0 당시의 관찰 설정 기록이며 0.4.0 완료 근거가 아닙니다.

확장 버전의 첫 정상 검사: **2026-09-20 02:17:07 KST**. 48시간 경과: **2026-09-22 02:17:07 KST**. 기존 자동화 ID `btc-desk-48`를 **Coin Desk 공개 운영 48시간 확인**으로 갱신했습니다. 같은 상태는 알리지 않고 새로운 장애·회복·완료·조치 필요 때 알립니다. 관찰 자동화는 PC와 Codex 실행·인터넷이 필요하고, 서버 수집 Cron은 PC와 독립적입니다.

위 시작 시각은 **0.2.0 관찰 기준**입니다. 0.3.0 최종 배포 기준은 **2026-09-20 03:36:36 KST**, 48시간 경과는 **2026-09-22 03:36:36 KST**입니다. 같은 자동화를 새 버전 기준으로 갱신했습니다. 0.2.0 이후 48시간을 0.3.0 관찰로 합치지 않습니다.

```sh
python scripts/check_live.py --base https://coin-desk.pages.dev
```

실행 로그는 `work/observation.jsonl`에 추가됩니다. 별도 연속 실행이 필요하면 `--hours 48 --interval 300`을 사용할 수 있지만 기존 자동화와 중복 실행하지 않습니다. 처음·마지막 관측 간 48시간, 중간 공백, 지표 기준일과 수집 시각의 실제 진행을 확인한 뒤 [검증 기록](VERIFICATION.md)을 갱신합니다. 단순히 자동화를 등록했다고 관찰 완료로 표시하지 않습니다. 최초 BTC 전용 관찰과 확장 버전의 관찰을 구분합니다.

## 백업·복구·되돌리기

### 브라우저의 개인 설정

**작업공간 저장·불러오기 → 설정 백업·이동 → 저장한 설정 내보내기**로 `coin-desk-settings.json`을 내려받습니다. 즐겨찾기, 온체인 카드와 이름 붙인 작업공간(최대 12개)을 보관합니다. 작업공간에는 자산·시장·봉·기간 프리셋·지표·로그축·카드 구성이 포함됩니다.

다른 브라우저에서 JSON을 붙여넣고 **검증 후 설정 가져오기**를 누릅니다. 크기 제한은 **UTF-8 64KB(64,000바이트)**이며 형식·버전·지원 자산·지표·중복을 검사합니다. 가져온 즐겨찾기·카드는 현재 설정을 대체하고, 작업공간은 기존 목록과 합칩니다. 같은 이름은 기존 작업공간을 유지하며 합계가 12개를 넘으면 적용하지 않습니다. 잘못된 파일은 기존 설정을 바꾸지 않습니다.

그린 선, 직접 선택한 날짜 범위, 비교 화면 설정은 이 JSON에 포함되지 않습니다. 그린 선은 각 브라우저의 자산·시장·봉 간격별 저장소에 있습니다. 브라우저 데이터를 지우거나 주소를 바꾸기 전에 필요한 설정을 내보냅니다. 개인 설정 백업과 아래 시장 데이터 DB 백업은 별개입니다.

### 시장 데이터와 배포

```sh
python scripts/backup_check.py
npm exec wrangler d1 export btc-desk -- --remote --output work/remote-backup.sql
npm exec wrangler deployments list
npm exec wrangler pages deployment list -- --project-name coin-desk
```

로컬 검증은 실행 DB를 별도 백업 파일에 복사한 뒤 다시 다른 파일로 복구해 **11개 테이블**의 해시·무결성을 비교합니다. 0.4.0의 `cron_state`, `cron_runs`, `reference_prices`도 포함합니다. 운영 D1 내보내기는 일시적으로 DB를 잠글 수 있으므로 실행 시각을 정합니다. 내보내기 명령이 출력하는 임시 다운로드 서명 URL을 공유하거나 커밋하지 않습니다.

Worker 코드를 되돌릴 때 `npm exec wrangler rollback -- 검증된버전ID`를 사용합니다. Worker 롤백은 DB나 Pages를 되돌리지 않습니다. Pages는 Cloudflare 대시보드의 `coin-desk → Deployments`에서 이전에 검증된 운영 배포를 선택해 되돌립니다. 두 배포의 API 계약을 맞추거나 이전 커밋으로 작업 위치를 바꿔 `npm run deploy`로 함께 재배포합니다. 이후 공개 상태·DOGE 가격·BTC 지표·도미넌스를 다시 확인합니다.

데이터 복구는 먼저 새 복구용 D1에 백업을 가져와 검증하고 바인딩을 교체합니다. 운영 DB를 즉시 덮어쓰지 않습니다. 검증 중 원격 내보내기→별도 로컬 SQLite 복원과 Worker 롤백을 수행했지만, 운영 DB를 새 D1으로 바인딩 전환하는 장애 훈련은 하지 않았습니다. 0.1.0 롤백 증거는 [최초 배포 기록](BTC_BASELINE.md)에 있습니다.

배포 전 `.env*`, `.dev.vars`, `.wrangler/`, `work/`, `node_modules/`가 Git에 포함되지 않았는지 확인합니다. ZIP은 `python scripts/package_release.py`로 생성하며 운영 DB가 아니라 재수집 가능한 앱 소스입니다.

### 가격 수집의 원자성과 부분 결측

가격 수집은 원본 표본·봉·이력 메타데이터·성공 기록을 한 D1 batch에서 순차 저장합니다. 실패 시 모두 롤백되며 다음 시도에서 복구합니다. 수집 함수의 D1 왕복은 7회에서 3회로 줄었지만 무료 CPU 한도 충족 여부는 별도 실측합니다. [D1 batch 정의](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Upbit 현재가는 정상이어도 24시간 전 비교 분봉에 거래 공백이 있으면 등락률만 계산할 수 없습니다. 이 경우 API의 `change24h:null`과 한국어 사유를 그대로 표시하며 `check_live.py`는 `warnings`에 기록합니다. 현재가 자체 지연·잘못된 원천은 계속 `issues`로 판정합니다. 24시간 변동을 UTC 전일 대비로 대체하지 않습니다.
