# 0.29 슈퍼트렌드 검증

사용자가 제공한 DOGE Binance 주봉의 Supertrend(10,3)를 기존 모든 추적 코인에서 사용할 수 있도록 구현합니다. 기본값과 전체 이력, 실제 OHLC의 거래소·통화, 마지막 확정 봉을 구분합니다. 원천·봉 간격·결측 조건이 다른 TradingView 화면과 모든 숫자가 같다고 표현하지 않습니다.

계산은 `shared/supertrend.ts`, 표시·설정·설명 연결은 `src/IndicatorWorkspace.tsx`, 계단형 선과 채움은 `src/SupertrendPrimitive.ts`에 있습니다. `scripts/verify_supertrend.py`의 독립 Decimal 계산과 TypeScript 결과를 대조합니다. 테스트 자료는 현재 시세가 아닌 결정론적 합성 OHLC입니다.

이번 검증에는 ATR 초기 평균·재귀 평균, 상하 경계 유지, 양 방향 전환, 동일 경계, 미확정·미래 봉 제외, 결측·잘못된 OHLC 후 재시작, 작은 가격 단위, 시간·일·주·월 간격, 150개 지원 원천, 한국어 검색, 설명과 저장 설정 연결을 포함합니다.

실제 운영 데이터 검산·원격 CI·배포 증거는 완료한 검사별로 이 폴더에 기록합니다. 모든 수집 원천 정상, 실제 Apple Safari·VoiceOver, 사람 대상 사용성 시험을 자동 검사 통과로 대신하지 않습니다. 48시간 대기는 적용하지 않습니다.

## 실제 데이터·배포 결과

[PR #59](https://github.com/pollmap/coin-desk/pull/59)를 main `bc0a46e5665121a137eec2560e623ac84ba62e76`에 병합했습니다. [PR CI](https://github.com/pollmap/coin-desk/actions/runs/38088233980)와 [main CI](https://github.com/pollmap/coin-desk/actions/runs/38088962453) 모두 단위 703개, 서버 Node 22개·Python 24개, 복구 2개, Chromium/WebKit 234개를 통과했습니다. 브라우저 재시도는 0이고 개인 opt-in 2개는 제외했습니다. 최종 슈퍼트렌드 회귀 12개도 로컬에서 통과했습니다.

150개 코인의 지원 거래소 241개 조합을 읽고 73,940개 슈퍼트렌드·ATR·상하 경계·방향을 독립 Decimal 계산과 대조했습니다. 150개 모두 계산 가능한 실제 거래소의 주봉 또는 일봉이 있습니다. 기본 주봉은 149개 코인에서 계산됩니다. HYPE는 주봉 10개가 쌓이지 않아 일봉 전환으로 확인했습니다. 업비트 CRV·KMNO도 주봉 표본이 부족해 일봉을 사용할 수 있으며, 업비트 KAIA·NMR은 일봉도 10개 미만으로 계산 대기입니다. 두 코인의 Binance 이력은 계산됩니다. 원천을 몰래 바꾸거나 출시 초기 값을 만들지 않았습니다. 이 검사는 API의 실제 OHLC를 재계산한 것이며, 공급자의 모든 과거 봉을 이번에 다시 요청해 검증했다는 뜻은 아닙니다. [실데이터 검산](actual-supertrend.json)

VPS API `vps-742d6e1430ffac93`와 [Pages 배포](https://3cf4c01d.coin-desk.pages.dev)에 같은 Docker 빌드를 적용했습니다. 공개 파일 250개씩을 양 주소에서 대조했으며 VPS HTML의 공유 이미지 주소 두 곳만 해당 주소로 바뀝니다. Git main의 소스 509개는 배포 manifest와 일치합니다. 수집기·DB·스키마 0009와 예약 작업을 유지했고, API 외 여섯 컨테이너 ID도 그대로입니다. 이전 코드·정적 자산·백업을 보존했습니다. [파일 대조](deployment-assets.json) · [소스 대조](source-match.json) · [전환](activation.json)

양 운영 주소의 실데이터로 DOGE 주봉 값·방향·초기 계산 전 구간·날짜 고정·설명 복귀·설정 저장·복원, BTC·ETH·ONDO·PEPE·PENGU·AAVE 대상 유지, HYPE 일봉 전환과 종가 전용 원천 거절을 확인했습니다. 양 테마 axe 위반·CSP 위반·페이지 오류는 0입니다. [운영 사용자 흐름](production-user-flow.json) · [읽기 API와 검색](production-read.json)

SQLite 백업·복원에서 21개 테이블과 22개 스키마 객체·내용 해시를 대조했습니다. 검증용 컨테이너·임시 복사본을 정리했으며 기존 QA 복사본의 정확한 바이트는 압축 해제 SHA-256 검증 후 보존했습니다. 과거 감사용 백업 두 개는 SQLite sidecar까지 tar.gz에 보존하므로 복원 전에 별도 경로로 압축을 풀어야 합니다. 현재·이전 릴리스 백업과 운영 DB는 바꾸지 않았습니다. [백업·복원](backup-restore.json) · [QA 보관](qa-storage.json)

## 운영 범위와 남은 외부 검사

슈퍼트렌드 계산·배포 완료와 전체 원천 정상은 별개입니다. [자연 갱신 표본](natural-cron.json)의 실제 체결·확인 시각, 예약 작업 성공과 원천 health를 그대로 남겼습니다. HTTP 503 또는 표본 기준 미달을 정상으로 바꾸지 않았으며 실제 체결 300초 조건과 관측 주기를 완화하지 않았습니다. 실제 Apple Safari·VoiceOver 및 사람 대상 사용성 검사는 미검증입니다. 48시간 대기는 적용하지 않습니다. [완료 범위](final-status.json) · [전체 검증 기록](verification.json)
