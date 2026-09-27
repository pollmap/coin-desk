# 0.15.4 운영 마감 검증

2026-09-27. 코드 검증 중이며 운영 마감 완료가 아닙니다. 공개 리서치·역사·신규 코인·유료 데이터는 추가하지 않습니다.

## 발견한 운영 실패

- 18:25 KST 점검 당시 정상 원천 17/103. 과거의 일시적 정상 상태로 현재 운영을 보장할 수 없습니다.
- [실제 Cron 로그](cpu-failure-before.json)의 18개 실행은 `exceededCpu`, CPU 10ms입니다. 기존 하나의 scheduled 호출에서 7개 waitUntil 작업을 시작했으므로 작업별 CPU가 분리되지 않았습니다.
- [9월 26일 UTC 공식 계정 전체 집계](usage-2026-09-26.json): 읽기 4,712,075행, 쓰기 36,593행. 한도 이내지만 배포 이후 완전한 하루가 아니고 CPU 실패도 있어 운영 통과 근거로 쓰지 않습니다.

## 수정

| Worker | 역할 | 예약/데이터 확인 주기 |
|---|---|---|
| btc-desk | 공개 API, 내부 수집 호출, 핵심 최근 선물, 브리핑 | 매분 Cron, 코인별 선물 5분 |
| btc-desk-quotes | 거래소 현재가 | 매분 Cron, 기존 시세 정책 유지 |
| btc-desk-background | 일봉·온체인·과거 이력·재시도 | 주 Worker 내부 호출로 매분 한 작업 |
| btc-desk-analysis | 자산·원천별 신호, ETH 맥락, 제공자 상태 | 내부 호출로 매분 한 부분, 신호 15부분/20분 순환 |

원천 확인 주기와 원천 데이터 생성 주기는 다릅니다. 현재가는 독립 Cron으로, 배경 수집·분석은 비공개 Worker 호출로 나누며 같은 D1과 기존 데이터·선물 과거 후보 10,000개/일 예약 한도를 유지합니다. 중단 작업 마감 UPDATE는 ring의 기본키 slot을 함께 사용해 반복 전수 조회를 제거합니다.

새 Worker는 내부 Service binding으로 기존 서울 feed에 연결합니다. feed의 공개 token 검사는 유지하며 새 Worker에 비밀키를 복사하거나 공개 수집 경로를 만들지 않습니다. Cron 예약은 주 Worker와 현재가 Worker 두 개만 사용합니다. 배경 수집·분석 Worker는 공개 URL과 Cron이 없고 내부 Service binding으로만 호출합니다. 유료 플랜·새 DB는 사용하지 않습니다.

48시간 관찰은 실행 기록률·성공률·누락·최장 공백·미해결 오류를 계산합니다. 마지막 2분은 진행 중 유예이며, 기록률 99% 이상·공백 180초 이하·미해결 오류 없음일 때만 healthy/ready입니다. 기간 충족은 별도 필드입니다. 배경 Cron 실행 기록과 모든 활성 원천·분석 부분의 상태를 함께 확인하며, 다른 Worker의 모든 실행을 배경 기록으로 대체했다고 주장하지 않습니다. `/status`와 `/health` 조회는 수집을 실행하지 않습니다.

## 검증

- TypeScript, 기존 확정 봉·결측·중복 신호·수정 이력·재시도 검사와 신규 관찰/수집 분리 검사.
- Chromium·WebKit: 코인/한글·티커 검색, 전체 기간, 가격 원천, 탭 전환, 뒤로·새로고침·공유, 실패/지연/깨진 로고 격리. 320/390/768/1280/1440px 네 화면의 두 테마에서 가로 넘침과 axe WCAG A/AA 검사. 키보드·Escape·CSS 200% 확대.
- 브라우저는 운영 DB 대신 격리 메모리 DB와 실제 API 코드를 사용합니다. 외부 수집은 차단합니다. CI에 동일 검사를 연결하고 실패 trace만 보관합니다.
- axe가 발견한 밝은 테마 선택 버튼 대비를 수정했습니다. 자동 검사 통과가 전체 WCAG 인증이나 실제 Safari·VoiceOver 통과를 의미하지 않습니다. Apple 실기기 검증은 별도 대기입니다.
- [실제 운영 백업 복원 검사](recovery.json): 모든 사용자 테이블·스키마·인덱스·뷰·트리거 자동 발견, 행 수·타입 포함 내용 해시·스키마 해시 동일, integrity_check=ok, 외래키 위반 0. 새 신호/정정/브리핑/ETH 이력 포함. 원본 export와 복원 DB는 무시된 work 폴더에만 있고 운영 DB를 덮어쓰지 않았습니다.

## 배포와 후속 완료 조건

CI 통과 후 `npm run deploy`: 빌드 → 원격 추가형 마이그레이션 확인 → feed 내부 entrypoint → 독립 수집 Worker → 주 Worker → Pages. 이번 변경에는 신규 마이그레이션이 없습니다. 실제 배포 ID·관측 결과는 검증 후 이 문서에 추가합니다.

공개 API, 두 Cron 및 내부 수집 Worker 완료, 핵심 시세/선물, 15개 분석 부분, 보조 원천 복구를 확인합니다. 수집 API를 호출하지 않고 D1 SELECT와 sanitized tail을 사용합니다. 부분 쿼리 insights를 하루 비용으로 대체하지 않습니다.

최종 배포 이후 첫 완전한 UTC 하루와 다음 날 브리핑이 필요합니다. 공식 계정 전체 집계 재현:

```powershell
python scripts/daily_usage.py --account 503a5a5e5cd31747b20aa597b20c5188 --day YYYY-MM-DD --deployed-at ACTUAL_UTC_DEPLOY_TIME --output work/daily-usage.json
npm run test:recovery
npm run test:e2e
```

사용량 수집 도구는 기존 Wrangler 인증을 내부에서 사용하고 키를 출력하지 않습니다. 하루 종료 후 최소 1시간을 두며 전체 일간 집계가 없으면 미검증으로 남깁니다. CPU 실패나 원천 지연이 남으면 사용량이 한도 이내여도 완료 처리하지 않습니다. 임시 후속 자동화는 모두 확인된 후에만 중지하며 제품 Cron은 계속 유지합니다.

공식 근거: [D1 사용량 지표](https://developers.cloudflare.com/d1/observability/metrics-analytics/), [D1 한도](https://developers.cloudflare.com/d1/platform/pricing/), [Worker 한도](https://developers.cloudflare.com/workers/platform/limits/), [Service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [Playwright CI](https://playwright.dev/docs/ci), [접근성 검사](https://playwright.dev/docs/accessibility-testing).

## 통합 배포 중 확인한 예약 한도

PR #25는 main e8de908fd036004c67a32e740b27d339c4428953으로 병합됐습니다. 타입/단위 340개, Python 복구 2개, Chromium/WebKit 26개를 CI에서 통과했습니다.

첫 배포는 feed와 현재가 Worker까지 성공한 뒤 background Cron 설치에서 code 10072로 중단했습니다. 계정 무료 Cron 총 5개 중 다른 서비스가 3개를 사용 중이었습니다. 다른 서비스 예약을 변경하거나 유료 전환하지 않았으며 주 Worker/Pages는 아직 이전 버전입니다. 후속 수정에서는 Coin Desk의 Cron 2개만 유지하고 background/analysis는 비공개 Service binding 호출로 실행합니다. 내부 수집 호출은 완료까지 await하며 원천 실패와 CPU 실패는 실제 배포에서 다시 측정합니다.
