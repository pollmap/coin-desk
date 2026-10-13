# 0.33.0 원격 CI 대조

GitHub Actions의 완료된 작업 로그와 보안 산출물을 읽기 전용으로 대조했습니다. 제품 소스 수정, VPS 접근, 배포, 브라우저·성능 검사는 수행하지 않았습니다.

| 구분 | PR #67 | main |
|---|---|---|
| 실행 | [38447078487](https://github.com/pollmap/coin-desk/actions/runs/38447078487) | [38448689332](https://github.com/pollmap/coin-desk/actions/runs/38448689332) |
| 커밋 | `6356387dc19271f8f39230dc1cf8e0c916b8e63b` | `5ff8c230c72554b0e72305aa945a6216df566aa9` |
| 전체 결과 | 성공 | 성공 |
| 타입·단위·계산·API | Vitest 75개 파일, 796개 통과 | 동일 |
| 백업 복구 | Python 2개 통과 | 동일 |
| 서버 | Node 31개 통과, 실패·제외 0 | 동일 |
| VPS 실행·복구 계약 | Python 27개 통과 | 동일 |
| Chromium | 197개 중 196개 통과, 개인 원본 opt-in 1개 제외 | 동일 |
| WebKit | 197개 중 196개 통과, 개인 원본 opt-in 1개 제외 | 동일 |
| 브라우저 합계 | 392개 통과, 2개 제외, 실패·불안정 재통과 0 | 동일 |
| Playwright 재시도 | 설정 0, 로그에서 재시도 0 | 동일 |
| 워크플로 실행 횟수 | `run_attempt=1` | 동일 |
| 최종 verify | 성공 | 성공 |

Vitest의 796개에는 단위·계산·API 검사가 함께 포함됩니다. PR와 main은 같은 검사를 반복한 것이므로 두 실행의 통과 수를 고유 기능 수처럼 더하지 않습니다. 제외된 검사는 `e2e/private-archive.spec.ts`의 실제 로컬 개인 원본 폴더 검사입니다. WebKit 통과를 실제 Apple Safari·VoiceOver 검사로 표현하지 않습니다.

## npm 감사와 컨테이너 감사의 차이

- npm 의존성 감사: 알려진 취약점 **0건**, HIGH 이상 차단 검사 통과.
- 컨테이너의 수정 버전이 있는 HIGH·CRITICAL 차단 검사: 통과. 이 검사는 `ignore-unfixed=true`입니다.
- 미수정 항목까지 기록한 전체 HIGH·CRITICAL 보고서: 두 실행 모두 **패키지별 발견 64행(HIGH 62·CRITICAL 2), 고유 CVE 18개, 패키지 26개**입니다. 보고서에서 `FixedVersion`이 있는 발견은 0행입니다.
- CRITICAL 보고 항목은 `zlib1g`의 `CVE-2023-45853`, `libsqlite3-0`의 `CVE-2025-7458`입니다. 여기에서는 실제 도달 가능성이나 영향까지 새로 판정하지 않았습니다.
- 별도의 Dockerfile HIGH·CRITICAL 구성 검사도 통과했습니다. 모든 등급의 보안 검사를 완료했다는 뜻은 아닙니다.

| 전체 보안 보고서 | SHA256 |
|---|---|
| PR | `d012fc32b428f7f78fd88fbdd07982321221d61a7539f4d5133db99f45fabf44` |
| main | `8ef734873d5334de84591dde5109f7f4895c5075ca7825df33d282ab160a640f` |

컨테이너 smoke는 fixture와 수집기 비활성 조건의 프로세스·SQLite·정적 파일·API 검사입니다. CI 통과는 실제 운영 데이터 연결, 배포, 성능 목표 통과의 증거와 구분합니다.

정확한 완료 시각, 작업 ID, 허용된 요약 로그, 재시도 설정의 main 커밋 대조, 보안 집계는 [ci.json](ci.json)에 있습니다. 요청 헤더·인증정보·개인 원본은 저장하지 않았습니다.
