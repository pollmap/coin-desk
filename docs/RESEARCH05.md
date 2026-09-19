# 무료 멀티코인 온체인 데이터: 실측과 구현

조사·로컬 검증: 2026-09-20 KST. 원천 최신 일별 관측: 2026-09-18 UTC. 원격 D1 초기 적재 완료, 공개 배포 및 원격 전량 대조는 릴리스 작업에서 진행 중입니다.

BTC·DOGE·ETH·XRP·LINK의 무료 일별 온체인 이력을 전체 수집하고, 56개 자산·지표 조합의 **260,284개 관측값**을 로컬 조회 API에서 원본과 대조했습니다. DOGE는 2013-12-08, ETH는 2015-07-30부터 주소·거래·공급 이력이 있습니다. 가격과 MVRV는 해당 가격 원천이 시작한 날짜부터만 제공합니다.

SOL·ONDO·PEPE는 이번에 확인한 무료 Community 범위에서 같은 온체인 지표가 제공되지 않았습니다. 이 자산들의 거래소 가격 차트는 유지하며, 공급량이나 다른 코인의 값으로 온체인 이력을 만들지 않습니다. 아래 결과는 무료 구독 없이 실제 HTTP 응답으로 확인한 범위입니다.

## 1. 조회 방법과 출처

공식 [Community 안내](https://docs.coinmetrics.io/packages/coin-metrics-community-data)는 API 키 없는 접근과 IP당 6초 구간 10회 제한을 설명합니다. Community는 유료 Network Data 전체의 일부입니다. Pro 문서에 항목이 있다고 무료 접근을 가정하지 않고, Community 카탈로그의 `community:true`와 실제 시계열 응답을 함께 확인했습니다.

- 카탈로그: [8개 대상 자산의 Community 가용 항목](https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?assets=btc,doge,eth,sol,xrp,link,ondo,pepe&page_size=10000)
- 실제 일별 원본: `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics`
- 예시: [DOGE MVRV 전체 원천](https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=doge&metrics=CapMVRVCur&frequency=1d&start_time=2013-12-08&page_size=10000&paging_from=start)
- 가격 모듈·거래소 OHLCV와 별개인 온체인 모듈입니다. 비교선은 같은 응답의 `PriceUSD`만 사용합니다.

초기 CLI는 자산별로 최대 10,000일을 요청하고 응답의 다음 페이지가 남으면 적재 파일을 만들지 않고 오류로 종료합니다. 현재 각 자산 3,290~6,468일은 한 응답으로 모두 수집됐습니다. 정기 수집은 최대 60일씩 요청합니다. 원천의 날짜는 UTC 일별 라벨이며, 체인별 원장 집계에는 공급자의 블록 시각 규칙을 따릅니다.

## 2. 자산별 실제 범위

아래 모든 확보 항목의 마지막 유효 날짜는 **2026-09-18**이며, 각 항목의 첫 유효 값 이후 내부 결측일은 0일입니다. 표본이나 모의 이력이 아닙니다.

| 자산 | 주소·거래·전송·공급 시작 | 해당 일별 행 | PriceUSD·MVRV·원장 시총 시작 | 해당 일별 행 | 수수료 | 해시레이트 |
|---|---|---:|---|---:|---|---|
| BTC | 2009-01-03 | 6,468 | 2010-07-18 | 5,907 | 2009-01-03부터 | 2009-01-09부터 6,462일 |
| DOGE | 2013-12-08 | 4,668 | 2014-01-23 | 4,622 | 2013-12-08부터 | 2013-12-08부터 4,668일 |
| ETH | 2015-07-30 | 4,069 | 2015-08-08 | 4,060 | 2015-07-30부터 | 이번 항목에서 제외 |
| XRP | 2013-01-01 | 5,009 | 2014-08-15 | 4,418 | 2013-01-01부터 | 해당 없음 |
| LINK | 2017-09-16 | 3,290 | 2017-09-29 | 3,277 | 무료 항목 없음 | 해당 없음 |
| SOL | 같은 무료 온체인 항목 없음 | — | 무료 `PriceUSD` 접근 불가 | — | 미확보 | 해당 없음 |
| ONDO | 같은 무료 온체인 항목 없음 | — | 무료 전체 `PriceUSD` 미확보 | — | 미확보 | 해당 없음 |
| PEPE | 같은 무료 온체인 항목 없음 | — | 무료 전체 `PriceUSD` 미확보 | — | 미확보 | 해당 없음 |

XRP의 원장 이력 시작과 USD 가격 시작이 특히 다릅니다. 2013년의 거래 수를 볼 수 있다고 그 날짜의 MVRV·USD 가격도 있다고 표시하지 않습니다. ETH 채굴 지표는 병합 이후 종료됐으므로 현재 ETH 네트워크의 해시레이트로 제공하지 않습니다. [해시레이트 공식 정의](https://docs.coinmetrics.io/network-data/network-data-overview/mining/hash-rate)

SOL·ONDO·PEPE의 무료 `CapMrktEstUSD`는 각각 2020-04-11, 2024-01-20, 2023-08-17부터 응답했습니다. 이는 프로젝트 등에서 보고한 유통량을 이용하는 시장 데이터이며, 요청한 온체인 거래·주소·MVRV 전체 이력을 대신하지 않습니다. `ReferenceRate*`의 최근 제한 이력 역시 전체 가격 이력이 아닙니다. [시장가치 정의](https://docs.coinmetrics.io/network-data/network-data-overview/market/market-capitalization), [Community 이력 제한](https://docs.coinmetrics.io/packages/coin-metrics-community-data)

직접 요청한 SOL `PriceUSD`, DOGE `CapRealUSD`, DOGE `SOPR`은 Community 자격으로 HTTP 403이었습니다. 이 결과는 다른 모든 공급자에게도 데이터가 없다는 뜻이 아닙니다. 이번 무료 원천에서 확보하지 못했다는 뜻이며, 유료 API로 자동 전환하거나 접근 제한을 우회하지 않았습니다.

## 3. 항목과 의미

| 앱 ID | 원천 ID / 산식 | 단위 | 지원 |
|---|---|---|---|
| `mvrv` | `CapMVRVCur` | 배 | 5개 |
| `active_addresses` | `AdrActCnt` | 주소/일 | 5개 |
| `balance_addresses` | `AdrBalCnt` | 주소 | 5개 |
| `transactions` | `TxCnt` | 건/일 | 5개 |
| `transfers` | `TxTfrCnt` | 건/일 | 5개 |
| `supply` | `SplyCur` | 해당 자산 | 5개 |
| `market_cap` | `CapMrktCurUSD` | USD | 5개 |
| `fees_native` | `FeeTotNtv` | 해당 자산/일 | BTC·DOGE·ETH·XRP |
| `hashrate` | `HashRate` | TH/s | BTC·DOGE |
| `realized_cap` | `CapMrktCurUSD / CapMVRVCur` | USD | 5개 · 역산 |
| `realized_price` | `PriceUSD / CapMVRVCur` | USD | 5개 · 역산 |
| `nupl` | `1 − 1 / CapMVRVCur` | 비율 | 5개 · 역산 |

- 활성 주소·잔고 주소는 사람 수가 아닙니다. ETH의 주소 수에는 해당 자산의 원장 규칙이 적용되며, 모든 토큰 보유자 수로 해석하지 않습니다. [활성 주소](https://docs.coinmetrics.io/network-data/network-data-overview/addresses/active-addresses), [잔고 항목](https://coverage.coinmetrics.io/asset-metrics/AdrBalCnt)
- 거래는 거래소 체결이 아닌 원장 거래입니다. 한 거래에 여러 전송이 포함될 수 있고, ETH의 `TxTfrCnt`는 모든 ERC-20 전송의 합계가 아닙니다. LINK는 LINK 토큰 관련 활동입니다. [거래](https://docs.coinmetrics.io/network-data/network-data-overview/transactions/transactions), [전송](https://docs.coinmetrics.io/network-data/network-data-overview/transactions/transfers)
- `SplyCur`는 현재 원장 공급량이며 거래 가능한 유통량과 다릅니다. XRP 에스크로와 LINK 총발행 공급이 시총 차이를 크게 만들 수 있습니다. [현재 공급](https://docs.coinmetrics.io/network-data/network-data-overview/supply/current-supply)
- `FeeTotNtv`에는 프로토콜이 소각한 수수료도 포함됩니다. ETH의 실행·블롭 수수료를 포함하며 평균 거래 단가로 표시하지 않습니다. [총 수수료](https://docs.coinmetrics.io/network-data/network-data-overview/fees-and-revenue/fees)
- BTC와 DOGE 해시레이트는 둘 다 TH/s이지만 해시 알고리즘이 달라 수치만으로 보안 수준을 직접 비교하지 않습니다. [해시레이트](https://docs.coinmetrics.io/network-data/network-data-overview/mining/hash-rate)

`CapMrktCurUSD = SplyCur × PriceUSD`, `CapMVRVCur = CapMrktCurUSD / CapRealUSD`가 원천 정의입니다. `CapMrktEstUSD`를 이 산식에 섞지 않습니다. 세 역산 항목은 MVRV가 양수인 같은 날의 자료로만 계산하며, NUPL 0.25는 25%입니다. **CapRealUSD 원본 직접 수집 또는 자체 노드 독립 검산으로 표현하지 않습니다.** BTC의 기존 Bitview 지표와도 이어 붙이지 않습니다. [원천 산식](https://docs.coinmetrics.io/network-data/network-data-overview/market/market-capitalization)

MVRV-Z·SOPR 원본, 보유자 연령별 지표, 거래소 유입·유출, 고래 분류는 이번 무료 멀티코인 추가 범위에 포함하지 않았습니다. 거래·주소 이력만으로 이 값을 만들어 내지 않습니다. 기존 BTC Bitview 지표 화면의 제공 범위는 별도로 유지됩니다.

## 4. 저장·갱신·복구 설계

`network_months`에는 `(asset, UTC 월 시작, JSON 일별 관측, 수집 시각)`을 저장합니다. `network_coverage`는 자산·지표별 최초/최종 관측일·개수만 유지합니다. 조회 API는 필요한 지표만 펼쳐 반환하므로 브라우저가 12개 전체 원천 열을 매번 다운로드하지 않습니다.

- 확보한 23,504일을 월별 **776개 행**, 원천 가격을 포함한 메타데이터 61개 행에 보관합니다. JSON 페이로드 합계는 **8,458,222바이트**입니다. DB 파일·인덱스 크기는 이 수치와 다릅니다.
- 신규 DB의 초기 논리 행 쓰기는 월별·coverage·수집 상태·체크포인트를 합쳐 최대 **847행으로 추산**했습니다. 이후 원격 D1 적재가 보고한 실제 네트워크 쓰기는 **1,684행**이었습니다. 인덱스 등의 쓰기가 포함되는 D1 계측과 논리 레코드 수를 동일하게 계산하지 않습니다. 적재 후 전체 원격 DB는 약 19.3MB이며 기존 가격·온체인 테이블도 포함합니다.
- 정기 갱신은 6시간 주기이며 최근 32일을 다시 확인합니다. 초기 따라잡기는 최대 60일씩, 진행 커서를 저장하고 60초 뒤 다음 작업이 가능합니다.
- 0은 유효 관측입니다. `null`은 없는 값이며 보간·0 대체를 하지 않습니다. 이미 저장한 유효 값이 원천에서 사라지면 자동으로 오래된 값과 합성하지 않고 작업을 실패 처리해 재적재 검토를 요구합니다.
- 수집 응답 전체를 검증한 뒤 월별 자료·메타데이터·커서·성공 기록을 한 DB 배치로 반영합니다. HTTP 실패·빈 응답·잘못된 숫자·중복 날짜·범위 불일치 시 기존 자료를 유지합니다.
- 월별 내용이 같으면 UPSERT의 실제 변경을 생략합니다. 지표별 마지막 실제 날짜를 API에 표시하고, 마지막 관측이 3일보다 오래됐거나 마지막 수집이 7시간보다 오래되면 지연으로 표시합니다.
- `GET /api/v1/network?asset=DOGE&metric=mvrv&from=0&limit=1000`은 최대 1,000개 관측을 반환합니다. `nextCursor`는 다음 요청의 `from`이며, `to`는 제외 경계입니다. 긴·성긴 구간도 커서가 앞으로 진행합니다. 한 번에 최대 40개월을 읽습니다.
- `GET /api/v1/network-catalog?asset=DOGE`는 해당 자산의 지원 항목만 반환합니다. 미지원 코인의 빈 상태는 자료가 없다는 의미이며 값 0이 아닙니다.

## 5. 재현 명령과 검증

프로젝트 루트에서 실행합니다. 아래 명령은 로컬 파일과 로컬 SQLite만 변경합니다. 초기 CLI는 인증키를 요구하지 않습니다.

```powershell
python scripts/bootstrap_network.py
node scripts/import_network.mjs
npm run dev
```

다른 터미널에서 전체 원천 대조를 실행합니다.

```powershell
python scripts/verify_network.py
npx vitest run tests/network-data.test.ts tests/network-api.test.mjs
```

필터와 재사용 예시입니다. `--reuse`는 원천 URL·설정·SHA256이 저장된 감사 파일과 일치하는 원본만 재사용합니다.

```powershell
python scripts/bootstrap_network.py --assets DOGE,ETH --reuse
node scripts/import_network.mjs DOGE,ETH
python scripts/verify_network.py --assets DOGE,ETH --metrics mvrv,active_addresses,transactions
```

초기 수집 결과는 `work/network/{ASSET}.raw.json`, `.audit.json`, `.sql`에 저장됩니다. 검증 결과는 `work/network-verification.json`입니다. 실제 데이터는 Git에서 제외된 `work/`에 있으며 소스·스크립트는 저장소에 남습니다. 원격 D1 적용 전에는 **migration 0006**이 필요합니다. 로컬 개발 어댑터는 모든 마이그레이션을 순서대로 적용합니다.

검증기는 원본 해시를 확인하고 원천별 날짜 집합·값·USD 비교선을 모두 대조합니다. 세 역산 항목은 앱의 계산기를 호출하지 않고 Python `Decimal` 40자리 연산으로 독립 계산합니다. 로컬 검증에서 56개 지표 조합 260,284개 관측이 모두 일치했습니다. 단, 역산이 잘 수행됐다는 뜻이지 무료로 직접 받지 못한 `CapRealUSD`와 독립적으로 일치함을 확인했다는 뜻은 아닙니다.

원천 가격×공급과 원장 시총의 일치도는 5개 코인 전체에서 상대오차 약 `3.34e−16` 이하였습니다. 월 경계·60일 페이지·0과 결측·같은 날짜 수정·중간 실패·HTTP 429·지연 표시·가격 시간축·손상된 저장 자료를 대상으로 새 단위 시험 11개가 통과했습니다. 별도 API 통합 시험은 페이지 연결과 공개 조회 중 DB 쓰기 0을 확인합니다.

원격 배포, 공개 화면, 실제 Worker CPU, 48시간 무중단 갱신은 이 문서의 로컬 전량 검증과 별개입니다. 이 문서 작성 시점의 배포 상태는 최상위 릴리스 보고서를 확인합니다. 무료 CPU 장기 충족을 로컬 실행 시간만으로 단정하지 않습니다.

## 6. 이용 범위

Coin Metrics는 Community API를 무료 Creative Commons 자료로 안내하며, 공식 [Community 데이터 저장소](https://github.com/coinmetrics/data/blob/master/README.md)는 **CC BY-NC 4.0**을 명시합니다. 출처·라이선스 링크·역산 또는 변환 사실을 유지하고 비상업적 이용 범위로 사용합니다. 공개 방문이 가능하다는 사실이 유료 데이터 판매·광고 기반 상용 운영까지 허용한다는 뜻은 아닙니다. [라이선스 조건](https://creativecommons.org/licenses/by-nc/4.0/)

원천 업체는 자산·지표 제공 범위를 변경할 수 있습니다. 지금 확보된 관측과 라이선스에 근거해 운영하며, 무료 API 가용성이 영구 보장된다고 표시하지 않습니다. 이번 구현에 유료 구독·자체 전체 노드·상용 데이터 계약은 포함되지 않았습니다.
