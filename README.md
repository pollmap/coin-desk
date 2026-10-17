# 보리차트

**코인을 고르고, 가격과 사이클을 차트로 이어 읽는 한국어 분석 서비스입니다.** 시장에서 150개 코인을 찾고, 코인별 대시보드에서 실제 지원되는 분석을 확인한 뒤 필요한 차트만 크게 열어 비교하고 저장합니다.

[운영 사이트](https://coin-desk.pages.dev/) · [VPS 주소](https://coin-desk.62.171.141.206.sslip.io/) · **[현재 제품 기준](docs/PRODUCT.md)** · [0.36 변경 명세](docs/RELEASE36.md) · [검증·배포 상태](docs/audit-36/README.md)

## 사용 흐름

1. 시장의 검색·관심목록·테마에서 코인을 고릅니다.
2. 가격·슈퍼트렌드·가치평가·보유자·네트워크 차트를 이어 읽습니다. 지원하지 않는 지표는 빈 카드로 나열하지 않습니다.
3. 필요한 차트를 확대해 날짜·기간·추세를 확인합니다. 지표가 명시된 기존 링크는 집중 차트로 바로 열립니다.
4. BTC 대비 성과와 같은 지표 비교를 구분해 봅니다. BTC의 기본 비교 상대는 ETH입니다.
5. 분석의 구성·기간·확대·읽던 위치를 저장하고 다시 엽니다.

장기 가격은 검증된 USD 종가를 우선합니다. 슈퍼트렌드는 실제 거래소 OHLC를 사용하며 KRW·USDT를 USD로 바꾸어 표기하지 않습니다. MVRV에서 유도한 실현가격·NUPL은 서로 독립적인 근거가 아닙니다. 무료로 검증할 수 없는 지표는 다른 값으로 대체하지 않습니다.

개인 자료·이미지·메모는 기기에 보존하며 공개 API·저장소·공유 데이터에 넣지 않습니다. 기존 URL·작업공간 버전 1·2·저장 키를 유지합니다. [개인 자료 확장 안내](extension/README.md).

## 개발과 검사

Node.js 24 이상과 Python 3.11 이상을 사용합니다. 의존성을 설치한 뒤 기존 로컬 DB가 있으면 `npm run dev`로 시작합니다. 새 데이터 준비와 실시간 수집은 [실행·배포 안내](DEPLOYMENT.md#로컬에서-수집까지-연결하기)를 따릅니다. 원본 DB를 개발 실험 대상으로 덮어쓰지 않습니다.

```sh
npm ci
npm run dev
```

| 명령 | 역할 |
|---|---|
| `npm run check` | 타입·계산·API·URL·저장 회귀 |
| `npm run test:server` | Node API·수집·배포 보호 검사 |
| `npm run test:recovery` | 백업·독립 복원 검사 |
| `npm run test:e2e -- --project=chromium` | Chromium 사용 흐름·반응형·터치 검사 |
| `npm run test:e2e -- --project=webkit` | WebKit 회귀; 실제 Safari·VoiceOver와 구분 |
| `npm run build` | 웹 빌드 |
| `npm run build:storybook` | 개발용 컴포넌트 상태 검수 |
| `python scripts/check_docs.py` | 문서 링크·필수 기록 검사 |
| `npm run deploy:vps -- --help` | 검증된 CI 묶음의 선택 배포 절차 |

## 구조와 운영 원칙

React·Base UI·Lightweight Charts → Pages 또는 Nginx HTTPS → Node 읽기 API·중앙 시세 스트림 → SQLite·압축 이력입니다. 독립 최신 수집과 체크포인트 과거 복구를 분리합니다. 공개 검색은 별칭·FTS5를 사용하며 개인 자료를 색인하지 않습니다.

| 경로 | 책임 |
|---|---|
| `src/` | 시장·대시보드·집중 차트·저장·기기 내 개인 자료 |
| `shared/` | 자산·지표 정의·계산·공유 타입·입력 검증 |
| `worker/` | 재사용하는 읽기 API·원천 연결·수집 정책 |
| `server/` | VPS Node 실행부·중앙 시세·SQLite 어댑터 |
| `deploy/vps/` | 서비스 격리·백업·검증된 선택 배포 |
| `tests/`, `e2e/` | 계산·복원·서버·브라우저 회귀 |
| `docs/PRODUCT.md` | 현재 제품 기준. 과거 RELEASE 문서는 당시 이력 |

운영 배포는 원격 main CI의 동일 이미지를 사용합니다. 새 백업·별도 복원·실데이터 검사를 통과한 서비스만 교체하고 다른 수집기와 DB를 보존합니다. 8GiB 공간 보호와 실제 체결 300초 기준을 유지합니다. Cloudflare의 과거 중복 수집기는 다시 시작하지 않습니다.

CI 통과·배포·데이터 복구·성능은 따로 보고합니다. **48시간 대기는 완료 조건이 아닙니다.** 실물 기기와 사람의 사용성 검사는 자동 검사로 대체하지 않습니다. [배포·복구](DEPLOYMENT.md) · [데이터 정의](docs/DATA.md) · [0.35 선행 운영 기록](docs/audit-35/README.md) · [이전 0.34](docs/audit-34/README.md).

## 출처와 귀속

- [Binance 공개 시장 데이터](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints), [Upbit](https://docs.upbit.com/kr)
- [Bitview](https://bitview.space/api), [Bitcoin Research Kit](https://github.com/bitcoinresearchkit/mono), [가격 모듈](https://github.com/bitcoinresearchkit/mono/blob/main/crates/brk_oracle/README.md)
- [Coin Metrics Community 데이터](https://github.com/coinmetrics/data/blob/master/README.md), [PriceUSD 정의](https://docs.coinmetrics.io/network-data/network-data-overview/market/price), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). 장기 USD 참조가격에 출처·라이선스·비상업 이용을 표시합니다. 상업적 재사용 권한을 제공하는 데이터로 취급하지 않습니다.
- [CoinLore 무료 API](https://www.coinlore.com/cryptocurrency-data-api), [DefiLlama Stablecoins](https://defillama.com/stablecoins)
- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts), Apache-2.0. 화면의 귀속 로고와 저작권 표시를 유지합니다.

보리차트는 독립적으로 만든 개인 분석 도구이며 CoinDesk 뉴스, CoinGlass, TradingView 또는 데이터 제공자의 공식 서비스가 아닙니다. 타사 화면 이미지를 제품 자산으로 재배포하지 않습니다. 저장소 자체 소스에는 별도의 배포 라이선스를 아직 지정하지 않았습니다.
