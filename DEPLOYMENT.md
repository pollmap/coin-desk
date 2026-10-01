# Coin Desk VPS 이전과 배포

2026-10-02 KST 기준 **VPS 실행부와 이관·배포 도구를 구현했으며, 실제 서버 전환은 미완료**입니다. 이 실행 환경의 SSH 소켓 연결이 `Permission denied`로 차단됐습니다. 키 인증 실패라고 단정하지 않습니다. Docker도 로컬에 없어 컨테이너 빌드·Compose 실행·Nginx·인증서는 서버에서 확인해야 합니다. 기존 Cloudflare 서비스와 데이터를 변경하지 않았습니다.

## 유지하는 제품

웹 0.20의 BTC MVRV 첫 화면, 여덟 코인, 지표 선택, 가격 위치 밴드와 자체 BTC 로그회귀 레인보우를 유지합니다. React·Lightweight Charts·계산 코드·읽기 API를 그대로 사용합니다. DB에는 기존 데이터와 예약 이력을 이관합니다. 원천·단위·결측·확정 봉·730일 조건·48시간 안정성 기준을 변경하지 않습니다. X 추가 수집이나 새 제품 기능은 이번 이전에 추가하지 않습니다.

## 새 구조

```mermaid
flowchart LR
  Browser[차트와 기기 저장] --> HTTPS[Nginx HTTPS]
  Old[기존 Pages 주소] --> Bridge[읽기 전용 연결부]
  Bridge --> HTTPS
  HTTPS --> API[Node 24 읽기 전용 API와 정적 웹]
  API --> DB[(프로젝트 전용 SQLite WAL)]
  Q[매분 시세] --> DB
  B[매분 배경 큐] --> DB
  F[최근 선물 확인] --> DB
  A[분산 분석과 브리핑] --> DB
  DB --> Backup[온라인 백업과 복원 대조]
```

- API의 SQLite 연결은 실제 `readOnly`입니다. 방문자가 시세 수집이나 DB 쓰기를 시작하지 않습니다.
- 수집 4개 프로세스는 기존 `worker/collector-entry.ts`, `scheduled.ts`, `observations.ts`를 재사용합니다. 공개 프록시 없이 기존 허용 원천에 직접 연결합니다.
- 정시 실행은 작업 완료와 독립적으로 예약하며, 겹친 실행·실패·실제 시작/완료를 기록합니다. 늦은 작업의 따라잡기 요청을 한꺼번에 발생시키지 않습니다. 건강한 실행 기록은 원천 정상이나 48시간 완료의 대체 증거가 아닙니다.
- SQLite WAL, 10초 잠금 대기, 원자적 batch, 수집별 기존 lease와 재시도를 유지합니다. 한 서버·현재 데이터 규모에 맞춘 구조이며 다중 서버 DB 구성은 아닙니다.
- 백업은 SQLite 온라인 백업 API로 일관된 스냅샷을 만들고, 별도 DB에 복원해 전체 사용자 테이블·스키마·인덱스·행 해시·무결성을 대조합니다. 14일·2 GiB 예산을 기본으로 하며 최소 최신 2개를 보존합니다. 예산 초과와 실패는 상태에 남깁니다. **동일 VPS의 백업은 외부 재해 복구 백업이 아닙니다.**
- 원래 `/api/v1/status`, `/health`와 응답 필드를 유지합니다. VPS의 `/healthz`는 프로세스·스키마·DB 검사만, `/api/v1/runtime`은 수집 실행부·백업 상태만 표시합니다. 원천 정상은 기존 상태 API로 별도 판단합니다.

## 격리와 자원

프로젝트 루트는 `/srv/services/coin-desk`, Compose 이름은 `coin-desk`, 네트워크는 `coin-desk-private`입니다. 외부에 DB 포트를 열지 않습니다. API는 호스트 `127.0.0.1`의 검증된 빈 포트에만 바인딩합니다. `18420`은 예시 후보이며 배정 완료가 아닙니다.

```text
/srv/services/coin-desk/
  releases/vps-<내용해시>/     변경 없는 릴리스 소스
  shared/data/                coin-desk.sqlite와 백업 상태
  shared/secrets/             릴리스별 env, 디렉터리 700·파일 600
  shared/acme/                인증서 챌린지
  backups/                    검증된 DB 스냅샷
  audit/                      비공개 운영·전환 증거
  current -> releases/...     검증 이후에만 승격
```

컨테이너는 UID 10001, 읽기 전용 루트, 권한 제거, 임시 공간 제한, 로그 10 MiB×3, `restart: unless-stopped`를 사용합니다. API 1 CPU/768 MiB, 각 수집 0.25 CPU/384 MiB, 백업 0.25 CPU/512 MiB를 제안합니다. 배포 전 **실제 여유 메모리 3 GiB·디스크 8 GiB 이상**을 요구하며 부족하면 설치를 중단합니다. 이는 아직 서버에서 측정한 값이 아닙니다. Node 이미지는 `24.18.0-bookworm-slim` 태그를 고정했으며 서버에서 실제 pull/build 성공과 이미지 digest를 기록해야 합니다.

`/srv/hannun`, `/opt/codex-gateway`, `/opt/llama.cpp`, 기존 포트·Nginx·DB·플랫폼 timer를 보존합니다. 삭제된 `/srv/mirae`를 복원하지 않습니다. 전역 Docker prune나 다른 Compose 프로젝트의 down을 실행하지 않습니다.

## 로컬 검사와 배포 묶음

```powershell
npm run check
npm run test:server
npm run test:recovery
npm run build
npm run package:vps
```

[릴리스 생성기](scripts/vps_release.py)는 허용한 소스만 `deployment-artifacts/vps-<해시>.tar.gz`에 넣고 모든 파일과 압축 파일의 SHA-256을 확인합니다. `.env`, 키, DB, `work`, 개인 원본을 포함하지 않습니다. [Compose](deploy/vps/compose.yaml)와 [Dockerfile](Dockerfile)을 함께 제공합니다. 빌드/원격 실행 성공을 패키지 생성 성공과 혼동하지 않습니다.

## 실제 이전 순서

1. 승인된 `chanhee-vps` SSH로 접속하고 실제 서버와 `/srv/platform`의 상태·템플릿을 확인합니다. [preflight.py](deploy/vps/preflight.py)는 컨테이너 건강 상태·활성 서비스/timer·여유 자원·포트·Nginx를 읽기 전용으로 확인합니다. 키·서비스 환경변수는 출력하지 않습니다. SSH 호스트 검증을 끄지 않습니다.
2. Cloudflare 공식 D1 export로 **운영 전체 SQL**을 비공개로 확보합니다. 쿼리 표본이나 로컬 캐시는 운영 export의 대체물이 아닙니다. 운영 쪽 자동 발견 테이블 수·행 수·스키마를 export와 대조합니다. 원본을 보존합니다.
3. 서버의 비공개 별도 폴더에서 신규 DB에 이관합니다. [import_d1_export.py](scripts/import_d1_export.py)는 기존 파일 덮어쓰기, 외부 DB ATTACH, 확장 로딩, 스키마 불일치를 거부합니다. 과거 마이그레이션을 검증된 원장으로 기록하므로 `0008`을 재실행해 예약 이력을 재구성하지 않습니다.

   ```bash
   python3 scripts/import_d1_export.py --source /private/export.sql --destination /private/coin-desk.sqlite
   ```

   검증 보고서는 새 DB 옆 `coin-desk.import.json`입니다. 신규 DB와 보고서를 프로젝트 `shared/data`에 설치하고 원본 export는 비공개로 보관합니다. Node 부트스트랩에서 import 검증 없이 기존 DB에 마이그레이션을 재적용하지 않습니다.
4. 내용을 검증한 릴리스 압축을 **새** `releases/vps-<해시>` 폴더에 풀고 그 폴더에서 `bash deploy/vps/stage.sh <빈 포트>`를 실행합니다. 소스 체크섬→기존 서비스 기준선→Docker 빌드→추가형 마이그레이션→읽기 전용 API·백업 검사 순서입니다. 수집 프로파일과 `current` 승격은 아직 꺼져 있습니다. 이 단계의 shadow 검사는 정지된 수집에 따른 `/health` 503을 그대로 기록하며 원천 정상이라고 판정하지 않습니다. 활성화 이후 검사는 이 예외 없이 health 200을 요구합니다.
5. 소유한 호스트 또는 DNS를 확인한 sslip.io 호스트를 지정합니다. 아직 호스트를 배정하지 않았습니다. 기존 Certbot·갱신 timer를 확인한 뒤 `bash deploy/vps/https.sh <검증된 호스트> <포트>`를 실행합니다. DNS가 승인된 VPS로 향하는지 확인하고 다른 사이트의 호스트 소유권을 검사합니다. 새 Coin Desk 설정만 작성하며 기존 설정을 백업하고 `nginx -t` 후 reload합니다. 인증서 발급 실패 때 해당 새 라우트를 복구합니다. 자체 서명 인증서나 `--insecure`로 통과시키지 않습니다. HTTPS와 갱신 예약도 실제로 검증합니다.
6. 공개 주소의 읽기 API·BTC MVRV 실제 이력·여덟 코인·데이터 단위와 백업을 검사합니다. stage는 DB 쓰기 없이 8개 원천의 제한된 접근 검사를 수행하며 실패하면 중단합니다. 이것은 103개 원천의 전체 정상 검사가 아닙니다. 운영 원천 접근성이 아직 확인되지 않은 상태에서 Cloudflare 수집을 끄지 않습니다.
7. 전환 때 기존 `btc-desk` main과 `btc-desk-quotes`의 예약 및 **overview 수동 갱신**까지 모두 동결합니다. 실행 중 수집이 끝났는지 확인하고 마지막 전체 D1 export를 다시 대조합니다. 배경·분석 Worker의 서비스 호출도 멈춘 상태인지 확인합니다. 다른 프로젝트 Cron을 변경하지 않습니다. 필요하면 잠깐 읽기 전용 전환 안내를 표시합니다.
8. VPS 프로젝트 컨테이너를 정지한 동안 **최종 검증 DB**를 설치합니다. 기존 스냅샷은 프로젝트 백업에 보존하며 라이브 DB 파일을 실행 중 덮어쓰지 않습니다. 원장·스키마·행 수·내용 해시·예산과 커서를 최종 대조합니다. 예산/커서 키가 원래 없으면 유실로 표시하지 않습니다.
9. 수행한 실제 동결 증거를 `audit/legacy-writers-frozen.json`에 기록합니다. `allProjectWritersFrozen`, `includesOnDemandOverview`, `inflightDrained`, `productionSnapshotInstalled`는 실제 확인한 경우에만 true이며 `finalExportSha256`, `checkedAt`을 포함합니다. 이것은 추가 승인 질문이 아니라 작업 증거입니다. 이 파일이 없거나 1시간 이상 오래됐으면 활성화가 거부됩니다.
10. `bash deploy/vps/activate.sh <HTTPS 호스트>`를 실행합니다. 수집 4개를 시작하고 직접 수집/overview 호출 없이 300초 동안 읽기 전용 DB 비교를 합니다. 각 실행부 2회 이상 성공, 핵심 시세 6개의 실제 체결·확인 시각 증가, 최근 선물 9개 확인 증가를 요구합니다. 실패하면 증거를 보존하고 승격하지 않습니다. 성공 후 기존 서비스/timer가 악화되지 않았는지 확인하고 `current`와 `/srv/platform/SERVICES.md`에 해당 프로젝트만 기록합니다. 이는 짧은 표본이며 무방문 하루 전체 증거가 아닙니다.
11. 기존 Pages 주소를 유지하려면 [vps-gateway.ts](worker/vps-gateway.ts)와 [별도 gateway 설정](wrangler.vps-gateway.jsonc)의 `VPS_BASE_URL`을 검증된 HTTPS로 설정하고 **그 설정만** 배포합니다. 이 설정에는 D1·예약·수집 바인딩이 없습니다. 브라우저 쿠키나 인증 헤더도 VPS로 넘기지 않습니다. 검증 전 빈 URL로 배포하지 않습니다. 원래 `npm run deploy`는 Cloudflare 수집을 다시 켜므로 이전 후 실행하지 않습니다. 앞 단계 7의 동결 중에도 gateway 설정으로 읽기 전용 VPS를 연결할 수 있습니다.

기존 주소를 유지하면 기기 IndexedDB와 저장 설정도 같은 origin에서 유지됩니다. 새 VPS 호스트를 직접 쓰면 다른 origin이므로 기존 개인 자료함에서 **기기 백업→새 주소에서 기기 복원**해야 합니다. 개인 백업을 서버나 저장소로 전송하지 않습니다. 확장의 지정 사이트 권한은 현재 기존 Pages 주소이므로 새 호스트에서 자동 작동한다고 표현하지 않습니다.

## 복구와 운영 마감

- **코드 복구:** `bash deploy/vps/rollback.sh <이전에 검증한 릴리스>`를 사용합니다. 기존 스키마와의 호환 검사·API 건강·프로젝트 Nginx 포트·공개 HTTPS를 검사하고 `current`를 복구합니다. DB를 이전 시각으로 되돌리지 않습니다. 현재 릴리스 자료와 이미지는 유지합니다.
- **데이터 복구:** 프로젝트의 API·수집·백업을 모두 정지하고 아래 명령으로 새로운 경로에 복원합니다. 원본 백업과 기존 DB는 보존합니다. 검증 후 신규 DB를 설치하고 API→수집→백업을 다시 확인합니다.

  ```bash
  python3 scripts/vps_backup.py restore --snapshot backups/<시각>/snapshot.sqlite --manifest backups/<시각>/manifest.json --destination /private/restored.sqlite
  ```

- 기존 D1을 최소 30일 읽기 전용으로 유지해 대조·복구에 사용합니다. 이전이 끝났다고 DB나 과거 비용 증거를 삭제하지 않습니다. 기존 Cloudflare의 미확인 하루 비용과 엄격한 공백 실패를 VPS의 정상 결과로 소급해 바꾸지 않습니다.
- 새 서버에서 최소 완전 UTC 하루의 실제 자원·디스크·DB 증가량·백업·시세/선물 갱신·다음 날 브리핑을 확인합니다. 수집 이력은 이어 보관하고 **48시간 기록률 99%·최장 공백 180초·미해결 오류 없음** 기준은 유지합니다. 과거 공백을 지우거나 관찰 시작을 다시 설정해서 완료 처리하지 않습니다.
- 외부 저장소에 별도 암호화 백업을 둘 위치는 아직 지정하지 않았습니다. 동일 서버 고장까지 대비했다고 표현하지 않습니다. 실제 Apple Safari·VoiceOver는 기기가 없어 검증 대기입니다.

## 근거와 검사 범위

SQLite 온라인 백업과 Node 내장 SQLite를 사용합니다. [SQLite 공식 백업 API](https://sqlite.org/backup.html) · [Node 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) · [Compose 준비 상태와 의존 순서](https://docs.docker.com/compose/how-tos/startup-order/).

최신 검사와 실제 연결 한계는 [VPS 검증 기록](docs/audit-vps/README.md)에 보관합니다. 로컬 코드 검사, Docker 실행, 운영 데이터 이전, HTTPS 전환, 하루 안정성을 각각 구분합니다.
