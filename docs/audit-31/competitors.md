# 공개 문서로 확인한 13개 서비스의 가격·지표·비교 구조

확인일: 2026-10-13 KST. GitHub 공개 API의 실제 조회 시각은 `public-commits.json`에 UTC로 기록했습니다.

이 조사는 공식 문서·공개 페이지의 텍스트와 공개 저장소를 읽은 결과입니다. REA 실행 결과나 실제 브라우저 조작 결과가 아닙니다. 13개 서비스의 모든 기능, 유료 로그인 내부, 기기별 레이아웃을 전수 검증하지 않았습니다. 공개되지 않은 DB 엔진·캐시 정책·상용 시스템 내부 배포는 **미확인**입니다. 다른 담당자의 REA/브라우저 증거와 결합할 때도 이 구분을 유지해야 합니다.

## 이번 변경에 적용할 결론

**가격 차트를 코인 상세에서 바로 열 수 있어야 합니다.** 현재가 숫자와 지표 차트만으로는 가격 자체의 기간별 움직임을 확인하는 기본 흐름이 끊깁니다. CoinGecko·CoinMarketCap의 공개 상세에는 가격 차트가 있고, Santiment 공식 사용 안내도 BTC 가격에서 시작합니다. 가격과 지표를 둘 다 화면에 반복해서 쌓을 필요는 없습니다. 하나의 주 차트에서 `가격 / 지표`를 전환하고, 명시한 지표 링크는 계속 해당 지표로 열도록 권합니다.

| 순서 | 작은 적용 변경 | 이유와 완료 조건 |
|---|---|---|
| 1 | 명시적 지표가 없는 코인 상세에 가격을 기본으로 제공 | 시장 행 한 번 → 가격 차트. `metric`, 원천, 통화, 기간, 날짜가 있는 링크는 보존 |
| 2 | 차트 가까이에 `가격 / 지표` 전환과 기존 지표 바로가기 | 지표 탐색 능력은 보존하되 가격을 찾기 위해 새 메뉴를 돌아다니지 않음 |
| 3 | 실제 거래소 OHLC의 캔들·종가선 선택 | 일별 참조 종가만 있는 원천에서는 종가선만. 가짜 OHLC 금지 |
| 4 | 가격·지표·성과 비교를 기존 `/compare`에 연결 | 가격은 % 변화/시작값100/비율 구분. 다른 단위와 주기는 같은 축으로 합치지 않음 |
| 5 | 재생성 없이 업데이트, 확대·고정 날짜·저장 복원 보존 | 가격 최신 틱과 확정 봉·온체인 관측은 다른 데이터 상태로 취급 |
| 6 | 출처와 계산은 작은 정보 패널, 실패·지연은 값 가까이 | 정상 설명으로 차트 위 공간을 채우지 않으며 오류는 숨기지 않음 |

## 서비스별 공식 근거와 적용 범위

| 서비스 | 공개적으로 확인한 흐름·기능 | 데이터·처리 증거 | 보리차트에 가져올 점 / 미확인 |
|---|---|---|---|
| CoinGecko | BTC 상세에 가격·시총 선택, 기간, 로그·전체화면·내보내기, 코인/측정값 비교. 비교는 선 차트에 한정한다는 안내 | ID 기반 가격 시계열과 별도 OHLC API. 가격 배열 `[timestamp,price]`와 OHLC 배열은 서로 다름. OHLC 시각은 봉 종료 시각, 구간에 따라 자동 해상도가 변함 | 기본 가격 차트와 짧은 도구 배치. 집계 가격을 특정 거래소 가격처럼 표시하지 않음. 내부 DB·캐시 미확인. [상세](https://www.coingecko.com/en/coins/bitcoin), [종가 시계열](https://docs.coingecko.com/reference/coins-id-market-chart), [OHLC](https://docs.coingecko.com/reference/coins-id-ohlc) |
| CoinMarketCap | BTC 가격 아래 USD 가격 차트, 통계와 시장 거래쌍 목록. 현물·무기한·선물 필터와 시세/공급 항목을 구분 | 공식 API는 시세·거래소·OHLCV·DEX 등을 별도 계열로 제공하며 대다수 플랜의 갱신을 1분으로 안내. 이는 해당 API 설명이며 화면 지연을 측정한 결과가 아님 | 코인 상세 가격 → 필요한 통계로 내려가는 위계. 시총/FDV/유통량 혼동 방지. 비공개 DB와 실제 화면 갱신주기 미확인. [상세](https://coinmarketcap.com/currencies/bitcoin/), [공식 API](https://coinmarketcap.com/api/documentation/) |
| CoinGlass | 선물 가격과 관련 지표를 비교하는 참고 대상. 공식 가격 이력 입력에 거래소·거래쌍·주기가 따로 있음 | `/api/futures/price/history`는 실제 OHLC와 USD 거래량, ms 시각을 반환. API 플랜별 최소 주기가 다르며 최대 1000행으로 안내 | 현물·선물 가격을 구분하고 펀딩 관측 주기와 통화를 유지. 유료 데이터 추가 없이 기존 거래소 원천 재사용. 전체 UI와 내부 DB 미확인. [가격 OHLC 문서](https://docs.coinglass.com/reference/price-ohlc-history) |
| CryptoQuant | 같은 지표에서 자산을 바꾸고, 해상도·차트 종류·축·기간 설정을 개인 대시보드에 보존. SMA/EMA 조작 안내 | 일별 일부 온체인은 블록 확인과 주소 라벨 결합으로 지연 가능. 공식 안내는 안전한 일별 조회 시각과 null을 명시 | 코인 전환 시 같은 지표·설정 유지, 미지원은 대체값 생성 금지. 저장한 분석의 설정 복원. 라벨링 알고리즘·DB 미확인. [차트 안내](https://userguide.cryptoquant.com/quickstart/6-minute-feature-guide/1.-charting-overview) |
| Glassnode | API·Studio가 같은 지표 체계를 사용하고 메타데이터로 자산·해상도·이력을 제공 | 시각은 UTC 구간 시작. 집계구간과 게시·완료 시각은 다름. 최신 관측은 블록 확인·재계산·라벨 수정으로 달라질 수 있음. API 이력은 플랜에 따름 | `기준일 / 수집 시각 / 확정 여부`를 다른 의미로 관리. 최신가 스트림이 온체인 최신성을 대신하지 않음. 내부 DB 미확인. [API](https://docs.glassnode.com/basic-api/api), [시각](https://docs.glassnode.com/data/timestamps-and-resolutions), [확정](https://docs.glassnode.com/data/data-finalization) |
| TradingView | 상단 비교 도구로 종목을 추가하며 기본 비교 축을 %로 전환. 서로 큰 가격차를 가진 종목을 가격축에 겹치면 납작해짐을 설명 | 공개 Lightweight Charts는 HTML5 Canvas 렌더러. 데이터를 포함한 유료 TradingView 전체 시스템과 별개이며 개발자가 데이터를 넣어야 함 | 기존 LWC 유지, 동일 단위 비교와 날짜축 연동, 증분 업데이트. 전체 TradingView DB·데이터 계약 미확인. [비교](https://www.tradingview.com/support/solutions/43000543053-how-to-use-the-compare-tool/), [LWC](https://github.com/tradingview/lightweight-charts) |
| Santiment | 공식 Charts Handbook의 초기 선택은 BTC/가격. 지표 선택은 차트 내부, 최근/저장 레이아웃은 별도 사이드바. 전역 기간·해상도와 지표별 설정을 구분 | 공식 산식 인터페이스는 자산 slug·변수·계산을 명시. 다른 단위의 계산에 호환성을 확인하라고 안내 | 가격과 지표를 같은 차트 작업 흐름으로 연결. 다른 코인으로 전환할 때 지표의 실제 대상도 변하는지 검사. 산식 편집기/백테스트 전체를 이번 범위에 복제하지 않음. 내부 DB 미확인. [공식 Handbook](https://academy.santiment.net/sanbase/charts/) |
| DefiLlama | 프로토콜·체인 활동을 가격 자체와 구분해 탐색. TVL·수수료·거래량·수익률의 어댑터 저장소가 분리됨 | 공식 TVL 어댑터는 시각·블록 기준 계약 잔액을 읽고 SDK가 평가·합산. `methodology/start/timetravel/misrepresentedTokens`를 구분. Aave 공개 코드의 체인별 TVL/borrowed/staking 구조를 확인 | 공급/네트워크/프로젝트 구분과 원천별 작은 어댑터·계산 정의·재현 테스트. TVL을 토큰 가치로 표시하지 않음. 전체 운영 DB/캐시 미확인. [방법론](https://docs.llama.fi/), [어댑터](https://docs.llama.fi/list-your-project/how-to-write-an-sdk-adapter) |
| Token Terminal | Discover/프로젝트/지표/Studio를 분리하고 지표 정의 목록과 사용자 대시보드 제공 | 공식 설명은 원시→해독→표준화 ELT와 재처리·추적성을 명시. BigQuery Datashare 제공은 확인되지만 전체 서비스 DB가 BigQuery라고 단정할 수 없음. API는 읽기 전용 REST/JSON | 원천·정규화·계산 정의 추적과 변경 데이터만 재처리. 전체 원시체인 확보 규모는 모방하지 않음. 내부 캐시·갱신 SLA 미확인. [데이터 접근](https://tokenterminal.com/docs/data-approach), [API](https://tokenterminal.com/docs/api-reference/introduction), [지표](https://tokenterminal.com/explorer/metrics) |
| Tokenomist | 언락·발행·배분·온체인 청구·소각 등을 다른 도구로 구분. 가격·유통 관련 수치와 예정 언락을 함께 표시 | 공개 예시는 베스팅 일정에서 예측한 이벤트임을 명시. API 토큰 목록과 circulatingSupply 필드 확인. 일정·발행·실제 청구는 같은 사실이 아님 | 검토된 외부 공급 링크에 제공자·의미 표시. 원천 없는 언락 일정이나 매도압력 판단 생성 금지. 내부 DB·전수 방법론 미확인. [홈](https://tokenomist.ai/), [문서](https://docs.tokenomist.ai/overview) |
| CryptoRank | 카테고리·태그·생태계·성과·언락·관심목록 탐색과 검색. 분류별 표에 수익률/시총/거래량/종목 수를 분리 | 카테고리는 프로젝트 경제적 영역에 따른 분류임을 설명. 전체 모수와 분류가 보리차트 추적종목과 다름 | 검색·테마→코인→가격/지표 흐름. 추적종목 수를 전체시장 순위처럼 표현하지 않음. 내부 DB·가격 집계 산식 미확인. [카테고리](https://cryptorank.io/categories) |
| 업비트 데이터랩 | 시장·섹터·스크리너→자산 요약→수익률/변동성/기술분석. BTC 상세에 가격 기간과 KRW, 대표 마켓 선정 기준 | 직접 거래소 API는 거래가 있는 구간에만 캔들을 반환. DataLab의 대표 마켓 우선순위와 별도로 보리차트는 사용자가 지정한 거래소·통화를 보존해야 함 | 한국어 검색/짧은 자산 행·가격 상세. 당일과24h 변화 구분. DataLab 내부 DB·집계공급자·갱신주기 미확인. [시장](https://datalab.upbit.com/), [BTC 상세](https://datalab.upbit.com/assets/BTC/summary), [공식 캔들](https://docs.upbit.com/kr/reference/list-candles-days) |
| 토스증권 | 공개 홈 텍스트에 검색·주식 탐색·현재가/등락률/거래대금 필터와 산업 연결. 이번 웹 도구에는 지원하지 않는 브라우저 안내도 표시 | 현재 페이지의 내부 데이터 조달·DB·전처리·시세 연결은 공개 근거 미확인. 실제 가격차트 조작·모바일 레이아웃은 본 조사에서 확인 못함 | 숫자 정렬과 명확한 목록→상세 위계만 참고. 주문/계좌/AI 요약과 거래 고객 데이터는 복제하지 않음. [공개 홈](https://www.tossinvest.com/) |

## 공개 소스에서 확인한 엔지니어링

### Lightweight Charts

확인 커밋은 `cb06581a0ae28778de17521b5c3edc8119e46d5d`입니다. 최근 5개 공개 커밋은 2026-10-09에 있었으며 이는 개발 활동 표본이지 운영 데이터 갱신 주기가 아닙니다.

- `DataLayer`는 시간→각 시리즈 데이터, 시리즈→행 배열, 마지막 시각을 Map으로 관리합니다. `updateSeriesData`는 마지막 값 갱신/새 값 추가와 과거 데이터 갱신을 구분하고 일반 업데이트에서 더 오래된 시각을 거부합니다. **브라우저 메모리 구조이며 서버 DB가 아닙니다.** [불변 커밋 코드](https://github.com/tradingview/lightweight-charts/blob/cb06581a0ae28778de17521b5c3edc8119e46d5d/src/model/data-layer.ts)
- 공개 `ISeriesApi.update`는 같은 시각이면 마지막 행 교체, 새 시각이면 추가합니다. 늦은 SSE 이벤트를 걸러내고 데이터 변경 때 차트 인스턴스를 재생성하지 않는 보리차트의 방향과 맞습니다. [공식 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi)
- 캔들에는 `time/open/high/low/close`, 선에는 `time/value`가 필요합니다. 값을 새로 만들어주는 라이브러리가 아닙니다. [CandlestickData](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/CandlestickData)

### DefiLlama

TVL 어댑터 커밋 `2cc05322533e23ef84c52568969c040aa27aac27`의 Aave `index.js`는 체인별 계약 조회·묶음 호출과 `tvl/borrowed/staking/pool2`를 구분합니다. 공식 SDK 문서는 원시 계약 잔액→토큰 평가→TVL 합산의 역할을 구분합니다. [불변 커밋 Aave 코드](https://github.com/DefiLlama/DefiLlama-Adapters/blob/2cc05322533e23ef84c52568969c040aa27aac27/projects/aave/index.js)

수수료·거래량 등을 위한 dimension 어댑터는 별도 저장소입니다. [확인 커밋 README](https://github.com/DefiLlama/dimension-adapters/blob/79c6455a74436b04d66516280fd44e9f8ffc117f/README.md). 두 저장소 최근 5개 커밋은 조회한 2026-10-12 UTC의 짧은 구간에 있었습니다. **이 표본으로 수집 Cron이나 데이터 갱신 간격을 추정하지 않습니다.** 공개 링크인 `defillama-server`와 `defillama-app`은 이번 접근에서404여서 서버 DB·캐시 구조 근거로 사용하지 않았습니다.

보리차트에 적용할 것은 대규모 인프라 복제가 아니라, 원천별 작은 어댑터·명시적 시작 관측·역사 재현 가능 여부·계산 정의·변환 시험입니다. React/LWC/Node/SQLite/SSE를 교체할 근거는 찾지 못했습니다.

## 가격 차트의 데이터·QA 기준

1. 자산 ID·거래소·거래쌍·통화·가격 종류를 제목/요청 키/저장 링크에 동일하게 사용합니다. 현물 Upbit KRW와 Binance USDT·Bybit 무기한은 다른 자료입니다.
2. 실제 OHLC가 있으면 캔들/종가선, 참조 종가만 있으면 종가선. 종가를 네 번 복사해 캔들을 만들지 않습니다. 주·월은 실제 OHLC에서 첫시가/최고고가/최저저가/마지막종가로 집계합니다.
3. Upbit 캔들 부재는 거래 없음일 수 있습니다. 빈 날짜를 보간하거나 수집 실패로 자동 분류하지 않습니다. Binance 봉 식별자는 시작시각이며 시간대 입력과 조회 경계시각을 구분합니다. [Binance 공식 봉 정의](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)
4. 진행 봉은 확정 봉과 구분합니다. SSE 현재가를 확정 종가로 덮어쓰지 않으며 거래 없는 구간에 임의의 OHLC를 생성하지 않습니다.
5. 가격→지표→가격 전환, 코인 전환, 원천 전환, 뒤로 가기, 새로고침, 날짜 고정, 확대, 공유, 저장·복원을 검사합니다. 늦은 응답이 다른 코인의 가격/오류를 덮어쓰지 않아야 합니다.
6. 가격과 MVRV를 비교할 때 다른 단위 축/패널을 사용합니다. 성과 %는 시작기준을 명시하며 화면 이동에 따라 기준이 바뀌는지 고정되는지를 설명과 일치시킵니다.
7. 가격의 실제 체결 시각 300초 기준은 유지합니다. 일별 온체인을 실시간 스트림처럼 표현하지 않고 출처별 갱신주기·수정 가능성을 정보 패널에서 확인하도록 합니다.

## 미확인과 제외

이 문서로 경쟁사 전체 역공학, 비공개 DB/데이터 계약 확인, 유료 지표 획득, 모든 기기 UX 검증을 완료했다고 표현할 수 없습니다. 수치·정의·공개 메뉴의 확인과 실제 인터랙션 시험은 별도입니다. 공개 코드 라이선스도 재사용 파일별로 확인해야 하며, 공개 페이지를 읽을 수 있다는 것이 데이터 재배포 권한을 뜻하지 않습니다.
