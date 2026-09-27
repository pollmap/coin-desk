# 차트 날짜 탐색 개선 · 0.15.7

기준: 2026-09-27. 가격·온체인·선물·가격 위치 밴드의 공통 날짜 탐색 개선입니다.

## 확인한 문제와 수정

[변경 전 화면](01-before.png): DOGE 밴드는 전체 이력에 긴 슬라이더만 있어 특정 날짜 주변을 확대하기 어려웠습니다. 가격 차트의 직접 날짜 입력은 결측일을 실제 관측에 맞추지 않았고, 구간 선택과 확대 조작도 분리돼 있었습니다. 밴드에서 실제로 그리지 않는 RSI 지표 선택 표시도 남아 있었습니다.

- 차트 아래 날짜 이동, 이전/다음 구간, 확대/축소, 전체 보기, 최신 구간을 함께 배치했습니다.
- 날짜 이동은 UTC 기준 실제 최근접 관측을 선택하고 최대 90개 관측의 주변 구간으로 이동합니다. 동률은 이전 관측을 사용합니다. 기간 선택은 종료일의 모든 UTC 관측을 포함합니다.
- 날짜 누락을 보간하지 않습니다. 확보 범위 밖, 잘못된 날짜, 역전된 기간, 관측 2개 미만은 명시적으로 안내합니다.
- 밴드는 전체 원천으로 산출한 730일 분포·누적 고점 대비 낙폭을 유지하고 화면 범위만 변경합니다. 화면 밖 밴드가 가격축을 늘리지 않도록 양쪽 경계를 필터링합니다.
- 확대된 실제 표시 구간으로 CSV를 내보내고 공유 URL의 chart_from/chart_to로 재진입을 복원합니다. 원천·봉·기간·주 지표 변경은 기존 공유 범위를 해제합니다.
- 밴드 날짜축은 화면 폭에 맞춰 2·3·5개 눈금을 표시하고, 짧은 기간에서는 일자까지 표시합니다.
- Alt+G, Escape, 모달 포커스 복원, 44px 조작 영역을 적용했습니다. 현재 보이는 UTC 기간을 차트 아래 표시합니다.
- 밴드에서 적용되지 않는 지표 선택 표시는 숨깁니다. 지표 추가를 누르면 가격·지표 화면으로 전환하고 목록을 엽니다.

## 참고한 공개 조작

TradingView의 [차트 하단 날짜·기간 이동](https://www.tradingview.com/support/solutions/43000482911-how-to-go-to-the-specific-date-on-the-chart/)과 [Alt+G 단축키](https://www.tradingview.com/charting-library-docs/latest/getting_started/Shortcuts/)를 참고했습니다. 자체 Lightweight Charts와 SVG 구현이며 TradingView Advanced Charts 전체 기능을 포함한다는 뜻은 아닙니다.

## 검증과 범위

- [PR #29](https://github.com/pollmap/coin-desk/pull/29), main `f939d5f0b52ee359f0de1527d611ad5f138bfaf2`. [PR CI 36318512262](https://github.com/pollmap/coin-desk/actions/runs/36318512262): 타입·351개 단위·2개 복구·32개 Chromium/WebKit 검사·빌드·문서/브랜드 검사 통과. 320/390/768/1280/1440px 양 테마 axe, 200% 확대, 날짜/기간/공유 복원을 포함합니다.
- [날짜 입력창](02-date-dialog-fixture.png), [선택 날짜 주변](03-date-window-fixture.png)은 격리된 fixture 화면입니다. 실제 브라우저 입력 중 표시 날짜와 React 상태가 어긋나는 경로를 발견해 제출 시 FormData의 실제 입력값을 사용하도록 수정했습니다.
- 2026-09-27 약 12:25 UTC 빌드 → 원격 마이그레이션 확인(추가 없음) → 수집 Worker → 메인 Worker → Pages 순서 배포 성공. 미커밋 파일 경고는 검수 스크린샷 하나였으며 배포 소스는 위 main입니다. 수집 로직·스키마 변경 없음.
- 운영 Worker `1609646f-5da9-4942-9b35-36a485b4b3b3`, [Pages 배포](https://20fe8bb2.coin-desk.pages.dev). Feed `213fb453-a085-4d3a-80c3-b85ce40dd7c1`, quotes `bc5835eb-ca43-48a0-9a50-a8447d500310`, background `275e43c4-61ac-45c2-95a5-09cb89e89f2b`, analysis `9496d131-fa81-4a46-9b63-5151384b8ea7`.
- 운영 DOGE에서 2021-05-08 선택 후 [2021-03-25~06-22 확대](04-production-doge-date.png), [공유 URL 재진입 복원](05-production-restored-range.png)을 확인했습니다. [ETH MVRV](06-production-eth-onchain.png)도 가격 차트 없이 주 지표를 확대하며 동일 도구를 표시합니다.
- [운영 API·원격 읽기 전용 증거](production.json): 활성 원천 **103/103 정상**, health200, signals12, briefings2, ETH TVL3287, 시장 수급8, 핵심3코인 온체인/선물 HTTP200. 방문 수집 API/overview 호출 없이 12:18~12:26 UTC 양 거래소 핵심 시세의 저장 시각 증가 및 자연 Cron 완료를 확인했습니다. 조회 쓰기는 0행입니다.
- **현재 정상 원천과 48시간 안정 관찰은 다릅니다.** `observation48h.ready=false`, 기록1342/2880, 성공682, 실패660, 최장공백34560초로 과거 중단이 남아 있습니다. 현재 health200을 48시간 안정성 통과로 해석하지 않습니다.
- 최종 배포 후 첫 완전한 UTC 하루인 9/28의 공식 계정 사용량은 9/29 01:00 UTC 이후 확인할 수 있습니다. 이후 일간 비용·다음날 브리핑·48시간 관찰을 충족하기 전 임시 후속 자동화는 ACTIVE입니다. 제품의 매분 Cron은 그대로 유지됩니다.
- 실제 Safari/VoiceOver 실기기 미검증. WebKit/axe 통과를 실기기 통과나 WCAG 전체 인증으로 표현하지 않습니다.
